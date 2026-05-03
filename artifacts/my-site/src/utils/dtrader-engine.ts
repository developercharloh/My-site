// ─── DTrader Engine ──────────────────────────────────────────────────────────
//
// Lite version of Deriv's DTrader, sized for our app. Handles:
//   • Live tick subscription for spot + last digit
//   • Live proposal subscription (auto-updates payout as inputs change)
//   • Manual buy (one click → one contract)
//   • Manual sell (close open Accumulators / Multipliers at market)
//   • Open-contract tracking → live P&L → settlement record
//
// Supported contract families:
//   Rise / Fall          (CALL / PUT, no barrier)
//   Higher / Lower       (CALL / PUT, with relative barrier  +0.001 / -0.001)
//   Touch / No Touch     (ONETOUCH / NOTOUCH, with relative barrier)
//   Matches / Differs    (DIGITMATCH / DIGITDIFF, prediction digit 0-9)
//   Over / Under         (DIGITOVER  / DIGITUNDER, prediction digit 0-9)
//   Even / Odd           (DIGITEVEN  / DIGITODD,  no barrier / prediction)
//   Accumulators         (ACCU, growth-rate based, no fixed duration)
//   Multipliers          (MULTUP / MULTDOWN, leverage-based, optional SL/TP)

import { api_base } from '@/external/bot-skeleton/services/api/api-base';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DTContractType =
    | 'CALL' | 'PUT'
    | 'ONETOUCH' | 'NOTOUCH'
    | 'DIGITMATCH' | 'DIGITDIFF'
    | 'DIGITOVER'  | 'DIGITUNDER'
    | 'DIGITEVEN'  | 'DIGITODD'
    | 'ACCU'
    | 'MULTUP' | 'MULTDOWN';

export type DTDurationUnit = 't' | 's' | 'm' | 'h';

export type DTStatus = 'idle' | 'subscribing' | 'ready' | 'error';

export type DTLogType = 'info' | 'win' | 'loss' | 'error' | 'system';
export interface DTLog { seq: number; time: string; message: string; type: DTLogType; }

export interface DTBuyFeedback {
    seq:     number;       // monotonic — used by UI to detect new feedback
    kind:    'success' | 'error';
    message: string;
}

export interface DTProposal {
    id:         string;     // proposal id (use this to buy)
    askPrice:   number;     // price the buy will cost
    payout:     number;     // total payout if won
    profit:     number;     // payout - askPrice
    profitPct:  number;     // (profit / askPrice) * 100
    longcode:   string;
    spot:       string;     // current spot price string at last update
}

export interface DTPosition {
    contractId:   string;
    contractType: DTContractType;
    symbol:       string;
    stake:        number;
    payout:       number;
    buyPrice:     number;
    currentSpot:  string | null;
    currentBid:   number | null; // sell-back value
    profit:       number | null; // current P&L
    isOpen:       boolean;
    isWin:        boolean | null;
    entrySpot:    string | null;
    exitSpot:     string | null;
    longcode:     string;
    purchaseTime: string;
}

export interface DTConfig {
    symbol:        string;
    contractType:  DTContractType;
    /** Binary contracts use duration; ACCU/MULT do not. */
    durationValue: number;
    durationUnit:  DTDurationUnit;
    stake:         number;
    /** '+0.001' / '-0.001' for H/L + Touch, '5' for digits, null otherwise. */
    barrier:       string | null;
    currency:      string;
    // Accumulators
    growthRate?:   number;   // 0.01 .. 0.05 (1%..5%)
    // Multipliers
    multiplier?:   number;   // e.g. 50, 100, 200, 300, 400, 500
    // Optional limit orders (ACCU / MULT)
    takeProfit?:   number | null;
    stopLoss?:     number | null;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DTraderEngine {
    // ── Public callbacks ──────────────────────────────────────────────────────
    public onTick:     (spot: string, digit: number) => void = () => {};
    public onProposal: (p: DTProposal | null)         => void = () => {};
    public onPosition: (p: DTPosition)                => void = () => {};
    public onStatus:   (s: DTStatus)                  => void = () => {};
    public onLog:      (l: DTLog)                     => void = () => {};
    public onBuyFeedback: (f: DTBuyFeedback)          => void = () => {};

    // ── State ─────────────────────────────────────────────────────────────────
    private cfg: DTConfig | null = null;
    private status: DTStatus = 'idle';

    private msgSub: { unsubscribe: () => void } | null = null;

    private reqBase    = (Math.floor(Date.now() / 1000) % 50000) * 1000;
    private reqCounter = 0;
    private myReqIds   = new Set<number>();

    // Subscriptions we own
    private tickSubId:     string | null = null;
    private proposalSubId: string | null = null;
    private positions:     Map<string, DTPosition> = new Map();
    private posSubIds:     Map<string, string> = new Map(); // contractId → POC sub id

    // Debounce for proposal refresh
    private proposalDebounce: ReturnType<typeof setTimeout> | null = null;
    private readonly PROPOSAL_DEBOUNCE_MS = 250;

    // Buy in-flight guard
    private buyInflight = false;

    // Engine-owned latest proposal — single source of truth for buy.
    // React state can lag a render behind, which would send a stale id
    // that Deriv has already invalidated. Always buy from this instead.
    private currentProposal: DTProposal | null = null;

    private logSeq      = 0;
    private feedbackSeq = 0;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(initialCfg: DTConfig): void {
        if (!api_base.api) { this.fail('Deriv connection not ready — please log in first.'); return; }
        if (!api_base.is_authorized) { this.fail('Not authorized — log in to your Deriv account first.'); return; }

        this.stop(); // clean any prior state

        this.cfg = { ...initialCfg };
        this.setStatus('subscribing');
        this.log(`DTrader ready on ${this.cfg.symbol}`, 'system');

        this.msgSub = (api_base.api as any).onMessage().subscribe((raw: any) => {
            this.handle(raw?.data ?? raw);
        });

        this.subscribeTick();
        this.scheduleProposal();
    }

    stop(): void {
        if (this.proposalDebounce) { clearTimeout(this.proposalDebounce); this.proposalDebounce = null; }
        if (this.tickSubId)     { this.rawSend({ forget: this.tickSubId });     this.tickSubId = null; }
        if (this.proposalSubId) { this.rawSend({ forget: this.proposalSubId }); this.proposalSubId = null; }
        this.posSubIds.forEach(id => this.rawSend({ forget: id }));
        this.posSubIds.clear();
        this.msgSub?.unsubscribe();
        this.msgSub = null;
        this.myReqIds.clear();
        this.buyInflight = false;
        this.currentProposal = null;
        this.setStatus('idle');
    }

    // ── Config setters (any change triggers a debounced proposal refresh) ────

    updateConfig(patch: Partial<DTConfig>): void {
        if (!this.cfg) return;
        const oldSymbol = this.cfg.symbol;
        this.cfg = { ...this.cfg, ...patch };
        if (patch.symbol && patch.symbol !== oldSymbol) {
            // Re-subscribe ticks on new symbol
            if (this.tickSubId) { this.rawSend({ forget: this.tickSubId }); this.tickSubId = null; }
            this.subscribeTick();
        }
        this.scheduleProposal();
    }

    // ── Buy ───────────────────────────────────────────────────────────────────

    /**
     * Sell an open contract back to Deriv at market price. Used for
     * Accumulators / Multipliers where the user decides when to close.
     */
    sellContract(contractId: string): void {
        if (!api_base.is_authorized) {
            this.emitBuyError('Not logged in to Deriv — log in first to sell positions');
            return;
        }
        this.log(`◀︎ Selling #${contractId} at market`, 'info');
        this.send({ sell: contractId, price: 0 });
    }

    /**
     * Place a buy using the latest proposal pushed by the server (engine-owned,
     * never stale). Returns nothing — feedback is delivered via onBuyFeedback
     * and onLog so the UI can surface it prominently.
     */
    buy(): void {
        if (!this.cfg) {
            this.fail('Engine not started — try refreshing the page', false);
            return;
        }
        if (!api_base.is_authorized) {
            this.emitBuyError('Not logged in to Deriv — log in first to place trades');
            return;
        }
        if (!this.currentProposal) {
            this.emitBuyError('No live price yet — wait a moment and tap BUY again');
            return;
        }
        if (this.buyInflight) {
            this.emitBuyError('A buy is already being placed…');
            return;
        }

        const p = this.currentProposal;
        this.buyInflight = true;
        this.log(
            `▶︎ Buying ${this.formatContractLabel()} on ${this.cfg.symbol}  stake $${this.cfg.stake.toFixed(2)}  (proposal ${p.id.slice(0, 8)}…)`,
            'info'
        );
        this.send({ buy: p.id, price: p.askPrice });
    }

    // ── Internal: subscriptions ───────────────────────────────────────────────

    private subscribeTick(): void {
        if (!this.cfg) return;
        this.send({ ticks: this.cfg.symbol, subscribe: 1 });
    }

    private scheduleProposal(): void {
        if (this.proposalDebounce) clearTimeout(this.proposalDebounce);
        this.proposalDebounce = setTimeout(() => this.refreshProposal(), this.PROPOSAL_DEBOUNCE_MS);
    }

    private refreshProposal(): void {
        if (!this.cfg) return;
        // Forget previous proposal sub, then ask for a fresh subscribed one.
        if (this.proposalSubId) { this.rawSend({ forget: this.proposalSubId }); this.proposalSubId = null; }
        this.currentProposal = null;
        this.onProposal(null); // clear UI while loading

        const ct = this.cfg.contractType;
        const isAccu = ct === 'ACCU';
        const isMult = ct === 'MULTUP' || ct === 'MULTDOWN';

        const payload: Record<string, unknown> = {
            proposal:      1,
            subscribe:     1,
            amount:        this.cfg.stake,
            basis:         'stake',
            contract_type: ct,
            currency:      this.cfg.currency,
            symbol:        this.cfg.symbol,
        };

        if (isAccu) {
            payload.growth_rate = this.cfg.growthRate ?? 0.03;
            const tp = this.cfg.takeProfit;
            if (tp != null && tp > 0) payload.limit_order = { take_profit: tp };
        } else if (isMult) {
            payload.multiplier = this.cfg.multiplier ?? 100;
            const limit: Record<string, number> = {};
            if (this.cfg.takeProfit != null && this.cfg.takeProfit > 0) limit.take_profit = this.cfg.takeProfit;
            if (this.cfg.stopLoss   != null && this.cfg.stopLoss   > 0) limit.stop_loss   = this.cfg.stopLoss;
            if (Object.keys(limit).length) payload.limit_order = limit;
        } else {
            // Binary contracts — fixed duration + optional barrier
            payload.duration      = this.cfg.durationValue;
            payload.duration_unit = this.cfg.durationUnit;
            if (this.cfg.barrier !== null && this.cfg.barrier !== '') {
                payload.barrier = this.cfg.barrier;
            }
        }
        this.send(payload);
    }

    // ── Internal: message routing ─────────────────────────────────────────────

    private handle(msg: Record<string, any>): void {
        if (!msg) return;

        const subId = msg?.subscription?.id as string | undefined;
        const reqId = msg?.req_id            as number | undefined;

        const isMyReq = reqId !== undefined && this.myReqIds.has(reqId);
        const isMyTick = subId !== undefined && subId === this.tickSubId;
        const isMyProp = subId !== undefined && subId === this.proposalSubId;
        const isMyPos  = subId !== undefined && [...this.posSubIds.values()].includes(subId);

        if (!isMyReq && !isMyTick && !isMyProp && !isMyPos) return;

        if (msg.error) {
            const m = msg.error.message ?? 'Unknown error';
            this.log(`API error [${msg.msg_type}]: ${m}`, 'error');
            if (msg.msg_type === 'proposal') {
                this.currentProposal = null;
                this.onProposal(null);
            }
            if (msg.msg_type === 'buy') {
                this.buyInflight = false;
                this.emitBuyError(m);
                // Likely a stale proposal id — refresh immediately so the next
                // tap has a fresh price ready.
                if (/proposal|invalid|expired/i.test(m)) this.refreshProposal();
            }
            if (msg.msg_type === 'sell') this.emitBuyError(`Sell failed: ${m}`);
            return;
        }

        switch (msg.msg_type) {
            case 'tick':
                if (subId && !this.tickSubId) this.tickSubId = subId;
                this.handleTick(msg.tick);
                break;
            case 'proposal':
                if (subId && !this.proposalSubId) this.proposalSubId = subId;
                this.handleProposal(msg.proposal);
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'sell':
                this.handleSellAck(msg.sell);
                break;
            case 'proposal_open_contract':
                this.handlePOC(msg.proposal_open_contract, subId);
                break;
        }
    }

    private handleTick(tick: { quote: number; pip_size?: number } | undefined): void {
        if (!tick) return;
        const spot  = this.formatQuote(tick.quote, tick.pip_size);
        const digit = this.lastDigit(tick.quote);
        if (this.status === 'subscribing') this.setStatus('ready');
        this.onTick(spot, digit);
    }

    private handleProposal(p: any): void {
        if (!p) return;
        const askPrice = parseFloat(p.ask_price ?? '0');
        const payout   = parseFloat(p.payout    ?? '0');
        const profit   = payout - askPrice;
        const proposal: DTProposal = {
            id:        p.id,
            askPrice,
            payout,
            profit,
            profitPct: askPrice > 0 ? (profit / askPrice) * 100 : 0,
            longcode:  p.longcode ?? '',
            spot:      String(p.spot ?? ''),
        };
        // Engine-owned source of truth — used by buy() so we always send the
        // latest id, never one that React state hasn't caught up to.
        this.currentProposal = proposal;
        this.onProposal(proposal);
    }

    private handleSellAck(sell: any): void {
        if (!sell?.contract_id) return;
        const profit = parseFloat(sell.sold_for ?? '0') - parseFloat(sell.balance_after ?? '0') * 0; // sold_for is the realized
        const sold   = parseFloat(sell.sold_for ?? '0');
        this.emitBuySuccess(`Sold #${sell.contract_id} for $${sold.toFixed(2)}`);
        // The proposal_open_contract subscription will deliver the final
        // settlement record (profit, exit spot) shortly.
        void profit;
    }

    private handleBuyAck(buy: any): void {
        this.buyInflight = false;
        if (!buy?.contract_id) {
            this.log('Buy ack missing contract_id', 'error');
            this.emitBuyError('Buy failed — no contract returned');
            return;
        }
        const contractId = String(buy.contract_id);
        const buyPrice   = parseFloat(buy.buy_price ?? '0');
        const payout     = parseFloat(buy.payout    ?? '0');
        const stake      = this.cfg?.stake ?? buyPrice;
        this.emitBuySuccess(`Bought #${contractId}  $${buyPrice.toFixed(2)} → payout $${payout.toFixed(2)}`);

        const pos: DTPosition = {
            contractId,
            contractType: this.cfg?.contractType ?? 'CALL',
            symbol:       this.cfg?.symbol ?? '',
            stake,
            payout,
            buyPrice,
            currentSpot:  null,
            currentBid:   null,
            profit:       null,
            isOpen:       true,
            isWin:        null,
            entrySpot:    null,
            exitSpot:     null,
            longcode:     buy.longcode ?? '',
            purchaseTime: this.nowTime(),
        };
        this.positions.set(contractId, pos);
        this.onPosition(pos);
        this.log(`✅ Bought #${contractId}  stake $${buyPrice.toFixed(2)}  payout $${payout.toFixed(2)}`, 'info');

        // Subscribe to settlement
        this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
    }

    private handlePOC(poc: any, subId: string | undefined): void {
        if (!poc?.contract_id) return;
        const contractId = String(poc.contract_id);
        const pos = this.positions.get(contractId);
        if (!pos) return;

        if (subId && !this.posSubIds.has(contractId)) {
            this.posSubIds.set(contractId, subId);
        }

        // Live updates while open
        const profit  = poc.profit !== undefined ? parseFloat(poc.profit) : pos.profit;
        const bid     = poc.bid_price !== undefined ? parseFloat(poc.bid_price) : pos.currentBid;
        const spot    = poc.current_spot_display_value as string | undefined;
        const entry   = poc.entry_tick_display_value   as string | undefined;
        const exit    = poc.exit_tick_display_value    as string | undefined;

        pos.profit      = profit;
        pos.currentBid  = bid;
        if (spot) pos.currentSpot = spot;
        if (entry && !pos.entrySpot) pos.entrySpot = entry;

        if (poc.is_sold || poc.status === 'won' || poc.status === 'lost') {
            pos.isOpen   = false;
            pos.isWin    = poc.status === 'won';
            pos.exitSpot = exit ?? pos.currentSpot;
            const sign   = (pos.profit ?? 0) >= 0 ? '+' : '';
            const move   = (pos.entrySpot || pos.exitSpot)
                ? `  ${pos.entrySpot ?? '?'} → ${pos.exitSpot ?? '?'}`
                : '';
            this.log(
                pos.isWin
                    ? `✅ WIN  ${sign}$${(pos.profit ?? 0).toFixed(2)}${move}  #${contractId}`
                    : `❌ LOSS ${sign}$${(pos.profit ?? 0).toFixed(2)}${move}  #${contractId}`,
                pos.isWin ? 'win' : 'loss',
            );
            // Cleanup subscription
            const sid = this.posSubIds.get(contractId);
            if (sid) { this.rawSend({ forget: sid }); this.posSubIds.delete(contractId); }
        }
        this.onPosition({ ...pos });
    }

    // ── Internal: WS helpers ──────────────────────────────────────────────────

    private send(payload: Record<string, unknown>): number {
        const reqId = this.reqBase + (++this.reqCounter);
        this.myReqIds.add(reqId);
        this.rawSend({ req_id: reqId, ...payload });
        return reqId;
    }

    private rawSend(payload: Record<string, unknown>): void {
        try { (api_base.api as any).send(payload); } catch { /* ignore */ }
    }

    // ── Internal: helpers ────────────────────────────────────────────────────

    private setStatus(s: DTStatus): void {
        if (this.status === s) return;
        this.status = s;
        this.onStatus(s);
    }

    private fail(msg: string, hardFail = true): void {
        this.log(msg, 'error');
        if (hardFail) this.setStatus('error');
    }

    private emitBuyError(message: string): void {
        this.log(message, 'error');
        this.onBuyFeedback({ seq: ++this.feedbackSeq, kind: 'error', message });
    }

    private emitBuySuccess(message: string): void {
        this.onBuyFeedback({ seq: ++this.feedbackSeq, kind: 'success', message });
    }

    private log(message: string, type: DTLogType = 'info'): void {
        this.onLog({ seq: ++this.logSeq, time: this.nowTime(), message, type });
    }

    private nowTime(): string {
        const d = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    private lastDigit(q: number): number {
        const s = q.toString().replace(/^.*\./, '');
        return parseInt(s[s.length - 1] ?? '0', 10);
    }

    private formatQuote(quote: number, pipSize?: number): string {
        if (typeof pipSize === 'number' && pipSize > 0) return quote.toFixed(pipSize);
        const s = quote.toString();
        const dot = s.indexOf('.');
        if (dot === -1) return quote.toFixed(2);
        return quote.toFixed(Math.min(Math.max(s.length - dot - 1, 2), 8));
    }

    private formatContractLabel(): string {
        if (!this.cfg) return '';
        const t = this.cfg.contractType;
        switch (t) {
            case 'CALL':       return this.cfg.barrier ? 'HIGHER' : 'RISE';
            case 'PUT':        return this.cfg.barrier ? 'LOWER'  : 'FALL';
            case 'ONETOUCH':   return 'TOUCH';
            case 'NOTOUCH':    return 'NO TOUCH';
            case 'DIGITMATCH': return `MATCH ${this.cfg.barrier ?? ''}`;
            case 'DIGITDIFF':  return `DIFFER ${this.cfg.barrier ?? ''}`;
            case 'DIGITOVER':  return `OVER ${this.cfg.barrier ?? ''}`;
            case 'DIGITUNDER': return `UNDER ${this.cfg.barrier ?? ''}`;
            case 'DIGITEVEN':  return 'EVEN';
            case 'DIGITODD':   return 'ODD';
            default:           return t;
        }
    }
}
