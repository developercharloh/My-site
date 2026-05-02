// ─── Deriv V2 Lightning Engine ────────────────────────────────────────────────
//
// Core principle: EVERY tick = ONE buy. No tick is ever skipped.
//
// V1 behaviour (what this replaces):
//   Tick 1 → buy A → [waiting…] → A settles → Tick 4 → buy B
//   Ticks 2, 3 are completely wasted.
//
// V2 behaviour:
//   Tick 1 → buy A
//   Tick 2 → buy B  (A still open / settling in background)
//   Tick 3 → buy C  (A settled, B still open)
//   Tick 4 → buy D  …
//
// Every tick drives one buy. Settlements happen asynchronously and update
// P&L + martingale stake without ever blocking the next tick's buy.
//
// To avoid "duplicate purchase" API rejection, each buy uses a unique
// proposal_id obtained in advance. The next proposal is pre-fetched as soon
// as a buy ack is received so it is ready before the next tick arrives.

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EngineLogType = 'scan' | 'info' | 'win' | 'loss' | 'error' | 'system';
export interface EngineLog { seq: number; time: string; message: string; type: EngineLogType; }

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
    currency?:       string;
}

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
        onError:      (msg: string | Error)                   => void;
    };
    summary_card: {
        onBotContractEvent: (data: any) => void;
        clear:              ()           => void;
    };
    setRunId: (id: string) => void;
}

export interface TradeRecord {
    seq:           number;
    time:          string;
    contractLabel: string;     // human-readable: "OVER 5", "MATCH 3", "EVEN"
    entryPoint:    number;     // digit the engine scans for to start buying
    triggerDigit:  number;     // digit when this particular buy was placed
    exitDigit:     number | null; // last digit of the exit tick
    stake:         number;
    profit:        number;
    totalPnl:      number;     // cumulative P&L after this trade settles
    isWin:         boolean;
}

interface OpenContract { contractId: string; stake: number; subId: string | null; triggerDigit: number; }
interface ReadyProposal { id: string; price: number; }

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DerivV2Engine {
    private config:  V2BotConfig;
    private stores:  V2BoundStores | null = null;

    // log / trade sequence counters
    private logSeq:   number = 0;
    private tradeSeq: number = 0;

    // req namespace
    private reqBase:    number              = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter: number              = 0;
    private myReqIds:   Map<number, string> = new Map(); // reqId → type hint

    private msgSub:    { unsubscribe: () => void } | null = null;
    private tickSubId: string | null = null;

    // ── Trading state ─────────────────────────────────────────────────────────
    private isRunning:     boolean = false;
    private chainActive:   boolean = false;
    private lastTickDigit: number  = 0;
    private currentStake:  number;
    private lossCount:     number  = 1;
    private totalProfit:   number  = 0;
    private wins:          number  = 0;
    private losses:        number  = 0;

    // ── Proposal pre-fetch pipeline ───────────────────────────────────────────
    private readyProposal:    ReadyProposal | null = null;
    private proposalInflight: boolean              = false;
    private tickWaiting:      boolean              = false;

    // ── Buy serialisation ─────────────────────────────────────────────────────
    private buyInflight:    boolean = false;
    private lastBuyMs:      number  = 0;
    private readonly MIN_BUY_GAP = 100;

    // ── Open contract tracking ────────────────────────────────────────────────
    private openContracts:    Map<string, OpenContract> = new Map();
    private pocReqToContract: Map<number,  string>      = new Map();

    // Callbacks
    public onLog:    (log: EngineLog)                                        => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number, stake: number) => void = () => {};
    public onStatus: (status: EngineStatus)                                  => void = () => {};
    public onTrade:  (record: TradeRecord)                                   => void = () => {};

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

        this.isRunning         = true;
        this.chainActive       = false;
        this.lastTickDigit     = 0;
        this.readyProposal     = null;
        this.proposalInflight  = false;
        this.tickWaiting       = false;
        this.buyInflight       = false;
        this.lastBuyMs         = 0;
        this.currentStake      = this.config.initialStake;
        this.lossCount         = 1;
        this.totalProfit       = 0;
        this.wins              = 0;
        this.losses            = 0;
        this.tradeSeq          = 0;
        this.tickSubId         = null;
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
            const msg = raw?.data ?? raw;   // .data is already a parsed object
            this.handle(msg);
        });

        this.onStatus('scanning');
        this.addLog(
            `⚡ V2 Engine ready — scanning for entry digit ${this.config.entryPoint} on ${this.config.symbol}`,
            'system'
        );
        this.subscribeTicks();
    }

    stop(): void {
        this.isRunning        = false;
        this.chainActive      = false;
        this.proposalInflight = false;
        this.buyInflight      = false;
        this.tickWaiting      = false;
        this.readyProposal    = null;

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

    // ── Private — API ─────────────────────────────────────────────────────────

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

        if (msg.error) {
            const errMsg = msg.error.message ?? 'Unknown error';
            this.addLog(`API error [${msg.msg_type}]: ${errMsg}`, 'error');
            this.stores?.journal.onError(errMsg);

            if (msg.msg_type === 'proposal') {
                this.proposalInflight = false;
                setTimeout(() => this.fetchProposal(), 200);
            }
            if (msg.msg_type === 'buy') {
                this.buyInflight   = false;
                this.readyProposal = null;
                this.addLog('Buy rejected — fetching new proposal', 'system');
                this.fetchProposal();
            }
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'proposal':
                this.handleProposal(msg.proposal);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'proposal_open_contract':
                this.handleContract(msg.proposal_open_contract, subId, reqId);
                break;
        }
    }

    // ── Private — tick: the heartbeat of V2 ──────────────────────────────────

    private subscribeTicks(): void {
        this.addLog(`Subscribing to ${this.config.symbol} ticks…`, 'system');
        this.send({ ticks: this.config.symbol, subscribe: 1 }, 'tick_sub');
    }

    private handleTick(tick: { quote: number } | undefined): void {
        if (!tick) return;
        const digit = this.lastDigit(tick.quote);
        this.lastTickDigit = digit;

        if (!this.chainActive) {
            this.addLog(`Digit: ${digit}  |  Waiting for entry: ${this.config.entryPoint}`, 'scan');
            if (digit === this.config.entryPoint) {
                this.chainActive = true;
                this.addLog(`Entry ${digit} hit — ⚡ buying on every tick from now`, 'info');
                this.onStatus('trading');
                this.tradeOnTick();
            }
            return;
        }

        this.tradeOnTick();
    }

    private tradeOnTick(): void {
        if (!this.isRunning) return;

        if (this.readyProposal && !this.buyInflight) {
            this.executeBuy(this.readyProposal);
        } else {
            this.tickWaiting = true;
            if (!this.proposalInflight && !this.readyProposal) {
                this.fetchProposal();
            }
        }
    }

    // ── Private — proposal pipeline ───────────────────────────────────────────

    private fetchProposal(): void {
        if (!this.isRunning || this.proposalInflight) return;
        this.proposalInflight = true;

        const ct = this.resolveContractType();
        const params: Record<string, unknown> = {
            proposal:      1,
            amount:        this.currentStake,
            basis:         'stake',
            contract_type: ct,
            currency:      this.config.currency ?? 'USD',
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

    private handleProposal(proposal: Record<string, any> | undefined): void {
        this.proposalInflight = false;

        if (!proposal?.id) {
            this.addLog('Empty proposal — retrying', 'error');
            setTimeout(() => this.fetchProposal(), 200);
            return;
        }

        const ready: ReadyProposal = {
            id:    String(proposal.id),
            price: parseFloat(proposal.ask_price ?? this.currentStake),
        };

        if (this.tickWaiting && !this.buyInflight) {
            this.tickWaiting = false;
            this.executeBuy(ready);
        } else {
            this.readyProposal = ready;
        }
    }

    // ── Private — buy execution ───────────────────────────────────────────────

    private executeBuy(p: ReadyProposal): void {
        if (!this.isRunning || this.buyInflight) return;

        const now  = Date.now();
        const gap  = this.MIN_BUY_GAP - (now - this.lastBuyMs);
        if (gap > 0) {
            setTimeout(() => { if (this.isRunning) this.tradeOnTick(); }, gap);
            return;
        }

        this.readyProposal = null;
        this.buyInflight   = true;
        this.lastBuyMs     = now;
        this.tickWaiting   = false;

        if (this.stores) this.stores.run_panel.setContractStage(3);

        this.addLog(
            `⚡ Buy  $${this.currentStake.toFixed(2)}  digit:${this.lastTickDigit}  entry:${this.config.entryPoint}  (${this.openContracts.size} open)`,
            'info'
        );
        this.send({ buy: p.id, price: p.price }, 'buy');
    }

    // ── Private — buy acknowledgement ─────────────────────────────────────────

    private handleBuyAck(buy: Record<string, any> | undefined): void {
        this.buyInflight = false;

        if (!buy) {
            this.addLog('Buy ack missing contract — retrying', 'error');
            this.fetchProposal(); return;
        }

        const contractId = String(buy.contract_id);
        this.openContracts.set(contractId, {
            contractId,
            stake:        this.currentStake,
            subId:        null,
            triggerDigit: this.lastTickDigit,
        });

        if (this.stores) {
            this.stores.run_panel.setContractStage(4);
            this.stores.run_panel.setHasOpenContract(true);
        }

        const pocReqId = this.send(
            { proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 },
            'poc'
        );
        this.pocReqToContract.set(pocReqId, contractId);

        this.fetchProposal();
    }

    // ── Private — settlement (runs in background, never blocks ticks) ─────────

    private handleContract(
        poc:   Record<string, any> | undefined,
        subId: string | undefined,
        reqId: number | undefined,
    ): void {
        if (!poc) return;

        const contractId = String(poc.contract_id);
        if (reqId !== undefined) this.pocReqToContract.delete(reqId);

        const rec = this.openContracts.get(contractId);
        if (rec && subId && !rec.subId) rec.subId = subId;

        if (!poc.is_sold) return;

        const effSubId = subId ?? rec?.subId ?? null;
        if (effSubId) this.rawSend({ forget: effSubId });
        this.openContracts.delete(contractId);

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = poc.status === 'won';
        this.totalProfit += profit;

        // Extract exit digit from the exit tick display value
        const exitTickStr  = poc.exit_tick_display_value as string | undefined;
        const exitDigit    = exitTickStr ? this.lastDigit(parseFloat(exitTickStr)) : null;
        const triggerDigit = rec?.triggerDigit ?? 0;
        const tradeStake   = rec?.stake ?? this.currentStake;

        // Emit a structured trade record for the journal
        const record: TradeRecord = {
            seq:           ++this.tradeSeq,
            time:          this.nowTime(),
            contractLabel: this.formatContractLabel(),
            entryPoint:    this.config.entryPoint,
            triggerDigit,
            exitDigit,
            stake:         tradeStake,
            profit,
            totalPnl:      this.totalProfit,
            isWin,
        };
        this.onTrade(record);

        // Feed DBot stores
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
                `✅ WIN  +$${Math.abs(profit).toFixed(2)}  exit:${exitDigit ?? '?'}  stake:$${tradeStake.toFixed(2)}  P&L:${this.pnlStr()}`,
                'win'
            );
            this.currentStake = this.config.initialStake;
            this.lossCount    = 1;
            if (this.totalProfit >= this.config.takeProfit) {
                this.addLog(`Take Profit $${this.config.takeProfit.toFixed(2)} reached — stopping`, 'system');
                this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
                this.stop(); return;
            }
        } else {
            this.losses++;
            this.addLog(
                `❌ LOSS -$${Math.abs(profit).toFixed(2)}  exit:${exitDigit ?? '?'}  stake:$${tradeStake.toFixed(2)}  P&L:${this.pnlStr()}`,
                'loss'
            );
            if (this.totalProfit <= -this.config.stopLoss) {
                this.addLog(`Stop Loss $${this.config.stopLoss.toFixed(2)} reached — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
                this.stop(); return;
            }
            if (this.lossCount >= this.config.martingaleLevel) {
                this.addLog(`Max ${this.config.martingaleLevel} consecutive losses — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
                this.stop(); return;
            }
            this.currentStake = parseFloat((this.currentStake * this.config.martingale).toFixed(2));
            this.lossCount++;
        }

        this.onProfit(this.totalProfit, this.wins, this.losses, this.currentStake);
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

    private formatContractLabel(): string {
        const ct = this.resolveContractType();
        const p  = this.config.prediction ?? this.config.entryPoint;
        const b  = this.config.barrier    ?? this.config.entryPoint;
        switch (ct) {
            case 'DIGITOVER':  return `OVER ${b}`;
            case 'DIGITUNDER': return `UNDER ${b}`;
            case 'DIGITMATCH': return `MATCH ${p}`;
            case 'DIGITDIFF':  return `DIFF ${p}`;
            case 'DIGITEVEN':  return 'EVEN';
            case 'DIGITODD':   return 'ODD';
            default:           return ct;
        }
    }

    private lastDigit(quote: number): number {
        const s = quote.toString().replace(/^.*\./, '');
        return parseInt(s[s.length - 1] ?? '0', 10);
    }

    private pnlStr(): string {
        const sign = this.totalProfit >= 0 ? '+' : '';
        return `${sign}$${this.totalProfit.toFixed(2)}`;
    }

    private nowTime(): string {
        const now = new Date();
        return [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => n.toString().padStart(2, '0')).join(':');
    }

    private addLog(message: string, type: EngineLogType): void {
        this.onLog({ seq: ++this.logSeq, time: this.nowTime(), message, type });
    }
}
