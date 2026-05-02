// ─── Deriv V2 Advanced Engine ─────────────────────────────────────────────────
// Key difference from V1 / standard DBot:
//   • A new contract is opened on EVERY tick once in trading mode.
//   • We do NOT wait for the previous contract to settle before buying the next.
//   • Each open contract is tracked independently in `openContracts`.
//   • The only brief lock is `buyInFlight` — set when the buy request is sent,
//     cleared as soon as the ack arrives (~30-100 ms). This prevents sending two
//     buy requests for the exact same tick while the first ack is still on the
//     wire, but it does NOT block the next tick's buy.
//
// Result: contract N+1 is opened before contract N settles. ⚡

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type EngineLogType = 'scan' | 'info' | 'win' | 'loss' | 'error' | 'system';

export interface EngineLog {
    time:    string;
    message: string;
    type:    EngineLogType;
}

export type EngineStatus =
    | 'idle' | 'connecting' | 'scanning' | 'trading' | 'stopped' | 'error';

export type ContractKind =
    | 'DIGITMATCH' | 'DIGITDIFF'
    | 'DIGITEVEN'  | 'DIGITODD'
    | 'DIGITOVER'  | 'DIGITUNDER';

export type TradeDirection = 'EVEN' | 'ODD' | 'OVER' | 'UNDER';

export interface V2BotConfig {
    symbol:          string;
    contractKind:    ContractKind;
    direction?:      TradeDirection;
    prediction?:     number;
    barrier?:        number;
    entryPoint:      number;
    initialStake:    number;
    martingale:      number;
    martingaleLevel: number;
    takeProfit:      number;
    stopLoss:        number;
}

// ─── Store binding interface ──────────────────────────────────────────────────

export interface V2BoundStores {
    run_panel: {
        setIsRunning:      (v: boolean)    => void;
        setContractStage:  (stage: number) => void;
        setHasOpenContract:(v: boolean)    => void;
        toggleDrawer:      (open: boolean) => void;
    };
    transactions: {
        onBotContractEvent: (data: any) => void;
    };
    journal: {
        onLogSuccess: (msg: { log_type: string; extra: any }) => void;
        onError:      (msg: string | Error) => void;
    };
    summary_card: {
        onBotContractEvent: (data: any) => void;
        clear:              ()           => void;
    };
    setRunId: (id: string) => void;
}

// ─── Per-contract tracking ────────────────────────────────────────────────────

interface OpenContract {
    contractId: string;
    stake:      number;          // stake used when this contract was bought
    subId:      string | null;   // proposal_open_contract subscription id
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DerivV2Engine {
    private config:  V2BotConfig;
    private stores:  V2BoundStores | null = null;

    // req_id namespace
    private reqBase:    number     = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter: number     = 0;
    private myReqIds:   Set<number>= new Set();

    // Subscriptions
    private msgSub:       { unsubscribe: () => void } | null = null;
    private tickSubId:    string | null = null;

    // Trading state
    private isRunning:    boolean = false;
    private tradingMode:  0 | 1   = 0;   // 0 = scanning, 1 = trading
    private currentStake: number;
    private lossCount:    number  = 1;
    private totalProfit:  number  = 0;
    private wins:         number  = 0;
    private losses:       number  = 0;

    // ── V2-specific: non-blocking multi-contract tracking ─────────────────────
    // `buyInFlight` is true ONLY for the ~30-100 ms between send and ack.
    // It is NOT held open while the contract is running.
    private buyInFlight:    boolean                        = false;
    private openContracts:  Map<string, OpenContract>     = new Map();
    private lastTickQuote:  number                        = -1; // debounce same tick

    // Callbacks
    public onLog:    (log: EngineLog)                              => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number) => void = () => {};
    public onStatus: (status: EngineStatus)                        => void = () => {};

    constructor(config: V2BotConfig) {
        this.config       = config;
        this.currentStake = config.initialStake;
    }

    bindStores(stores: V2BoundStores): void {
        this.stores = stores;
    }

    // ── Public ────────────────────────────────────────────────────────────────

    start(): void {
        if (this.isRunning) return;

        if (!api_base.api) {
            this.addLog('Deriv connection not ready — please log in first.', 'error');
            this.onStatus('error');
            return;
        }
        if (!api_base.is_authorized) {
            this.addLog('Not authorized — log in to your Deriv account first.', 'error');
            this.onStatus('error');
            return;
        }

        this.isRunning    = true;
        this.tradingMode  = 0;
        this.currentStake = this.config.initialStake;
        this.lossCount    = 1;
        this.totalProfit  = 0;
        this.wins         = 0;
        this.losses       = 0;
        this.buyInFlight  = false;
        this.openContracts.clear();
        this.tickSubId    = null;
        this.myReqIds     = new Set();
        this.lastTickQuote = -1;

        if (this.stores) {
            const runId = `v2-run-${Date.now()}`;
            this.stores.setRunId(runId);
            this.stores.summary_card.clear();
            this.stores.run_panel.setIsRunning(true);
            this.stores.run_panel.toggleDrawer(true);
            this.stores.run_panel.setContractStage(1);
        }

        this.msgSub = (api_base.api as any).onMessage().subscribe((raw: any) => {
            try {
                const msg = raw?.data ? JSON.parse(raw.data) : raw;
                this.handle(msg);
            } catch { /* ignore */ }
        });

        this.onStatus('scanning');
        this.addLog('⚡ V2 Engine started — overlapping contract mode active', 'system');
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning = false;

        if (this.tickSubId) {
            this.rawSend({ forget: this.tickSubId });
            this.tickSubId = null;
        }
        // Forget all open contract subscriptions
        this.openContracts.forEach(c => {
            if (c.subId) this.rawSend({ forget: c.subId });
        });
        this.openContracts.clear();

        this.msgSub?.unsubscribe();
        this.msgSub = null;

        if (this.stores) {
            this.stores.run_panel.setIsRunning(false);
            this.stores.run_panel.setContractStage(0);
            this.stores.run_panel.setHasOpenContract(false);
        }

        this.onStatus('stopped');
        this.addLog('Engine stopped.', 'system');
    }

    // ── Private — sending ─────────────────────────────────────────────────────

    private send(payload: Record<string, unknown>): number {
        const reqId = this.reqBase + (++this.reqCounter);
        this.myReqIds.add(reqId);
        this.rawSend({ req_id: reqId, ...payload });
        return reqId;
    }

    private rawSend(payload: Record<string, unknown>): void {
        try { (api_base.api as any).send(payload); } catch { /* ignore */ }
    }

    // ── Private — message routing ─────────────────────────────────────────────

    private handle(msg: Record<string, any>): void {
        if (!this.isRunning || !msg) return;

        const subId = msg?.subscription?.id as string | undefined;
        const reqId = msg?.req_id            as number | undefined;

        const isMyReq     = reqId !== undefined && this.myReqIds.has(reqId);
        const isMyTickSub = subId !== undefined && subId === this.tickSubId;
        // A contract update belongs to us if its subscription id is in any open contract
        const isMyContract = subId !== undefined &&
            [...this.openContracts.values()].some(c => c.subId === subId);

        if (!isMyReq && !isMyTickSub && !isMyContract) return;

        if (msg.error) {
            this.addLog(`API error: ${msg.error.message}`, 'error');
            this.stores?.journal.onError(msg.error.message);
            if (msg.msg_type === 'buy') this.buyInFlight = false;
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy, subId);
                break;
            case 'proposal_open_contract':
                this.handleContract(msg.proposal_open_contract, subId);
                break;
        }
    }

    // ── Private — tick processing ─────────────────────────────────────────────

    private subscribeTicks(): void {
        this.addLog(`Subscribing to ${this.config.symbol} ticks…`, 'system');
        this.send({ ticks: this.config.symbol, subscribe: 1 });
    }

    private handleTick(tick: { quote: number } | undefined): void {
        if (!tick) return;

        const quote = tick.quote;
        const digit = this.lastDigit(quote);

        if (this.tradingMode === 0) {
            // ── Scanning: wait for entry-point digit ──────────────────────────
            this.addLog(`Digit: ${digit}  |  Waiting for entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.tradingMode = 1;
                this.addLog('Entry point hit — V2 continuous trading started ⚡', 'info');
                this.lastTickQuote = quote;
                this.buy();
            }
        } else {
            // ── Trading: buy on EVERY new tick — no settlement gate ───────────
            // Only skip if a buy request is literally in-flight (sent, not yet acked)
            // OR if this is the same tick quote we already acted on (debounce).
            if (!this.buyInFlight && quote !== this.lastTickQuote) {
                this.lastTickQuote = quote;
                this.buy();
            }
        }
    }

    // ── Private — contract execution ──────────────────────────────────────────

    private buy(): void {
        if (!this.isRunning) return;

        // Brief in-flight lock — released on buy ack (not on settlement)
        this.buyInFlight = true;

        if (this.stores) {
            this.stores.run_panel.setContractStage(3); // PURCHASE_SENT
        }

        const stake = this.currentStake;
        const ct    = this.resolveContractType();

        const params: Record<string, unknown> = {
            amount:        stake,
            basis:         'stake',
            contract_type: ct,
            currency:      'USD',
            duration:      1,
            duration_unit: 't',
            symbol:        this.config.symbol,
        };
        if (ct === 'DIGITMATCH' || ct === 'DIGITDIFF') {
            params.prediction = this.config.prediction ?? this.config.entryPoint;
        }
        if (ct === 'DIGITOVER' || ct === 'DIGITUNDER') {
            params.barrier = String(this.config.barrier ?? this.config.entryPoint);
        }

        this.addLog(`⚡ Buying ${ct}  stake $${stake.toFixed(2)}  (${this.openContracts.size} open)`, 'info');
        this.send({ buy: 1, price: stake, parameters: params });
    }

    private handleBuyAck(buy: Record<string, any> | undefined, _subId: string | undefined): void {
        // Release the brief in-flight lock immediately ─ the NEXT tick can now buy
        this.buyInFlight = false;

        if (!buy) {
            this.addLog('Buy failed — no contract returned', 'error');
            this.stores?.run_panel.setContractStage(0);
            return;
        }

        const contractId = String(buy.contract_id);

        // Track this contract with the stake that was used
        const entry: OpenContract = {
            contractId,
            stake:  this.currentStake,
            subId:  null,
        };
        this.openContracts.set(contractId, entry);

        this.addLog(`Contract #${contractId} opened  (${this.openContracts.size} concurrent)`, 'info');

        if (this.stores) {
            this.stores.run_panel.setContractStage(4); // PURCHASE_RECEIVED
            this.stores.run_panel.setHasOpenContract(true);
        }

        // Subscribe for settlement — save the subscription id
        this.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
    }

    private handleContract(poc: Record<string, any> | undefined, subId: string | undefined): void {
        if (!poc?.is_sold) {
            // Update the subId on the first (non-sold) update so we can forget it later
            if (poc?.contract_id && subId) {
                const id  = String(poc.contract_id);
                const rec = this.openContracts.get(id);
                if (rec && !rec.subId) {
                    rec.subId = subId;
                }
            }
            return;
        }

        const contractId = String(poc.contract_id);
        const rec        = this.openContracts.get(contractId);

        // Clean up subscription
        const effSubId = subId ?? rec?.subId ?? null;
        if (effSubId) this.rawSend({ forget: effSubId });
        this.openContracts.delete(contractId);

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = poc.status === 'won';
        this.totalProfit += profit;

        // ── Feed into DBot stores ──
        if (this.stores) {
            this.stores.transactions.onBotContractEvent(poc);
            this.stores.summary_card.onBotContractEvent(poc);
            this.stores.journal.onLogSuccess({
                log_type: isWin ? 'profit' : 'lost',
                extra:    { currency: poc.currency ?? 'USD', profit },
            });
            if (this.openContracts.size === 0) {
                this.stores.run_panel.setHasOpenContract(false);
                this.stores.run_panel.setContractStage(6); // CONTRACT_CLOSED
            }
        }

        // ── Update martingale stake for subsequent buys ──
        if (isWin) {
            this.wins++;
            this.addLog(`WIN  +$${Math.abs(profit).toFixed(2)}  |  P&L: ${this.pnlStr()}  |  open: ${this.openContracts.size}`, 'win');
            this.currentStake = this.config.initialStake;
            this.lossCount    = 1;

            if (this.totalProfit >= this.config.takeProfit) {
                this.addLog(`Take Profit $${this.config.takeProfit.toFixed(2)} reached — stopping`, 'system');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop();
                return;
            }
        } else {
            this.losses++;
            this.addLog(`LOSS -$${Math.abs(profit).toFixed(2)}  |  P&L: ${this.pnlStr()}  |  open: ${this.openContracts.size}`, 'loss');

            if (this.totalProfit <= -this.config.stopLoss) {
                this.addLog(`Stop Loss $${this.config.stopLoss.toFixed(2)} reached — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop();
                return;
            }
            if (this.lossCount >= this.config.martingaleLevel) {
                this.addLog(`Max ${this.config.martingaleLevel} consecutive losses — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop();
                return;
            }

            this.currentStake = parseFloat((this.currentStake * this.config.martingale).toFixed(2));
            this.lossCount++;
        }

        this.onProfit(this.totalProfit, this.wins, this.losses);
        this.onStatus('trading');
    }

    // ── Private — helpers ─────────────────────────────────────────────────────

    private resolveContractType(): string {
        const { contractKind, direction } = this.config;
        if (contractKind === 'DIGITEVEN' || contractKind === 'DIGITODD') {
            return direction === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';
        }
        if (contractKind === 'DIGITOVER' || contractKind === 'DIGITUNDER') {
            return direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
        }
        return contractKind;
    }

    private lastDigit(quote: number): number {
        const s = quote.toString().replace(/^.*\./, '');
        return parseInt(s[s.length - 1] ?? '0', 10);
    }

    private pnlStr(): string {
        const sign = this.totalProfit >= 0 ? '+' : '';
        return `${sign}$${this.totalProfit.toFixed(2)}`;
    }

    private addLog(message: string, type: EngineLogType): void {
        const now  = new Date();
        const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => n.toString().padStart(2, '0')).join(':');
        this.onLog({ time, message, type });
    }
}
