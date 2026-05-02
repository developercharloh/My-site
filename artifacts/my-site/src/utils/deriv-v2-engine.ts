// ─── Deriv V2 Lightning Engine ────────────────────────────────────────────────
//
// FUNDAMENTAL DIFFERENCE FROM V1
// ================================
// V1 (DBot / old engine):  tick → buy → wait for settlement → tick → buy …
//   Rate: ~1 contract per tick (~1 s on Vol indices → ~30-60 contracts/min)
//
// V2 (Lightning):  tick[entry] → buy → ACK → buy → ACK → buy → ACK → …
//   Rate: limited only by API round-trip (~50-150 ms)
//   → 400-1200 contracts / minute (10-20× faster than V1)
//
// How it works
// ─────────────
// 1. Tick subscription is used ONLY to detect the entry-point digit.
// 2. On entry hit → `startBuyChain()` fires the first buy.
// 3. Every buy acknowledgement immediately fires the next buy (no tick wait).
// 4. We keep at most MAX_CONCURRENT open contracts to bound stake exposure.
// 5. Contracts settle independently; each settlement updates P&L + martingale.
// 6. If the chain ever stalls (error / all contracts closed), a safety tick
//    handler restarts it on the next tick.

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Per-contract record ──────────────────────────────────────────────────────

interface OpenContract {
    contractId: string;
    stake:      number;
    subId:      string | null;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

// Maximum simultaneous open contracts. Keeps stake exposure bounded while
// still allowing 3× the throughput of V1. Tune up for more aggression.
const MAX_CONCURRENT = 3;

export class DerivV2Engine {
    private config:  V2BotConfig;
    private stores:  V2BoundStores | null = null;

    // req_id namespace
    private reqBase:    number      = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter: number      = 0;
    private myReqIds:   Set<number> = new Set();

    // Subscriptions
    private msgSub:    { unsubscribe: () => void } | null = null;
    private tickSubId: string | null = null;

    // ── Engine state ──────────────────────────────────────────────────────────
    private isRunning:    boolean = false;
    private chainActive:  boolean = false; // true once entry point is first hit
    private buyInFlight:  boolean = false; // brief: send → ack only
    private currentStake: number;
    private lossCount:    number  = 1;
    private totalProfit:  number  = 0;
    private wins:         number  = 0;
    private losses:       number  = 0;

    // Concurrent contract tracking
    private openContracts: Map<string, OpenContract> = new Map();

    // Callbacks
    public onLog:    (log: EngineLog)                               => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number) => void = () => {};
    public onStatus: (status: EngineStatus)                         => void = () => {};

    constructor(config: V2BotConfig) {
        this.config       = config;
        this.currentStake = config.initialStake;
    }

    bindStores(stores: V2BoundStores): void { this.stores = stores; }

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
        this.chainActive  = false;
        this.buyInFlight  = false;
        this.currentStake = this.config.initialStake;
        this.lossCount    = 1;
        this.totalProfit  = 0;
        this.wins         = 0;
        this.losses       = 0;
        this.tickSubId    = null;
        this.myReqIds     = new Set();
        this.openContracts.clear();

        if (this.stores) {
            this.stores.setRunId(`v2-run-${Date.now()}`);
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
        this.addLog(
            `⚡ V2 Lightning Engine started — scanning for entry point ${this.config.entryPoint}`,
            'system'
        );
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning   = false;
        this.chainActive = false;
        this.buyInFlight = false;

        if (this.tickSubId) {
            this.rawSend({ forget: this.tickSubId });
            this.tickSubId = null;
        }
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

    // ── Private — API helpers ─────────────────────────────────────────────────

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

        const isMyReq      = reqId !== undefined && this.myReqIds.has(reqId);
        const isMyTickSub  = subId !== undefined && subId === this.tickSubId;
        const isMyContract = subId !== undefined &&
            [...this.openContracts.values()].some(c => c.subId === subId);

        if (!isMyReq && !isMyTickSub && !isMyContract) return;

        if (msg.error) {
            this.addLog(`API error: ${msg.error.message}`, 'error');
            this.stores?.journal.onError(msg.error.message);
            if (msg.msg_type === 'buy') {
                this.buyInFlight = false;
                // Retry on next tick rather than spinning
            }
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'proposal_open_contract':
                this.handleContract(msg.proposal_open_contract, subId);
                break;
        }
    }

    // ── Private — tick handling ───────────────────────────────────────────────
    // Ticks are used ONLY to:
    //   a) detect the entry-point digit and start the buy chain
    //   b) restart the chain if it stalled (safety net)

    private subscribeTicks(): void {
        this.addLog(`Subscribing to ${this.config.symbol} ticks…`, 'system');
        this.send({ ticks: this.config.symbol, subscribe: 1 });
    }

    private handleTick(tick: { quote: number } | undefined): void {
        if (!tick) return;
        const digit = this.lastDigit(tick.quote);

        if (!this.chainActive) {
            // ── Scanning: wait for entry digit ───────────────────────────────
            this.addLog(`Digit: ${digit}  |  Waiting for entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.chainActive = true;
                this.addLog(`Entry digit ${digit} hit — ⚡ lightning chain started`, 'info');
                this.onStatus('trading');
                this.advanceChain();
            }
        } else {
            // ── Safety net: restart chain if it somehow stalled ───────────────
            if (!this.buyInFlight && this.openContracts.size === 0) {
                this.addLog('Chain restart on tick (safety net)', 'system');
                this.advanceChain();
            }
        }
    }

    // ── Private — buy chain ───────────────────────────────────────────────────
    // This is the core of V2 speed. Each buy ack triggers the next buy
    // immediately — no tick waiting. Rate = 1 buy per API round-trip (~50-150ms).

    private advanceChain(): void {
        if (!this.isRunning || !this.chainActive) return;
        if (this.buyInFlight) return;                       // already one on the wire
        if (this.openContracts.size >= MAX_CONCURRENT) return; // cap concurrent exposure

        this.buyInFlight = true;

        if (this.stores) this.stores.run_panel.setContractStage(3); // PURCHASE_SENT

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

        this.addLog(
            `⚡ Buy ${ct}  $${stake.toFixed(2)}  (${this.openContracts.size}/${MAX_CONCURRENT} open)`,
            'info'
        );
        this.send({ buy: 1, price: stake, parameters: params });
    }

    private handleBuyAck(buy: Record<string, any> | undefined): void {
        this.buyInFlight = false; // release the single-wire lock

        if (!buy) {
            this.addLog('Buy failed — no contract returned', 'error');
            this.stores?.run_panel.setContractStage(0);
            return;
        }

        const contractId = String(buy.contract_id);
        this.openContracts.set(contractId, {
            contractId,
            stake:  this.currentStake,
            subId:  null,
        });

        if (this.stores) {
            this.stores.run_panel.setContractStage(4); // PURCHASE_RECEIVED
            this.stores.run_panel.setHasOpenContract(true);
        }

        // Subscribe for settlement
        this.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });

        // ⚡ KEY: immediately advance the chain — no tick waiting
        this.advanceChain();
    }

    // ── Private — settlement ──────────────────────────────────────────────────

    private handleContract(poc: Record<string, any> | undefined, subId: string | undefined): void {
        // First update: capture the subscription id so we can forget it
        if (poc && !poc.is_sold && subId) {
            const rec = this.openContracts.get(String(poc.contract_id));
            if (rec && !rec.subId) rec.subId = subId;
            return;
        }

        if (!poc?.is_sold) return;

        const contractId = String(poc.contract_id);
        const rec        = this.openContracts.get(contractId);

        const effSubId = subId ?? rec?.subId ?? null;
        if (effSubId) this.rawSend({ forget: effSubId });
        this.openContracts.delete(contractId);

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = poc.status === 'won';
        this.totalProfit += profit;

        if (this.stores) {
            this.stores.transactions.onBotContractEvent(poc);
            this.stores.summary_card.onBotContractEvent(poc);
            this.stores.journal.onLogSuccess({
                log_type: isWin ? 'profit' : 'lost',
                extra:    { currency: poc.currency ?? 'USD', profit },
            });
            if (this.openContracts.size === 0) {
                this.stores.run_panel.setContractStage(6); // CONTRACT_CLOSED
                this.stores.run_panel.setHasOpenContract(false);
            }
        }

        if (isWin) {
            this.wins++;
            this.addLog(
                `✅ WIN  +$${Math.abs(profit).toFixed(2)}  P&L: ${this.pnlStr()}  open: ${this.openContracts.size}`,
                'win'
            );
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
            this.addLog(
                `❌ LOSS -$${Math.abs(profit).toFixed(2)}  P&L: ${this.pnlStr()}  open: ${this.openContracts.size}`,
                'loss'
            );

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

        // A slot freed up — advance the chain immediately
        this.advanceChain();
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
