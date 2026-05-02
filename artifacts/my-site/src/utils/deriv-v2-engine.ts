// ─── Deriv V2 Direct Engine ───────────────────────────────────────────────────
// Uses the app's existing authenticated Deriv connection (api_base) instead of
// creating a new WebSocket. No token required — same session as DBot.
// Bypasses DBot's Blockly/XML processing pipeline for faster execution.

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type EngineLogType = 'scan' | 'info' | 'win' | 'loss' | 'error' | 'system';

export interface EngineLog {
    time:    string;
    message: string;
    type:    EngineLogType;
}

export type EngineStatus =
    | 'idle'
    | 'connecting'
    | 'scanning'
    | 'trading'
    | 'stopped'
    | 'error';

export type ContractKind =
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITOVER'
    | 'DIGITUNDER';

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

export class DerivV2Engine {
    private config:              V2BotConfig;

    // Request tracking — use time-based prefix to avoid collision with DBot req_ids
    private reqBase:             number = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter:          number = 0;
    private myReqIds:            Set<number> = new Set();

    // Subscription tracking
    private msgSub:              { unsubscribe: () => void } | null = null;
    private tickSubId:           string | null = null;
    private contractSubIds:      Set<string> = new Set();

    // Trading state
    private isRunning:           boolean = false;
    private waitingForContract:  boolean = false;
    private tradingMode:         0 | 1 = 0;
    private currentStake:        number;
    private lossCount:           number = 1;
    private totalProfit:         number = 0;
    private wins:                number = 0;
    private losses:              number = 0;

    public onLog:    (log: EngineLog)                                     => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number)       => void = () => {};
    public onStatus: (status: EngineStatus)                               => void = () => {};

    constructor(config: V2BotConfig) {
        this.config       = config;
        this.currentStake = config.initialStake;
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

        // Subscribe to the global message stream
        this.msgSub = (api_base.api as any).onMessage().subscribe((raw: any) => {
            try {
                // DerivAPI delivers messages already parsed as objects
                const msg = raw?.data ? JSON.parse(raw.data) : raw;
                this.handle(msg);
            } catch { /* ignore parse errors */ }
        });

        this.onStatus('scanning');
        this.addLog('V2 Engine started — using existing session (no token needed)', 'system');
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning = false;

        // Forget the tick subscription
        if (this.tickSubId) {
            this.rawSend({ forget: this.tickSubId });
            this.tickSubId = null;
        }

        // Forget all open contract subscriptions
        this.contractSubIds.forEach(id => this.rawSend({ forget: id }));
        this.contractSubIds.clear();

        // Unsubscribe from message stream
        this.msgSub?.unsubscribe();
        this.msgSub = null;

        this.onStatus('stopped');
        this.addLog('Engine stopped.', 'system');
    }

    // ── Private — sending ─────────────────────────────────────────────────────

    /** Send via api_base, tracking the req_id as ours. */
    private send(payload: Record<string, unknown>): number {
        const reqId = this.reqBase + (++this.reqCounter);
        this.myReqIds.add(reqId);
        this.rawSend({ req_id: reqId, ...payload });
        return reqId;
    }

    /** Send without tracking (for forget/cleanup). */
    private rawSend(payload: Record<string, unknown>): void {
        try { (api_base.api as any).send(payload); } catch { /* ignore */ }
    }

    // ── Private — message routing ─────────────────────────────────────────────

    private handle(msg: Record<string, any>): void {
        if (!this.isRunning || !msg) return;

        const subId = msg?.subscription?.id as string | undefined;
        const reqId = msg?.req_id  as number | undefined;

        // Only process messages that belong to this engine instance
        const isMyReq      = reqId  !== undefined && this.myReqIds.has(reqId);
        const isMyTickSub  = subId  !== undefined && subId === this.tickSubId;
        const isMyContract = subId  !== undefined && this.contractSubIds.has(subId);

        if (!isMyReq && !isMyTickSub && !isMyContract) return;

        if (msg.error) {
            this.addLog(`API error: ${msg.error.message}`, 'error');
            if (msg.msg_type === 'buy') {
                this.waitingForContract = false;
            }
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                // Register subscription id on first tick response
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
        this.addLog(`Subscribing to ticks: ${this.config.symbol}`, 'system');
        this.send({ ticks: this.config.symbol, subscribe: 1 });
    }

    private handleTick(tick: { quote: number } | undefined): void {
        if (!tick) return;
        const digit = this.lastDigit(tick.quote);

        if (this.tradingMode === 0) {
            this.addLog(`Last digit: ${digit}  |  Entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.tradingMode = 1;
                this.addLog('Entry point hit — buying contract immediately', 'info');
                this.buy();
            }
        }
        // In trading mode, buys fire from contract settlement — not from ticks
    }

    // ── Private — contract execution ──────────────────────────────────────────

    private buy(): void {
        if (!this.isRunning) return;
        this.waitingForContract = true;

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
            return;
        }

        this.addLog(`Contract #${buy.contract_id} opened`, 'info');

        // Track subscription id for this open contract
        if (subId) this.contractSubIds.add(subId);

        // Also explicitly subscribe to proposal_open_contract for settlement
        this.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
    }

    private handleContract(poc: Record<string, any> | undefined, subId: string | undefined): void {
        if (!poc?.is_sold) return;  // Contract not settled yet

        // Remove this contract subscription
        if (subId) {
            this.contractSubIds.delete(subId);
            this.rawSend({ forget: subId });
        }

        this.waitingForContract = false;

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = poc.status === 'won';
        this.totalProfit += profit;

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

        // Re-buy IMMEDIATELY — no waiting for the next tick
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
            .map(n => n.toString().padStart(2, '0'))
            .join(':');
        this.onLog({ time, message, type });
    }
}
