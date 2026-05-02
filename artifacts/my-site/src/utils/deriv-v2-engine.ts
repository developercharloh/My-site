// ─── Deriv V2 Lightning Engine ────────────────────────────────────────────────
//
// Why V2 beats V1
// ───────────────
// V1 (DBot):  tick → buy → wait settlement → tick → buy …  (~1/s on Vol indices)
// V2:  proposal → buy → ACK → proposal → buy → ACK …        (~5-10/s)
//
// Key technique: proposal+buy pipeline
// ─────────────────────────────────────
// Each buy uses a pre-validated unique `proposal_id` rather than raw parameters.
// This prevents the API's duplicate-purchase guard from firing (raw params within
// the same tick window look identical → API rejects the second one).
//
// Pipeline:
//   advanceChain() → fetchProposal()
//     proposal arrives → buyFromProposal(id)
//       buy ack → track contract + fetchProposal() immediately (no tick wait)
//         next proposal arrives → buyFromProposal() again …
//
// Contracts settle independently. Martingale stake is updated on each settlement.
// Chain stall safety: tick handler restarts the pipeline if it dies.

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

// ─── Store binding ────────────────────────────────────────────────────────────

export interface V2BoundStores {
    run_panel: {
        setIsRunning:      (v: boolean)    => void;
        setContractStage:  (stage: number) => void;
        setHasOpenContract:(v: boolean)    => void;
        toggleDrawer:      (open: boolean) => void;
    };
    transactions: { onBotContractEvent: (data: any) => void; };
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

// ─── Internal records ─────────────────────────────────────────────────────────

interface OpenContract {
    contractId: string;
    stake:      number;
    subId:      string | null;
}

// Maximum simultaneous open contracts. Keep small to bound exposure.
const MAX_CONCURRENT    = 3;
// Minimum ms between consecutive buy sends (avoids burst rate-limiting).
const MIN_BUY_INTERVAL  = 120;
// Delay before retrying after a buy error.
const BUY_RETRY_DELAY   = 300;
// Maximum retry attempts per chain step before giving up for that tick.
const MAX_BUY_RETRIES   = 3;

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DerivV2Engine {
    private config:  V2BotConfig;
    private stores:  V2BoundStores | null = null;

    private reqBase:    number      = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter: number      = 0;
    private myReqIds:   Map<number, string> = new Map(); // reqId → msg_type hint

    private msgSub:    { unsubscribe: () => void } | null = null;
    private tickSubId: string | null = null;

    // ── Engine state ──────────────────────────────────────────────────────────
    private isRunning:     boolean = false;
    private chainActive:   boolean = false;
    private currentStake:  number;
    private lossCount:     number  = 1;
    private totalProfit:   number  = 0;
    private wins:          number  = 0;
    private losses:        number  = 0;

    // ── Proposal pipeline ─────────────────────────────────────────────────────
    // At most one proposal request is in-flight at a time.
    private proposalInFlight:  boolean               = false;
    private pendingProposal:   { id: string; price: number } | null = null;
    // Buy serialisation
    private buyInFlight:       boolean               = false;
    private buyRetries:        number                = 0;
    private lastBuyAt:         number                = 0; // timestamp

    // ── Concurrent contract tracking ──────────────────────────────────────────
    private openContracts: Map<string, OpenContract> = new Map();

    // ── POC request → contract id mapping ────────────────────────────────────
    private pocReqToContract: Map<number, string>    = new Map();

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
            this.onStatus('error'); return;
        }
        if (!api_base.is_authorized) {
            this.addLog('Not authorized — log in to your Deriv account first.', 'error');
            this.onStatus('error'); return;
        }

        this.isRunning          = true;
        this.chainActive        = false;
        this.proposalInFlight   = false;
        this.pendingProposal    = null;
        this.buyInFlight        = false;
        this.buyRetries         = 0;
        this.lastBuyAt          = 0;
        this.currentStake       = this.config.initialStake;
        this.lossCount          = 1;
        this.totalProfit        = 0;
        this.wins               = 0;
        this.losses             = 0;
        this.tickSubId          = null;
        this.myReqIds.clear();
        this.openContracts.clear();
        this.pocReqToContract.clear();

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
            `⚡ V2 Lightning Engine started — scanning for entry ${this.config.entryPoint} on ${this.config.symbol}`,
            'system'
        );
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning        = false;
        this.chainActive      = false;
        this.proposalInFlight = false;
        this.buyInFlight      = false;
        this.pendingProposal  = null;

        if (this.tickSubId) { this.rawSend({ forget: this.tickSubId }); this.tickSubId = null; }
        this.openContracts.forEach(c => { if (c.subId) this.rawSend({ forget: c.subId }); });
        this.openContracts.clear();
        this.pocReqToContract.clear();

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

    private send(payload: Record<string, unknown>, hint = ''): number {
        const reqId = this.reqBase + (++this.reqCounter);
        this.myReqIds.set(reqId, hint);
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

        // ── Error handling ────────────────────────────────────────────────────
        if (msg.error) {
            const errMsg = msg.error.message ?? 'Unknown error';
            this.addLog(`API error [${msg.msg_type}]: ${errMsg}`, 'error');
            this.stores?.journal.onError(errMsg);

            switch (msg.msg_type) {
                case 'proposal':
                    this.proposalInFlight = false;
                    // Retry proposal after a short delay
                    setTimeout(() => this.advanceChain(), BUY_RETRY_DELAY);
                    break;
                case 'buy':
                    this.buyInFlight  = false;
                    this.pendingProposal = null; // proposal was consumed; fetch fresh one
                    this.buyRetries++;
                    if (this.buyRetries <= MAX_BUY_RETRIES) {
                        this.addLog(`Buy rejected — retrying in ${BUY_RETRY_DELAY * this.buyRetries}ms`, 'system');
                        setTimeout(() => this.advanceChain(), BUY_RETRY_DELAY * this.buyRetries);
                    } else {
                        this.addLog('Max retries reached — waiting for next tick', 'system');
                        this.buyRetries = 0;
                    }
                    break;
            }
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'proposal':
                this.handleProposal(msg.proposal, reqId);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'proposal_open_contract':
                this.handleContract(msg.proposal_open_contract, subId, reqId);
                break;
        }
    }

    // ── Private — tick handling ───────────────────────────────────────────────
    // ONLY role: detect entry point (scan mode) + safety restart if chain stalls.

    private subscribeTicks(): void {
        this.addLog(`Subscribing to ${this.config.symbol} ticks…`, 'system');
        this.send({ ticks: this.config.symbol, subscribe: 1 }, 'tick_sub');
    }

    private handleTick(tick: { quote: number } | undefined): void {
        if (!tick) return;
        const digit = this.lastDigit(tick.quote);

        if (!this.chainActive) {
            this.addLog(`Digit: ${digit}  |  Waiting for entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.chainActive = true;
                this.buyRetries  = 0;
                this.addLog(`Entry digit ${digit} hit — ⚡ pipeline started`, 'info');
                this.onStatus('trading');
                this.advanceChain();
            }
        } else {
            // Safety restart: if pipeline died, the next tick will revive it
            if (!this.proposalInFlight && !this.buyInFlight &&
                !this.pendingProposal   && this.openContracts.size === 0) {
                this.addLog('Pipeline restart on tick (safety net)', 'system');
                this.buyRetries = 0;
                this.advanceChain();
            }
        }
    }

    // ── Private — proposal pipeline ───────────────────────────────────────────

    /**
     * Main chain driver. Called after:
     *  - Entry point hit (first call)
     *  - Buy ack (immediately after ack)
     *  - Contract settlement (slot freed)
     *  - Error retry (after delay)
     *  - Tick safety restart
     */
    private advanceChain(): void {
        if (!this.isRunning || !this.chainActive) return;
        if (this.openContracts.size >= MAX_CONCURRENT)  return; // slots full
        if (this.buyInFlight)                            return; // buy on the wire
        if (this.proposalInFlight)                       return; // proposal on the wire

        // If we have a ready proposal, use it right away
        if (this.pendingProposal) {
            this.buyFromProposal(this.pendingProposal);
            return;
        }

        // Otherwise fetch a fresh proposal
        this.fetchProposal();
    }

    private fetchProposal(): void {
        if (!this.isRunning || this.proposalInFlight) return;
        this.proposalInFlight = true;

        const ct = this.resolveContractType();
        const params: Record<string, unknown> = {
            proposal:      1,
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

        this.send(params, 'proposal');
    }

    private handleProposal(proposal: Record<string, any> | undefined, _reqId: number | undefined): void {
        this.proposalInFlight = false;

        if (!proposal?.id) {
            this.addLog('Proposal returned no id — retrying', 'error');
            setTimeout(() => this.advanceChain(), BUY_RETRY_DELAY);
            return;
        }

        const id    = String(proposal.id);
        const price = parseFloat(proposal.ask_price ?? this.currentStake);
        this.pendingProposal = { id, price };

        // Buy immediately if a slot is open and no buy is in-flight
        if (!this.buyInFlight && this.openContracts.size < MAX_CONCURRENT) {
            this.buyFromProposal(this.pendingProposal);
        }
    }

    private buyFromProposal(p: { id: string; price: number }): void {
        if (!this.isRunning || this.buyInFlight) return;
        if (this.openContracts.size >= MAX_CONCURRENT) return;

        const now = Date.now();
        const wait = MIN_BUY_INTERVAL - (now - this.lastBuyAt);
        if (wait > 0) {
            // Respect minimum interval to avoid burst rate-limiting
            setTimeout(() => {
                if (this.pendingProposal?.id === p.id) this.buyFromProposal(p);
            }, wait);
            return;
        }

        this.pendingProposal = null;
        this.buyInFlight     = true;
        this.lastBuyAt       = now;

        if (this.stores) this.stores.run_panel.setContractStage(3); // PURCHASE_SENT

        this.addLog(
            `⚡ Buy proposal ${p.id.slice(-6)}  $${this.currentStake.toFixed(2)}  (${this.openContracts.size}/${MAX_CONCURRENT} open)`,
            'info'
        );

        // Buy by proposal id — unique per request, API cannot flag as duplicate
        this.send({ buy: p.id, price: p.price }, 'buy');
    }

    // ── Private — buy acknowledgement ─────────────────────────────────────────

    private handleBuyAck(buy: Record<string, any> | undefined): void {
        this.buyInFlight = false;
        this.buyRetries  = 0; // successful buy resets retry counter

        if (!buy) {
            this.addLog('Buy ack missing contract — retrying', 'error');
            setTimeout(() => this.advanceChain(), BUY_RETRY_DELAY);
            return;
        }

        const contractId = String(buy.contract_id);
        this.openContracts.set(contractId, { contractId, stake: this.currentStake, subId: null });

        if (this.stores) {
            this.stores.run_panel.setContractStage(4); // PURCHASE_RECEIVED
            this.stores.run_panel.setHasOpenContract(true);
        }

        // Subscribe for settlement, map req_id so we can route the first response
        const pocReqId = this.send(
            { proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 },
            'poc'
        );
        this.pocReqToContract.set(pocReqId, contractId);

        // ⚡ Immediately advance the chain — contract A is open, start B now
        this.advanceChain();
    }

    // ── Private — settlement ──────────────────────────────────────────────────

    private handleContract(
        poc:   Record<string, any> | undefined,
        subId: string | undefined,
        reqId: number | undefined,
    ): void {
        if (!poc) return;

        const contractId = String(poc.contract_id);

        // Map req_id → contract on first (unsold) push and capture subscription id
        if (reqId !== undefined && this.pocReqToContract.has(reqId)) {
            this.pocReqToContract.delete(reqId);
        }
        const rec = this.openContracts.get(contractId);
        if (rec && subId && !rec.subId) rec.subId = subId;

        if (!poc.is_sold) return; // not settled yet

        // Clean up
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
                this.stores.run_panel.setContractStage(6);
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
                this.stop(); return;
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
                this.stop(); return;
            }
            if (this.lossCount >= this.config.martingaleLevel) {
                this.addLog(`Max ${this.config.martingaleLevel} consecutive losses — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop(); return;
            }
            this.currentStake = parseFloat((this.currentStake * this.config.martingale).toFixed(2));
            this.lossCount++;
        }

        this.onProfit(this.totalProfit, this.wins, this.losses);

        // Slot freed — advance the chain immediately
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
