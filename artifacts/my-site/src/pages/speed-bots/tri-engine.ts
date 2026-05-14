import { api_base } from '@/external/bot-skeleton';

// ─── Contract types ────────────────────────────────────────────────────────────

export type TriFamily =
    | 'digits_over_under'
    | 'digits_matches_differs'
    | 'digits_even_odd'
    | 'rise_fall'
    | 'higher_lower';

export type TriSide =
    | 'DIGITOVER' | 'DIGITUNDER'
    | 'DIGITMATCH' | 'DIGITDIFF'
    | 'DIGITEVEN' | 'DIGITODD'
    | 'CALL' | 'PUT'
    | 'CALL_HIGHER' | 'PUT_LOWER';

export const TRI_FAMILIES: { value: TriFamily; label: string }[] = [
    { value: 'digits_over_under',      label: 'Digits — Over / Under' },
    { value: 'digits_matches_differs', label: 'Digits — Matches / Differs' },
    { value: 'digits_even_odd',        label: 'Digits — Even / Odd' },
    { value: 'rise_fall',              label: 'Rise / Fall' },
    { value: 'higher_lower',           label: 'Higher / Lower' },
];

export const TRI_FAMILY_SIDES: Record<TriFamily, { value: TriSide; label: string }[]> = {
    digits_over_under:      [{ value: 'DIGITOVER', label: 'Over' }, { value: 'DIGITUNDER', label: 'Under' }],
    digits_matches_differs: [{ value: 'DIGITMATCH', label: 'Matches' }, { value: 'DIGITDIFF', label: 'Differs' }],
    digits_even_odd:        [{ value: 'DIGITEVEN', label: 'Even' }, { value: 'DIGITODD', label: 'Odd' }],
    rise_fall:              [{ value: 'CALL', label: 'Rise' }, { value: 'PUT', label: 'Fall' }],
    higher_lower:           [{ value: 'CALL_HIGHER', label: 'Higher' }, { value: 'PUT_LOWER', label: 'Lower' }],
};

export const triNeedsDigit = (f: TriFamily) =>
    f === 'digits_over_under' || f === 'digits_matches_differs';

const apiType = (s: TriSide): string => {
    if (s === 'CALL_HIGHER') return 'CALL';
    if (s === 'PUT_LOWER')   return 'PUT';
    return s;
};

const contractBarrier = (f: TriFamily, side: TriSide, prediction: number): string | undefined => {
    if (f === 'digits_over_under') {
        // Over barrier: 0–8 (digit must be strictly > barrier)
        // Under barrier: 1–9 (digit must be strictly < barrier)
        if (side === 'DIGITOVER')  return String(Math.max(0, Math.min(8, prediction)));
        if (side === 'DIGITUNDER') return String(Math.max(1, Math.min(9, prediction)));
    }
    if (f === 'digits_matches_differs') return String(Math.max(0, Math.min(9, prediction)));
    return undefined;
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export type MarketSlot = {
    enabled:    boolean;
    symbol:     string;
    family:     TriFamily;
    side:       TriSide;
    prediction: number;
    duration:   number;

    martingale_enabled:    boolean;
    martingale_multiplier: number;
    max_stake_cap:         number;

    cooldown_enabled:        boolean;
    cooldown_after_losses:   number;
    cooldown_duration_ticks: number;

    entry_filter_enabled: boolean;   // Option 3: best-entry filter
};

export type TriSettings = {
    symbol:      string;
    total_stake: number;

    m1: MarketSlot;
    m2: MarketSlot;
    m3: MarketSlot;

    take_profit: number;
    stop_loss:   number;

    circuit_breaker_enabled: boolean;
    circuit_breaker_losses:  number;

    auto_vol_rescan_enabled: boolean;  // Option 1: auto re-scan vol at half circuit threshold

    sound_enabled: boolean;
    stale_tick_ms: number;
};

const defaultSlot = (family: TriFamily, side: TriSide, symbol = 'R_25'): MarketSlot => ({
    enabled:    true,
    symbol,
    family,
    side,
    prediction: family === 'digits_over_under' ? 4 : 5,
    duration:   1,
    martingale_enabled:    true,
    martingale_multiplier: 2.0,
    max_stake_cap:         50,
    cooldown_enabled:        false,
    cooldown_after_losses:   5,
    cooldown_duration_ticks: 20,
    entry_filter_enabled: false,
});

export const DEFAULT_TRI_SETTINGS: TriSettings = {
    symbol:      'R_25',
    total_stake: 3,

    m1: defaultSlot('digits_over_under',      'DIGITOVER',  'R_25'),
    m2: defaultSlot('digits_matches_differs', 'DIGITMATCH', 'R_50'),
    m3: defaultSlot('rise_fall',              'CALL',       'R_75'),

    take_profit: 10,
    stop_loss:   10,

    circuit_breaker_enabled: true,
    circuit_breaker_losses:  9,

    auto_vol_rescan_enabled: true,

    sound_enabled: true,
    stale_tick_ms: 3000,
};

// ─── Journal / Trade types ─────────────────────────────────────────────────────

export type TriTrade = {
    id:           string;
    contract_id:  number | null;
    label:        string;
    market:       'M1' | 'M2' | 'M3';
    symbol:       string;
    buy_price:    number;
    payout:       number;
    profit:       number;
    is_win:       boolean;
    status:       'pending' | 'won' | 'lost';
    time:         number;
    entry_price:  string;
    exit_price:   string;
};

export type TriJournalEntry = {
    id:      string;
    time:    number;
    type:    'info' | 'success' | 'error' | 'warn';
    message: string;
};

// ─── Per-market runtime state ──────────────────────────────────────────────────

type MarketState = {
    current_stake:    number;
    consec_losses:    number;
    consec_wins:      number;
    wins:             number;
    losses:           number;
    profit:           number;
    in_flight:        boolean;
    in_flight_since:  number | null;
    contract_id:      number | null;
    cooldown_ticks:   number;
};

const freshMarketState = (base_stake: number): MarketState => ({
    current_stake:   base_stake,
    consec_losses:   0,
    consec_wins:     0,
    wins:            0,
    losses:          0,
    profit:          0,
    in_flight:       false,
    in_flight_since: null,
    contract_id:     null,
    cooldown_ticks:  0,
});

type Listener = () => void;

const fmtErr = (e: any): string => {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    const m = e?.error?.message || e?.error?.error?.message;
    if (m) return m;
    return e?.message ? String(e.message) : String(e);
};

// ─── Tri-Market Engine ────────────────────────────────────────────────────────

export class TriEngine {
    settings: TriSettings = JSON.parse(JSON.stringify(DEFAULT_TRI_SETTINGS));

    is_running        = false;
    total_profit      = 0;
    total_runs        = 0;
    consec_all_losses = 0;   // cross-market consecutive losses for circuit breaker

    last_digit:   number | null = null;
    last_quote:   number | null = null;
    last_tick_ms  = 0;
    has_live_tick = false;
    pip_size      = 2;

    states: { M1: MarketState; M2: MarketState; M3: MarketState } = {
        M1: freshMarketState(1),
        M2: freshMarketState(1),
        M3: freshMarketState(1),
    };

    last_event: { kind: 'tp' | 'sl'; message: string } | null = null;

    trades:  TriTrade[]       = [];
    journal: TriJournalEntry[] = [];

    private listeners    = new Set<Listener>();
    private tick_sub_id: string | null = null;
    private msg_unsub:   (() => void) | null = null;
    private open_ids     = new Map<number, { market: 'M1' | 'M2' | 'M3'; tradeId: string }>();
    private watchdog:    ReturnType<typeof setInterval> | null = null;
    private readonly WATCHDOG_MS = 15000;

    // Option 1: auto vol rescan
    private auto_rescanning = false;

    // Option 4: per-round summary — track which markets fired this round and results
    private round_pending = new Set<'M1' | 'M2' | 'M3'>();
    private round_results: { market: 'M1'|'M2'|'M3'; label: string; profit: number; is_win: boolean }[] = [];

    private readonly SCAN_SYMS = ['R_10','R_25','R_50','R_75','R_100','1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V'];

    // ── Pub/sub ──────────────────────────────────────────────────────────────

    subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    private emit() { this.listeners.forEach(l => l()); }

    private log(msg: string, type: TriJournalEntry['type'] = 'info') {
        this.journal.unshift({ id: `j_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, time: Date.now(), type, message: msg });
        if (this.journal.length > 400) this.journal.length = 400;
        this.emit();
    }

    private addTrade(tx: TriTrade) {
        const existing = this.trades.find(t => t.id === tx.id);
        if (existing) { Object.assign(existing, tx); this.emit(); return; }
        this.trades.unshift(tx);
        if (this.trades.length > 600) this.trades.length = 600;
        this.emit();
    }

    clearTrades()   { this.trades  = []; this.emit(); }
    clearJournal()  { this.journal = []; this.emit(); }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private baseStake() { return this.settings.total_stake / 3; }

    private slotKey(m: 'M1' | 'M2' | 'M3'): 'm1' | 'm2' | 'm3' {
        return m.toLowerCase() as 'm1' | 'm2' | 'm3';
    }

    private slot(m: 'M1' | 'M2' | 'M3'): MarketSlot {
        return this.settings[this.slotKey(m)];
    }

    // ── Control ───────────────────────────────────────────────────────────────

    updateSettings(s: Partial<TriSettings>) {
        const prevSym = this.settings.symbol;
        this.settings = { ...this.settings, ...s };
        if (!this.is_running) {
            const b = this.baseStake();
            (['M1','M2','M3'] as const).forEach(m => { this.states[m].current_stake = b; });
        }
        if (this.is_running && prevSym !== this.settings.symbol) {
            this.log(`Symbol changed → ${this.settings.symbol}`, 'warn');
            this.has_live_tick = false;
            void this.unsubTicks().then(() => { if (this.is_running) void this.subTicks(); });
        }
        this.emit();
    }

    async start() {
        if (this.is_running) return;
        if (!api_base.api)          { this.log('Not connected — log in first.', 'error'); return; }
        if (!api_base.is_authorized){ this.log('Not authorized — log in first.', 'error'); return; }

        this.is_running   = true;
        this.last_event   = null;
        this.last_digit   = null;
        this.last_quote   = null;
        this.has_live_tick = false;
        this.last_tick_ms = 0;
        this.open_ids.clear();

        const b = this.baseStake();
        (['M1','M2','M3'] as const).forEach(m => {
            this.states[m] = freshMarketState(b);
        });

        this.log(`Tri-Market Bot started on ${this.settings.symbol}`, 'success');
        await this.subTicks();
        this.startWatchdog();
        this.emit();
    }

    async stop() {
        if (!this.is_running) return;
        this.is_running = false;
        this.stopWatchdog();
        await this.unsubTicks();
        this.log('Tri-Market Bot stopped', 'warn');
        this.emit();
    }

    resetStats() {
        this.trades             = [];
        this.total_profit       = 0;
        this.total_runs         = 0;
        this.consec_all_losses  = 0;
        this.last_event         = null;
        this.journal            = [];
        this.round_pending      = new Set();
        this.round_results      = [];
        const b = this.baseStake();
        (['M1','M2','M3'] as const).forEach(m => { this.states[m] = freshMarketState(b); });
        this.log('Stats reset', 'info');
        this.emit();
    }

    clearLastEvent() { this.last_event = null; this.emit(); }

    // ── Tick subscription ─────────────────────────────────────────────────────

    private async subTicks() {
        const api = api_base.api;
        if (!api) return;
        try {
            const sub = api.onMessage().subscribe((msg: any) => {
                if (!msg?.data) return;
                const d = msg.data;
                if (d.msg_type === 'tick' && d.tick?.symbol === this.settings.symbol) {
                    if (d.tick.pip_size) this.pip_size = Number(d.tick.pip_size);
                    if (d.tick.id)       this.tick_sub_id = d.tick.id;
                    this.onTick(Number(d.tick.quote));
                }
                if (d.msg_type === 'proposal_open_contract' && d.proposal_open_contract?.is_sold) {
                    const poc    = d.proposal_open_contract;
                    const entry  = this.open_ids.get(poc.contract_id);
                    if (entry) this.onSettle(poc, entry.market, entry.tradeId);
                }
            });
            this.msg_unsub = () => sub.unsubscribe();
            await api.send({ ticks: this.settings.symbol, subscribe: 1 });
        } catch (e) {
            this.log(`Tick subscribe failed: ${fmtErr(e)}`, 'error');
            this.is_running = false;
            this.emit();
        }
    }

    private async unsubTicks() {
        try {
            const api = api_base.api;
            if (api && this.tick_sub_id) { await api.send({ forget: this.tick_sub_id }); this.tick_sub_id = null; }
            this.msg_unsub?.(); this.msg_unsub = null;
        } catch { /* ignore */ }
    }

    // ── Watchdog ──────────────────────────────────────────────────────────────

    private startWatchdog() {
        this.stopWatchdog();
        this.watchdog = setInterval(() => {
            const now = Date.now();
            (['M1','M2','M3'] as const).forEach(m => {
                const st = this.states[m];
                if (st.in_flight && st.in_flight_since !== null && now - st.in_flight_since > this.WATCHDOG_MS) {
                    this.log(`⚠ ${m} contract timed out (watchdog)`, 'warn');
                    st.in_flight = false;
                    st.in_flight_since = null;
                    if (st.contract_id !== null) { this.open_ids.delete(st.contract_id); st.contract_id = null; }
                    this.emit();
                }
            });
        }, 2000);
    }

    private stopWatchdog() { if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; } }

    // ── Tick handler ──────────────────────────────────────────────────────────

    private onTick(quote: number) {
        const str  = quote.toFixed(this.pip_size);
        this.last_digit   = Number(str.charAt(str.length - 1));
        this.last_quote   = quote;
        this.last_tick_ms = Date.now();
        this.has_live_tick = true;

        // Decrement cooldowns
        (['M1','M2','M3'] as const).forEach(m => {
            const st = this.states[m];
            if (st.cooldown_ticks > 0) {
                st.cooldown_ticks--;
                if (st.cooldown_ticks === 0) this.log(`${m} cooldown ended — resuming`, 'info');
            }
        });

        this.emit();
        if (!this.is_running) return;
        if (Date.now() - this.last_tick_ms > this.settings.stale_tick_ms) return;

        // Fire all 3 markets simultaneously (non-blocking)
        (['M1','M2','M3'] as const).forEach(m => {
            const slot  = this.slot(m);
            const state = this.states[m];
            if (!slot.enabled || state.in_flight || state.cooldown_ticks > 0) return;

            // Option 3: best-entry filter — skip if last digit doesn't favour direction
            if (slot.entry_filter_enabled && this.last_digit !== null) {
                const d = this.last_digit;
                let skip = false;
                if (slot.family === 'digits_over_under') {
                    // fire Over X only when last digit ≤ X (still under, due for over)
                    // fire Under X only when last digit ≥ X (still over, due for under)
                    skip = slot.side === 'DIGITOVER'
                        ? d > slot.prediction
                        : d < slot.prediction;
                } else if (slot.family === 'digits_matches_differs') {
                    // fire Match X only when last digit ≠ X (contrast entry)
                    // fire Diff X only when last digit = X (contrast entry)
                    skip = slot.side === 'DIGITMATCH'
                        ? d === slot.prediction
                        : d !== slot.prediction;
                } else if (slot.family === 'digits_even_odd') {
                    // fire Even only when last digit is odd; fire Odd only when last is even
                    skip = slot.side === 'DIGITEVEN'
                        ? d % 2 === 0
                        : d % 2 !== 0;
                }
                if (skip) return;
            }

            // Option 4: track round start
            this.round_pending.add(m);
            void this.buyMarket(m);
        });
    }

    // ── Buy ───────────────────────────────────────────────────────────────────

    private async buyMarket(m: 'M1' | 'M2' | 'M3') {
        const api = api_base.api;
        if (!api || !this.is_running) return;

        const slot  = this.slot(m);
        const state = this.states[m];
        if (state.in_flight || state.cooldown_ticks > 0) return;

        state.in_flight      = true;
        state.in_flight_since = Date.now();

        const type    = apiType(slot.side);
        const barrier = contractBarrier(slot.family, slot.side, slot.prediction);
        const stake   = Number(Math.min(state.current_stake, slot.max_stake_cap).toFixed(2));
        const label   = this.contractLabel(slot, barrier);

        // Pending row — visible immediately
        const tradeId = `tri_${m}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.addTrade({
            id: tradeId, contract_id: null, label, market: m,
            symbol: this.settings.symbol, buy_price: stake, payout: 0,
            profit: 0, is_win: false, status: 'pending', time: Date.now(),
            entry_price: '—', exit_price: '—',
        });
        this.log(`⏳ [${m}] BUY ${label} @ $${stake.toFixed(2)} — pending…`, 'info');

        try {
            const currency = (api_base as any).account_info?.currency || 'USD';
            const params: any = {
                amount: stake, basis: 'stake', contract_type: type,
                currency, duration: Math.max(1, slot.duration),
                duration_unit: 't', symbol: this.settings.symbol,
            };
            if (barrier !== undefined) params.barrier = barrier;

            const res: any = await api.send({ buy: 1, price: stake, parameters: params });
            if (res?.error) {
                this.log(`[${m}] Buy error: ${fmtErr(res)}`, 'error');
                const t = this.trades.find(x => x.id === tradeId);
                if (t) { t.status = 'lost'; this.emit(); }
                state.in_flight = false; state.in_flight_since = null;
                return;
            }
            const cid = res.buy.contract_id;
            state.contract_id = cid;
            this.open_ids.set(cid, { market: m, tradeId });
            const t = this.trades.find(x => x.id === tradeId);
            if (t) { t.contract_id = cid; t.buy_price = Number(res.buy.buy_price); this.emit(); }
            this.playBeep('buy');
            void api.send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }).catch(() => {});
        } catch (e) {
            this.log(`[${m}] Buy exception: ${fmtErr(e)}`, 'error');
            const t = this.trades.find(x => x.id === tradeId);
            if (t) { t.status = 'lost'; this.emit(); }
            state.in_flight = false; state.in_flight_since = null;
        }
    }

    private contractLabel(slot: MarketSlot, barrier?: string): string {
        const b = barrier ? ` ${barrier}` : '';
        switch (slot.side) {
            case 'DIGITOVER':   return `Over${b}`;
            case 'DIGITUNDER':  return `Under${b}`;
            case 'DIGITMATCH':  return `Match${b}`;
            case 'DIGITDIFF':   return `Diff${b}`;
            case 'DIGITEVEN':   return 'Even';
            case 'DIGITODD':    return 'Odd';
            case 'CALL':        return 'Rise';
            case 'PUT':         return 'Fall';
            case 'CALL_HIGHER': return 'Higher';
            case 'PUT_LOWER':   return 'Lower';
            default:            return slot.side + b;
        }
    }

    // ── Settle ────────────────────────────────────────────────────────────────

    private onSettle(poc: any, market: 'M1' | 'M2' | 'M3', tradeId: string) {
        const state  = this.states[market];
        const profit = Number(poc.profit ?? 0);
        const is_win = profit > 0;
        const barrier = poc.barrier !== undefined ? String(poc.barrier) : undefined;
        const slot   = this.slot(market);
        const label  = this.contractLabel(slot, barrier);

        // Update pending row in-place
        const existing = this.trades.find(t => t.id === tradeId);
        const tx: TriTrade = {
            id: tradeId, contract_id: poc.contract_id, label, market,
            symbol: this.settings.symbol, buy_price: Number(poc.buy_price ?? 0),
            payout: Number(poc.payout ?? 0), profit, is_win,
            status: is_win ? 'won' : 'lost',
            time: (poc.purchase_time || Math.floor(Date.now() / 1000)) * 1000,
            entry_price: poc.entry_tick_display_value ?? poc.entry_spot_display_value ?? '—',
            exit_price:  poc.exit_tick_display_value  ?? poc.exit_spot_display_value  ?? '—',
        };
        if (existing) { Object.assign(existing, tx); this.emit(); } else { this.addTrade(tx); }

        this.open_ids.delete(poc.contract_id);
        state.in_flight       = false;
        state.in_flight_since = null;
        state.contract_id     = null;

        // Option 4: per-round summary
        this.round_pending.delete(market);
        this.round_results.push({ market, label: tx.label, profit, is_win });
        if (this.round_pending.size === 0 && this.round_results.length > 0) {
            const wins  = this.round_results.filter(r => r.is_win).length;
            const total = this.round_results.length;
            const net   = this.round_results.reduce((s, r) => s + r.profit, 0);
            const parts = this.round_results.map(r => `[${r.market}] ${r.label} ${r.is_win ? '+' : ''}$${r.profit.toFixed(2)} ${r.is_win ? '✓' : '✗'}`).join(' · ');
            this.log(`📋 Round ${wins}/${total} won · Net ${net >= 0 ? '+' : ''}$${net.toFixed(2)} · ${parts}`, wins === total ? 'success' : wins === 0 ? 'error' : 'warn');
            this.round_results = [];
        }
        state.profit          = Number((state.profit + profit).toFixed(2));
        this.total_profit     = Number((this.total_profit + profit).toFixed(2));
        this.total_runs++;

        if (is_win) {
            state.wins++;
            state.consec_wins++;
            state.consec_losses = 0;
            state.current_stake = this.baseStake();
            this.consec_all_losses = 0;
            this.log(`[${market}] WIN ${tx.label} +$${profit.toFixed(2)} | total $${this.total_profit.toFixed(2)}`, 'success');
        } else {
            state.losses++;
            state.consec_losses++;
            state.consec_wins = 0;
            this.consec_all_losses++;
            if (slot.martingale_enabled) {
                state.current_stake = Number(
                    Math.min(state.current_stake * slot.martingale_multiplier, slot.max_stake_cap).toFixed(2)
                );
            }
            this.log(`[${market}] LOSS ${tx.label} -$${Math.abs(profit).toFixed(2)} | next $${state.current_stake.toFixed(2)} | total $${this.total_profit.toFixed(2)} | streak ${this.consec_all_losses}`, 'error');

            if (slot.cooldown_enabled && state.consec_losses >= slot.cooldown_after_losses) {
                state.cooldown_ticks = slot.cooldown_duration_ticks;
                this.log(`[${market}] ⏸ Cooldown: ${state.cooldown_ticks} ticks after ${state.consec_losses} losses`, 'warn');
            }
        }

        this.playBeep(is_win ? 'win' : 'loss');
        this.checkGlobalStopConditions();
        // Zero-latency: re-fire this market immediately after settle
        if (this.is_running && !state.in_flight && state.cooldown_ticks === 0) {
            void this.buyMarket(market);
        }
    }

    // Option 1: auto vol rescan ───────────────────────────────────────────────
    private async autoRescan() {
        if (this.auto_rescanning) return;
        this.auto_rescanning = true;
        this.log('📡 Auto vol rescan triggered…', 'info');
        try {
            const api = api_base.api;
            if (!api) return;
            const slots = [this.settings.m1, this.settings.m2, this.settings.m3];
            const lastDigit = (p: number) => { const s = p.toFixed(5); return Number(s.charAt(s.length - 1)); };
            const results = await Promise.all(
                this.SCAN_SYMS.map(async sym => {
                    try {
                        const res: any = await api.send({ ticks_history: sym, count: 50, end: 'latest', style: 'ticks' });
                        const prices: number[] = res?.history?.prices ?? [];
                        if (prices.length < 2) return { sym, score: 0 };
                        let score = 0;
                        for (const slot of slots) {
                            if (!slot.enabled) continue;
                            let hits = 0;
                            if (slot.family === 'digits_over_under')
                                hits = prices.filter(p => slot.side === 'DIGITOVER' ? lastDigit(p) > slot.prediction : lastDigit(p) < slot.prediction).length;
                            else if (slot.family === 'digits_matches_differs')
                                hits = prices.filter(p => slot.side === 'DIGITMATCH' ? lastDigit(p) === slot.prediction : lastDigit(p) !== slot.prediction).length;
                            else if (slot.family === 'digits_even_odd')
                                hits = prices.filter(p => slot.side === 'DIGITEVEN' ? lastDigit(p) % 2 === 0 : lastDigit(p) % 2 !== 0).length;
                            else hits = 25;
                            score += hits;
                        }
                        return { sym, score };
                    } catch { return { sym, score: 0 }; }
                })
            );
            results.sort((a, b) => b.score - a.score);
            const best = results[0]?.sym ?? this.settings.symbol;
            const old  = this.settings.symbol;
            if (best !== old) {
                this.settings = { ...this.settings, symbol: best };
                this.log(`📡 Auto rescan: switched ${old} → ${best} (score ${results[0]?.score})`, 'success');
                void this.unsubTicks().then(() => { if (this.is_running) void this.subTicks(); });
            } else {
                this.log(`📡 Auto rescan: ${best} still best (score ${results[0]?.score})`, 'info');
            }
            this.consec_all_losses = 0;
        } catch (e) {
            this.log(`Auto rescan failed: ${fmtErr(e)}`, 'error');
        } finally {
            this.auto_rescanning = false;
            this.emit();
        }
    }

    private checkGlobalStopConditions() {
        if (this.settings.take_profit > 0 && this.total_profit >= this.settings.take_profit) {
            const msg = `Take profit $${this.settings.take_profit} reached`;
            this.log(`🎉 ${msg}`, 'success');
            this.last_event = { kind: 'tp', message: msg };
            void this.stop();
            return;
        }
        if (this.settings.stop_loss > 0 && this.total_profit <= -this.settings.stop_loss) {
            const msg = `Stop loss $${this.settings.stop_loss} reached`;
            this.log(`⛔ ${msg}`, 'error');
            this.last_event = { kind: 'sl', message: msg };
            void this.stop();
            return;
        }
        if (
            this.settings.circuit_breaker_enabled &&
            this.consec_all_losses >= this.settings.circuit_breaker_losses
        ) {
            const msg = `Circuit breaker — ${this.consec_all_losses} consecutive losses across all markets`;
            this.log(`🔌 ${msg}`, 'warn');
            this.last_event = { kind: 'sl', message: msg };
            this.consec_all_losses = 0;
            void this.stop();
            return;
        }
        // Option 1: auto rescan at half the circuit breaker threshold
        if (
            this.settings.auto_vol_rescan_enabled &&
            this.settings.circuit_breaker_losses > 0 &&
            this.consec_all_losses > 0 &&
            this.consec_all_losses === Math.ceil(this.settings.circuit_breaker_losses / 2)
        ) {
            void this.autoRescan();
        }
    }

    // ── Sound ─────────────────────────────────────────────────────────────────

    private playBeep(type: 'buy' | 'win' | 'loss') {
        if (!this.settings.sound_enabled) return;
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            if (type === 'buy')  { osc.frequency.value = 880;  g.gain.value = 0.04; }
            if (type === 'win')  { osc.frequency.value = 1200; g.gain.value = 0.07; }
            if (type === 'loss') { osc.frequency.value = 300;  g.gain.value = 0.07; }
            osc.start(); osc.stop(ctx.currentTime + 0.12);
        } catch { /* ignore */ }
    }
}

export const triEngine = new TriEngine();
