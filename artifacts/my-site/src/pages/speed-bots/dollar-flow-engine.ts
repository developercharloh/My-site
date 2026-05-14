import { api_base } from '@/external/bot-skeleton';

// ─── Contract catalogue ───────────────────────────────────────────────────────

export type ContractFamily =
    | 'digits_over_under'
    | 'digits_even_odd'
    | 'rise_fall'
    | 'matches_differs'
    | 'asian'
    | 'touch_no_touch'
    | 'higher_lower';

export type ContractSide =
    // Digits Over/Under
    | 'DIGITOVER'
    | 'DIGITUNDER'
    // Digits Even/Odd
    | 'DIGITEVEN'
    | 'DIGITODD'
    // Rise/Fall
    | 'CALL'
    | 'PUT'
    // Matches/Differs
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    // Asian
    | 'ASIANU'
    | 'ASIAND'
    // Touch/No Touch
    | 'ONETOUCH'
    | 'NOTOUCH'
    // Higher/Lower
    | 'CALL_HIGHER'
    | 'PUT_LOWER';

export const CONTRACT_FAMILIES: { value: ContractFamily; label: string }[] = [
    { value: 'digits_over_under', label: 'Digits — Over / Under' },
    { value: 'digits_even_odd',   label: 'Digits — Even / Odd' },
    { value: 'rise_fall',         label: 'Rise / Fall' },
    { value: 'matches_differs',   label: 'Matches / Differs' },
    { value: 'asian',             label: 'Asian Up / Asian Down' },
    { value: 'touch_no_touch',    label: 'Touch / No Touch' },
    { value: 'higher_lower',      label: 'Higher / Lower' },
];

export const FAMILY_SIDES: Record<ContractFamily, { value: ContractSide; label: string }[]> = {
    digits_over_under: [
        { value: 'DIGITOVER',  label: 'Over' },
        { value: 'DIGITUNDER', label: 'Under' },
    ],
    digits_even_odd: [
        { value: 'DIGITEVEN', label: 'Even' },
        { value: 'DIGITODD',  label: 'Odd' },
    ],
    rise_fall: [
        { value: 'CALL', label: 'Rise' },
        { value: 'PUT',  label: 'Fall' },
    ],
    matches_differs: [
        { value: 'DIGITMATCH', label: 'Matches' },
        { value: 'DIGITDIFF',  label: 'Differs' },
    ],
    asian: [
        { value: 'ASIANU', label: 'Asian Up' },
        { value: 'ASIAND', label: 'Asian Down' },
    ],
    touch_no_touch: [
        { value: 'ONETOUCH', label: 'Touch' },
        { value: 'NOTOUCH',  label: 'No Touch' },
    ],
    higher_lower: [
        { value: 'CALL_HIGHER', label: 'Higher' },
        { value: 'PUT_LOWER',   label: 'Lower' },
    ],
};

/** Whether a contract family needs a digit prediction (0-9). */
export const needsDigitPrediction = (f: ContractFamily): boolean =>
    f === 'digits_over_under' || f === 'matches_differs';

/** Whether a family uses an Over/Under 1-8 barrier specifically. */
export const overUnderBarrierRange = (f: ContractFamily): boolean => f === 'digits_over_under';

/** The wire contract_type string sent to the API. */
export const apiContractType = (side: ContractSide): string => {
    if (side === 'CALL_HIGHER') return 'CALL';
    if (side === 'PUT_LOWER')   return 'PUT';
    return side;
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export type MarketConfig = {
    family:     ContractFamily;
    side:       ContractSide;
    prediction: number;   // digit 0-9; ignored for non-digit families
    stake:      number;
    duration:   number;   // ticks (1-10)
};

export type DollarFlowSettings = {
    symbol: string;

    m1: MarketConfig;

    m2_enabled: boolean;
    m2: MarketConfig;

    martingale_enabled:    boolean;
    martingale_multiplier: number;
    max_stake_cap:         number;

    take_profit:       number;
    stop_loss:         number;

    max_consec_losses: number;   // 0 = disabled
    max_consec_wins:   number;   // 0 = disabled

    cooldown_enabled:         boolean;
    cooldown_after_losses:    number;
    cooldown_duration_ticks:  number;

    sound_enabled:  boolean;
    stale_tick_ms:  number;
};

const defaultMarket = (family: ContractFamily, side: ContractSide): MarketConfig => ({
    family,
    side,
    prediction: 4,
    stake: 0.5,
    duration: 1,
});

export const DEFAULT_DF_SETTINGS: DollarFlowSettings = {
    symbol: '1HZ10V',

    m1: defaultMarket('digits_over_under', 'DIGITOVER'),

    m2_enabled: true,
    m2: defaultMarket('digits_even_odd', 'DIGITODD'),

    martingale_enabled:    true,
    martingale_multiplier: 2.0,
    max_stake_cap:         50,

    take_profit:       10,
    stop_loss:         20,

    max_consec_losses: 10,
    max_consec_wins:   0,

    cooldown_enabled:         false,
    cooldown_after_losses:    5,
    cooldown_duration_ticks:  20,

    sound_enabled: true,
    stale_tick_ms: 3000,
};

// ─── Transaction / journal types ──────────────────────────────────────────────

export type DFTransaction = {
    id:             string;
    contract_id:    number | null;
    contract_type:  string;
    contract_label: string;
    symbol:         string;
    buy_price:      number;
    payout:         number;
    profit:         number;
    is_win:         boolean;
    status:         'pending' | 'won' | 'lost';
    market:         'M1' | 'M2';
    time:           number;
    entry_price:    string | null;
    exit_price:     string | null;
};

export type DFJournalEntry = {
    id:      string;
    time:    number;
    type:    'info' | 'success' | 'error' | 'warn';
    message: string;
};

// ─── Internal state enum ──────────────────────────────────────────────────────

type Phase = 'idle' | 'm1' | 'm2' | 'cooldown';

type Listener = () => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatApiError = (e: any): string => {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    const apiErr = e?.error?.message || e?.error?.error?.message;
    if (apiErr) {
        const code = e?.error?.code || e?.error?.error?.code;
        return code ? `${apiErr} (${code})` : apiErr;
    }
    if (e?.message && typeof e.message === 'string') return e.message;
    try { return JSON.stringify(e); } catch { return String(e); }
};

const contractLabel = (type: string, barrier?: string): string => {
    const b = barrier ? ` ${barrier}` : '';
    switch (type) {
        case 'DIGITOVER':  return `Over${b}`;
        case 'DIGITUNDER': return `Under${b}`;
        case 'DIGITEVEN':  return 'Even';
        case 'DIGITODD':   return 'Odd';
        case 'DIGITMATCH': return `Match${b}`;
        case 'DIGITDIFF':  return `Diff${b}`;
        case 'CALL':       return 'Rise';
        case 'PUT':        return 'Fall';
        case 'ASIANU':     return 'Asian Up';
        case 'ASIAND':     return 'Asian Down';
        case 'ONETOUCH':   return `Touch${b}`;
        case 'NOTOUCH':    return `No Touch${b}`;
        default:           return type + b;
    }
};

const barrierForConfig = (cfg: MarketConfig): string | undefined => {
    if (cfg.family === 'digits_over_under')   return String(Math.max(1, Math.min(8, cfg.prediction)));
    if (cfg.family === 'matches_differs')     return String(Math.max(0, Math.min(9, cfg.prediction)));
    if (cfg.family === 'touch_no_touch')      return undefined; // user must set manually via API — not yet automated
    return undefined;
};

// ─── Dollar Flow Engine ───────────────────────────────────────────────────────

export class DollarFlowEngine {
    settings: DollarFlowSettings = { ...DEFAULT_DF_SETTINGS, m1: { ...DEFAULT_DF_SETTINGS.m1 }, m2: { ...DEFAULT_DF_SETTINGS.m2 } };

    is_running = false;
    phase: Phase = 'idle';

    // Running stats
    total_profit   = 0;
    total_runs     = 0;
    m1_wins        = 0;
    m1_losses      = 0;
    m2_wins        = 0;
    m2_losses      = 0;
    consec_losses  = 0;
    consec_wins    = 0;

    // Live tick data
    last_digit:      number | null = null;
    last_quote:      number | null = null;
    last_tick_ms     = 0;
    has_live_tick    = false;
    tick_history:    number[] = [];
    pip_size         = 2;

    // Recovery martingale
    m2_current_stake = 0;

    // Cooldown
    cooldown_ticks_remaining = 0;

    // Event modal
    last_event: { kind: 'tp' | 'sl' | 'max_losses' | 'max_wins'; message: string } | null = null;

    transactions: DFTransaction[]  = [];
    journal:      DFJournalEntry[] = [];

    private listeners         = new Set<Listener>();
    private is_in_flight      = false;
    private tick_sub_id:      string | null = null;
    private msg_unsub:        (() => void) | null = null;
    private open_ids          = new Map<number, string>(); // contract_id → tx.id
    private current_phase_at_buy: Phase = 'idle';
    private watchdog:         ReturnType<typeof setInterval> | null = null;
    private in_flight_since:  number | null = null;
    private readonly IN_FLIGHT_TIMEOUT_MS = 15000;

    // ── Pub/sub ──────────────────────────────────────────────────────────────

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit() { this.listeners.forEach(l => l()); }

    private log(message: string, type: DFJournalEntry['type'] = 'info') {
        this.journal.unshift({
            id:   `j_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            time: Date.now(),
            type,
            message,
        });
        if (this.journal.length > 300) this.journal.length = 300;
        this.emit();
    }

    private addTx(tx: DFTransaction) {
        const existing = this.transactions.find(t => t.id === tx.id);
        if (existing) { Object.assign(existing, tx); this.emit(); return; }
        this.transactions.unshift(tx);
        if (this.transactions.length > 500) this.transactions.length = 500;
        this.emit();
    }

    // ── Public control ───────────────────────────────────────────────────────

    updateSettings(s: Partial<DollarFlowSettings>) {
        const prevSym = this.settings.symbol;
        this.settings = { ...this.settings, ...s };
        if (!this.is_running) {
            this.m2_current_stake = this.settings.m2.stake;
        }
        if (this.is_running && prevSym !== this.settings.symbol) {
            this.log(`Symbol changed → ${this.settings.symbol}, resubscribing`, 'warn');
            this.tick_history = [];
            this.has_live_tick = false;
            void this.unsubTicks().then(() => {
                if (this.is_running) void this.subTicks();
            });
        }
        this.emit();
    }

    async start() {
        if (this.is_running) return;
        if (!api_base.api) { this.log('API not connected — log in first.', 'error'); return; }
        if (!api_base.is_authorized) { this.log('Not authorized — log in first.', 'error'); return; }

        this.is_running         = true;
        this.is_in_flight       = false;
        this.phase              = 'idle';
        this.consec_losses      = 0;
        this.consec_wins        = 0;
        this.cooldown_ticks_remaining = 0;
        this.m2_current_stake   = this.settings.m2.stake;
        this.last_digit         = null;
        this.last_quote         = null;
        this.last_tick_ms       = 0;
        this.has_live_tick      = false;
        this.tick_history       = [];
        this.open_ids.clear();
        this.in_flight_since    = null;
        this.last_event         = null;

        const had = this.transactions.length > 0;
        this.log(
            had ? `Dollar Flow Bot resumed on ${this.settings.symbol}` : `Dollar Flow Bot started on ${this.settings.symbol}`,
            'success'
        );
        await this.subTicks();
        this.startWatchdog();
        this.emit();
    }

    async stop() {
        if (!this.is_running) return;
        this.is_running = false;
        this.is_in_flight = false;
        this.phase = 'idle';
        this.stopWatchdog();
        await this.unsubTicks();
        this.log('Dollar Flow Bot stopped', 'warn');
        this.emit();
    }

    resetStats() {
        this.transactions    = [];
        this.total_profit    = 0;
        this.total_runs      = 0;
        this.m1_wins = this.m1_losses = this.m2_wins = this.m2_losses = 0;
        this.last_event      = null;
        this.journal         = [];
        this.consec_losses   = 0;
        this.consec_wins     = 0;
        this.m2_current_stake = this.settings.m2.stake;
        this.log('Stats reset', 'info');
        this.emit();
    }

    clearLastEvent() { this.last_event = null; this.emit(); }

    // ── Tick subscription ────────────────────────────────────────────────────

    private async subTicks() {
        const api = api_base.api;
        if (!api) return;
        try {
            const sub = api.onMessage().subscribe((msg: any) => {
                if (!msg?.data) return;
                const d = msg.data;
                if (d.msg_type === 'tick' && d.tick?.symbol === this.settings.symbol) {
                    if (d.tick.pip_size) this.pip_size = Number(d.tick.pip_size);
                    if (d.tick.id) this.tick_sub_id = d.tick.id;
                    this.onTick(Number(d.tick.quote));
                }
                if (d.msg_type === 'proposal_open_contract' && d.proposal_open_contract?.is_sold) {
                    const poc = d.proposal_open_contract;
                    if (this.open_ids.has(poc.contract_id)) this.onSettle(poc);
                }
            });
            this.msg_unsub = () => sub.unsubscribe();
            await api.send({ ticks: this.settings.symbol, subscribe: 1 });
        } catch (e) {
            this.log(`Tick subscribe failed: ${formatApiError(e)}`, 'error');
            this.is_running = false;
            this.emit();
        }
    }

    private async unsubTicks() {
        try {
            const api = api_base.api;
            if (api && this.tick_sub_id) {
                await api.send({ forget: this.tick_sub_id });
                this.tick_sub_id = null;
            }
            this.msg_unsub?.();
            this.msg_unsub = null;
        } catch { /* ignore */ }
    }

    // ── Watchdog ─────────────────────────────────────────────────────────────

    private startWatchdog() {
        this.stopWatchdog();
        this.watchdog = setInterval(() => {
            if (!this.is_in_flight || this.in_flight_since === null) return;
            if (Date.now() - this.in_flight_since > this.IN_FLIGHT_TIMEOUT_MS) {
                this.log('⚠ Contract timed out (watchdog) — resetting in-flight', 'warn');
                this.is_in_flight = false;
                this.in_flight_since = null;
                this.open_ids.clear();
                this.emit();
            }
        }, 2000);
    }

    private stopWatchdog() {
        if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    }

    // ── Tick handler ─────────────────────────────────────────────────────────

    private onTick(quote: number) {
        const str    = quote.toFixed(this.pip_size);
        const digit  = Number(str.charAt(str.length - 1));
        this.last_quote = quote;
        this.last_digit = digit;
        this.last_tick_ms = Date.now();
        this.has_live_tick = true;
        this.tick_history.push(digit);
        if (this.tick_history.length > 200) this.tick_history.shift();

        if (this.cooldown_ticks_remaining > 0) {
            this.cooldown_ticks_remaining--;
            this.emit();
            if (this.cooldown_ticks_remaining === 0) {
                this.log('Cooldown ended — resuming Market 1', 'info');
                this.phase = 'idle';
            }
        }

        this.emit();
        if (!this.is_running) return;
        if (!this.is_in_flight && this.phase !== 'cooldown') void this.fireNextTrade();
    }

    // ── Trade dispatch ───────────────────────────────────────────────────────

    private isStale(): boolean {
        if (!this.has_live_tick) return true;
        return Date.now() - this.last_tick_ms > this.settings.stale_tick_ms;
    }

    private async fireNextTrade() {
        if (!this.is_running || this.is_in_flight) return;
        if (this.isStale()) return;

        if (this.phase === 'm2') {
            await this.buyM2();
        } else {
            await this.buyM1();
        }
    }

    private async buyM1() {
        const cfg = this.settings.m1;
        const barrier = barrierForConfig(cfg);
        const type    = apiContractType(cfg.side);
        this.current_phase_at_buy = 'm1';
        await this.buy(type, barrier, cfg.stake, cfg.duration);
    }

    private async buyM2() {
        const cfg     = this.settings.m2;
        const barrier = barrierForConfig(cfg);
        const type    = apiContractType(cfg.side);
        this.current_phase_at_buy = 'm2';
        await this.buy(type, barrier, this.m2_current_stake, cfg.duration);
    }

    private async buy(type: string, barrier: string | undefined, stake: number, duration: number) {
        const api = api_base.api;
        if (!api) return;
        this.is_in_flight = true;
        this.in_flight_since = Date.now();

        const market  = this.current_phase_at_buy === 'm2' ? 'M2' : 'M1';
        const amount  = Number(Math.min(stake, this.settings.max_stake_cap).toFixed(2));
        const label   = contractLabel(type, barrier);
        const txId    = `df_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        // Add pending row immediately
        this.addTx({
            id: txId, contract_id: null, contract_type: type, contract_label: label,
            symbol: this.settings.symbol, buy_price: amount, payout: 0,
            profit: 0, is_win: false, status: 'pending', market, time: Date.now(),
            entry_price: null, exit_price: null,
        });
        this.log(`⏳ BUY ${market} ${label} @ ${amount.toFixed(2)} — pending…`, 'info');

        try {
            const params: any = {
                amount,
                basis:         'stake',
                contract_type: type,
                currency:      (api_base as any).account_info?.currency || 'USD',
                duration:      Math.max(type === 'ASIANU' || type === 'ASIAND' ? 5 : 1, duration),
                duration_unit: 't',
                symbol:        this.settings.symbol,
            };
            if (barrier !== undefined) params.barrier = barrier;
            const res: any = await api.send({ buy: 1, price: amount, parameters: params });
            if (res?.error) {
                this.log(`Buy error: ${formatApiError(res)}`, 'error');
                const t = this.transactions.find(x => x.id === txId);
                if (t) { t.status = 'lost'; this.emit(); }
                this.is_in_flight = false;
                this.in_flight_since = null;
                return;
            }
            const buy = res.buy;
            this.open_ids.set(buy.contract_id, txId);
            const t = this.transactions.find(x => x.id === txId);
            if (t) { t.contract_id = buy.contract_id; t.buy_price = Number(buy.buy_price); this.emit(); }
            this.playBeep('buy');
            void api
                .send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 })
                .catch(() => { /* watchdog handles */ });
        } catch (e) {
            this.log(`Buy exception: ${formatApiError(e)}`, 'error');
            const t = this.transactions.find(x => x.id === txId);
            if (t) { t.status = 'lost'; this.emit(); }
            this.is_in_flight = false;
            this.in_flight_since = null;
        }
    }

    // ── Settle handler ───────────────────────────────────────────────────────

    private onSettle(poc: any) {
        const profit  = Number(poc.profit ?? 0);
        const is_win  = profit > 0;
        const barrier = poc.barrier !== undefined ? String(poc.barrier) : undefined;

        // Update the pending transaction row in-place
        const txId     = this.open_ids.get(poc.contract_id);
        const existing = txId ? this.transactions.find(t => t.id === txId) : null;
        const market   = existing?.market ?? (this.current_phase_at_buy === 'm2' ? 'M2' : 'M1');
        const ep = poc.entry_tick_display_value ?? poc.entry_spot_display_value ?? null;
        const xp = poc.exit_tick_display_value  ?? poc.exit_spot_display_value  ?? null;
        if (existing) {
            existing.contract_type  = poc.contract_type;
            existing.contract_label = contractLabel(poc.contract_type, barrier);
            existing.symbol         = poc.underlying || this.settings.symbol;
            existing.buy_price      = Number(poc.buy_price ?? 0);
            existing.payout         = Number(poc.payout ?? 0);
            existing.profit         = profit;
            existing.is_win         = is_win;
            existing.status         = is_win ? 'won' : 'lost';
            existing.time           = (poc.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
            existing.entry_price    = ep;
            existing.exit_price     = xp;
            this.emit();
        } else {
            this.addTx({
                id: `df_${poc.contract_id}`, contract_id: poc.contract_id,
                contract_type: poc.contract_type,
                contract_label: contractLabel(poc.contract_type, barrier),
                symbol: poc.underlying || this.settings.symbol,
                buy_price: Number(poc.buy_price ?? 0), payout: Number(poc.payout ?? 0),
                profit, is_win, status: is_win ? 'won' : 'lost', market,
                time: (poc.purchase_time || Math.floor(Date.now() / 1000)) * 1000,
                entry_price: ep, exit_price: xp,
            });
        }
        this.total_profit = Number((this.total_profit + profit).toFixed(2));
        this.total_runs++;
        this.open_ids.delete(poc.contract_id);
        this.is_in_flight = false;
        this.in_flight_since = null;

        if (market === 'M1') {
            if (is_win) this.m1_wins++; else this.m1_losses++;
        } else {
            if (is_win) this.m2_wins++; else this.m2_losses++;
        }

        this.log(
            `[${market}] ${is_win ? 'WIN' : 'LOSS'} ${existing?.contract_label ?? contractLabel(poc.contract_type, barrier)} profit ${profit.toFixed(2)} | total ${this.total_profit.toFixed(2)}`,
            is_win ? 'success' : 'error'
        );
        this.playBeep(is_win ? 'win' : 'loss');

        if (this.checkStopConditions()) return;

        // ── State machine ────────────────────────────────────────────────────
        if (market === 'M1') {
            if (is_win) {
                this.consec_wins++;
                this.consec_losses = 0;
                this.m2_current_stake = this.settings.m2.stake; // reset M2 stake
                this.phase = 'idle'; // stay on M1
                if (this.settings.max_consec_wins > 0 && this.consec_wins >= this.settings.max_consec_wins) {
                    this.log(`Max consecutive wins (${this.consec_wins}) reached — stopping.`, 'success');
                    this.last_event = { kind: 'max_wins', message: `${this.consec_wins} consecutive wins reached.` };
                    void this.stop(); return;
                }
            } else {
                this.consec_losses++;
                this.consec_wins = 0;
                if (this.settings.m2_enabled) {
                    this.phase = 'm2';
                    this.log(`M1 loss → entering M2 recovery (stake $${this.m2_current_stake.toFixed(2)})`, 'warn');
                } else {
                    this.phase = 'idle';
                }
                // Cooldown check (on consecutive loss count)
                if (this.settings.cooldown_enabled && this.consec_losses >= this.settings.cooldown_after_losses) {
                    this.phase = 'cooldown';
                    this.cooldown_ticks_remaining = this.settings.cooldown_duration_ticks;
                    this.log(`⏸ Cooldown triggered after ${this.consec_losses} losses — pausing ${this.cooldown_ticks_remaining} ticks`, 'warn');
                    this.emit();
                    return;
                }
            }
        } else {
            // Market 2 result
            if (is_win) {
                this.consec_wins++;
                this.consec_losses = 0;
                this.m2_current_stake = this.settings.m2.stake; // reset
                this.phase = 'idle'; // back to M1
                this.log('M2 recovery WIN — back to Market 1', 'success');
            } else {
                this.consec_losses++;
                this.consec_wins = 0;
                if (this.settings.martingale_enabled) {
                    const next = Number((this.m2_current_stake * this.settings.martingale_multiplier).toFixed(2));
                    this.m2_current_stake = Math.min(next, this.settings.max_stake_cap);
                    this.log(
                        `M2 loss → martingale → next stake $${this.m2_current_stake.toFixed(2)}` +
                        (next > this.settings.max_stake_cap ? ' (cap applied)' : ''),
                        'warn'
                    );
                }
                // Stay in M2 phase (continue recovery)
                this.phase = 'm2';
            }
        }

        if (this.checkStopConditions()) return;
        this.emit();
        // Fire next trade immediately (zero-latency)
        if (this.is_running && !this.is_in_flight && this.phase !== 'cooldown') {
            void this.fireNextTrade();
        }
    }

    // ── Stop condition checker ───────────────────────────────────────────────

    private checkStopConditions(): boolean {
        if (this.settings.take_profit > 0 && this.total_profit >= this.settings.take_profit) {
            this.log(`🎯 Take Profit hit ($${this.total_profit.toFixed(2)}) — stopping.`, 'success');
            this.last_event = { kind: 'tp', message: `Take Profit reached: +${this.total_profit.toFixed(2)}` };
            this.playBeep('tp');
            void this.stop(); return true;
        }
        if (this.settings.stop_loss > 0 && this.total_profit <= -Math.abs(this.settings.stop_loss)) {
            this.log(`🛑 Stop Loss hit ($${this.total_profit.toFixed(2)}) — stopping.`, 'error');
            this.last_event = { kind: 'sl', message: `Stop Loss reached: ${this.total_profit.toFixed(2)}` };
            this.playBeep('sl');
            void this.stop(); return true;
        }
        if (this.settings.max_consec_losses > 0 && this.consec_losses >= this.settings.max_consec_losses) {
            this.log(`⛔ Max consecutive losses (${this.consec_losses}) — stopping.`, 'error');
            this.last_event = { kind: 'max_losses', message: `${this.consec_losses} consecutive losses exceeded limit.` };
            this.playBeep('sl');
            void this.stop(); return true;
        }
        return false;
    }

    // ── Audio ─────────────────────────────────────────────────────────────────

    private playBeep(kind: 'win' | 'loss' | 'buy' | 'tp' | 'sl') {
        if (!this.settings.sound_enabled) return;
        if (typeof window === 'undefined') return;
        try {
            const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!Ctx) return;
            const ctx: AudioContext = (this as any)._audio_ctx || new Ctx();
            (this as any)._audio_ctx = ctx;
            const notes: Array<{ f: number; t: number; d: number; g: number }> = (() => {
                switch (kind) {
                    case 'win':  return [{ f: 1318.5, t: 0.00, d: 0.06, g: 0.18 }, { f: 1975.5, t: 0.05, d: 0.22, g: 0.22 }];
                    case 'loss': return [{ f: 440.0,  t: 0.00, d: 0.10, g: 0.14 }, { f: 349.2,  t: 0.09, d: 0.20, g: 0.13 }];
                    case 'tp':   return [{ f: 523.3, t: 0.00, d: 0.10, g: 0.18 }, { f: 659.3, t: 0.09, d: 0.10, g: 0.20 }, { f: 784.0, t: 0.18, d: 0.10, g: 0.20 }, { f: 1046.5, t: 0.27, d: 0.40, g: 0.24 }];
                    case 'sl':   return [{ f: 349.2, t: 0.00, d: 0.30, g: 0.16 }, { f: 261.6, t: 0.26, d: 0.45, g: 0.18 }];
                    case 'buy':  return [{ f: 1568.0, t: 0.00, d: 0.05, g: 0.10 }];
                }
            })();
            const t0 = ctx.currentTime;
            for (const n of notes) {
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.type = 'triangle'; o.frequency.value = n.f; g.gain.value = 0.0001;
                o.connect(g); g.connect(ctx.destination);
                const s = t0 + n.t;
                g.gain.exponentialRampToValueAtTime(n.g, s + 0.010);
                g.gain.exponentialRampToValueAtTime(0.0001, s + n.d);
                o.start(s); o.stop(s + n.d + 0.05);
            }
        } catch { /* best-effort */ }
    }

    // ── Analytics helpers ─────────────────────────────────────────────────────

    digitFrequencies() {
        const total = this.tick_history.length;
        return Array.from({ length: 10 }, (_, i) => {
            const c = this.tick_history.filter(d => d === i).length;
            return { digit: i, count: c, pct: total > 0 ? (c / total) * 100 : 0 };
        });
    }
}

export const dollarFlowEngine = new DollarFlowEngine();
