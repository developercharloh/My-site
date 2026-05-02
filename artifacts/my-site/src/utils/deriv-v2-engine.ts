// ─── Deriv V2 Direct Engine ───────────────────────────────────────────────────
// Uses the app's existing authenticated Deriv connection (api_base).
// No new WebSocket, no token prompt — same session as DBot.
// When bindStores() is called it feeds every event into DBot's own run-panel
// stores so Summary / Transactions / Journal all populate normally.

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
// Matches the shape of DBot's MobX stores so the engine can feed the run panel.

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
    /** Wrap in runInAction from the caller side since the engine has no MobX dep. */
    setRunId: (id: string) => void;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DerivV2Engine {
    private config:              V2BotConfig;
    private stores:              V2BoundStores | null = null;

    // req_id namespace — avoid collision with DBot's own req_ids
    private reqBase:             number = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter:          number = 0;
    private myReqIds:            Set<number> = new Set();

    // Subscriptions
    private msgSub:              { unsubscribe: () => void } | null = null;
    private tickSubId:           string | null = null;
    private contractSubIds:      Set<string>   = new Set();

    // Trading state
    private isRunning:           boolean = false;
    private waitingForContract:  boolean = false;
    private tradingMode:         0 | 1   = 0;
    private currentStake:        number;
    private lossCount:           number  = 1;
    private totalProfit:         number  = 0;
    private wins:                number  = 0;
    private losses:              number  = 0;

    // Local callbacks (used by V2EngineModal; also called when stores are bound)
    public onLog:    (log: EngineLog)                              => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number) => void = () => {};
    public onStatus: (status: EngineStatus)                        => void = () => {};

    constructor(config: V2BotConfig) {
        this.config       = config;
        this.currentStake = config.initialStake;
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /** Bind DBot's MobX stores so all events feed into the run-panel UI. */
    bindStores(stores: V2BoundStores): void {
        this.stores = stores;
    }

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

        this.isRunning          = true;
        this.tradingMode        = 0;
        this.currentStake       = this.config.initialStake;
        this.lossCount          = 1;
        this.totalProfit        = 0;
        this.wins               = 0;
        this.losses             = 0;
        this.waitingForContract = false;
        this.tickSubId          = null;
        this.contractSubIds     = new Set();
        this.myReqIds           = new Set();

        // ── Bind to DBot run panel stores ──
        if (this.stores) {
            const runId = `v2-run-${Date.now()}`;
            this.stores.setRunId(runId);
            this.stores.summary_card.clear();
            this.stores.run_panel.setIsRunning(true);
            this.stores.run_panel.toggleDrawer(true);
            this.stores.run_panel.setContractStage(1); // STARTING
        }

        // Subscribe to the global message stream from the existing connection
        this.msgSub = (api_base.api as any).onMessage().subscribe((raw: any) => {
            try {
                const msg = raw?.data ? JSON.parse(raw.data) : raw;
                this.handle(msg);
            } catch { /* ignore */ }
        });

        this.onStatus('scanning');
        this.addLog('V2 Engine started — using existing Deriv session', 'system');
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning = false;

        if (this.tickSubId) {
            this.rawSend({ forget: this.tickSubId });
            this.tickSubId = null;
        }
        this.contractSubIds.forEach(id => this.rawSend({ forget: id }));
        this.contractSubIds.clear();

        this.msgSub?.unsubscribe();
        this.msgSub = null;

        // ── Release run panel stores ──
        if (this.stores) {
            this.stores.run_panel.setIsRunning(false);
            this.stores.run_panel.setContractStage(0); // NOT_RUNNING
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

        const isMyReq      = reqId !== undefined && this.myReqIds.has(reqId);
        const isMyTickSub  = subId !== undefined && subId === this.tickSubId;
        const isMyContract = subId !== undefined && this.contractSubIds.has(subId);

        if (!isMyReq && !isMyTickSub && !isMyContract) return;

        if (msg.error) {
            this.addLog(`API error: ${msg.error.message}`, 'error');
            this.stores?.journal.onError(msg.error.message);
            if (msg.msg_type === 'buy') this.waitingForContract = false;
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                if (!this.waitingForContract) this.handleTick(msg.tick);
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
        const digit = this.lastDigit(tick.quote);

        if (this.tradingMode === 0) {
            this.addLog(`Digit: ${digit}  |  Waiting for entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.tradingMode = 1;
                this.addLog('Entry point hit — buying contract immediately', 'info');
                this.buy();
            }
        }
    }

    // ── Private — contract execution ──────────────────────────────────────────

    private buy(): void {
        if (!this.isRunning) return;
        this.waitingForContract = true;

        // Signal PURCHASE_SENT to run panel
        if (this.stores) {
            this.stores.run_panel.setContractStage(3); // PURCHASE_SENT
        }

        const ct = this.resolveContractType();
        const params: Record<string, unknown> = {
            amount:        this.currentStake,
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

        this.addLog(`Buying ${ct}  stake $${this.currentStake.toFixed(2)}`, 'info');
        this.send({ buy: 1, price: this.currentStake, parameters: params });
    }

    private handleBuyAck(buy: Record<string, any> | undefined, subId: string | undefined): void {
        if (!buy) {
            this.addLog('Buy failed — no contract returned', 'error');
            this.waitingForContract = false;
            this.stores?.run_panel.setContractStage(0);
            return;
        }

        this.addLog(`Contract #${buy.contract_id} opened`, 'info');

        if (subId) this.contractSubIds.add(subId);

        // Signal PURCHASE_RECEIVED
        if (this.stores) {
            this.stores.run_panel.setContractStage(4); // PURCHASE_RECEIVED
            this.stores.run_panel.setHasOpenContract(true);
        }

        // Subscribe for settlement updates
        this.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
    }

    private handleContract(poc: Record<string, any> | undefined, subId: string | undefined): void {
        if (!poc?.is_sold) return;

        if (subId) {
            this.contractSubIds.delete(subId);
            this.rawSend({ forget: subId });
        }
        this.waitingForContract = false;

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = poc.status === 'won';
        this.totalProfit += profit;

        // ── Feed into DBot's run panel stores ──
        if (this.stores) {
            this.stores.transactions.onBotContractEvent(poc);
            this.stores.summary_card.onBotContractEvent(poc);
            this.stores.journal.onLogSuccess({
                log_type: isWin ? 'profit' : 'lost',
                extra:    { currency: poc.currency ?? 'USD', profit },
            });
            this.stores.run_panel.setContractStage(6); // CONTRACT_CLOSED
            this.stores.run_panel.setHasOpenContract(false);
        }

        if (isWin) {
            this.wins++;
            this.addLog(`WIN  +$${Math.abs(profit).toFixed(2)}  |  P&L: ${this.pnlStr()}`, 'win');
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
            this.addLog(`LOSS -$${Math.abs(profit).toFixed(2)}  |  P&L: ${this.pnlStr()}`, 'loss');

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

        // Re-buy IMMEDIATELY — no waiting for next tick
        if (this.isRunning) this.buy();
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
