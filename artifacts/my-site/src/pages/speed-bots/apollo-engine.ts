import { api_base } from '@/external/bot-skeleton';

export type ApolloSettings = {
    symbol: string;
    stake: number;
    take_profit: number;
    stop_loss: number;
    martingale: number;
    martingale_enabled: boolean;
    contract_direction: 'over' | 'under';
    prediction: number;
    analysis_window: number;
    vh_max_steps: number;
    vh_min_trades: number;
    // Safety nets
    max_consec_losses: number; // pause after N consecutive real losses
    max_stake_multiplier: number; // hard cap on stake = saved_stake × this
    max_stake_action: 'reset' | 'pause'; // what to do when cap is hit
    recovery_cooldown_ticks: number; // wait N ticks after exiting recovery
    stale_tick_ms: number; // skip trade if last tick is older than this
    sound_enabled: boolean;
    // ── Deep-analysis recovery ────────────────────────────────────────────
    // After the first burst failure, fires contracts on digit dominance:
    // even% > odd% → buy DIGITEVEN, odd% > even% → buy DIGITODD.
    // Martingale applies on every loss; continues until P&L ≥ 0.
    // ── Rapid-fire mode ──────────────────────────────────────────────────
    // Fires a contract on a fixed time interval (default 1000ms = 1/sec)
    // using concurrent buys so contracts overlap. Each rapid contract uses
    // the BASE stake (no martingale escalation) and bypasses recovery
    // logic on settle — purpose is pure throughput, not recovery hunting.
    // TP / SL still respected per-settle. Tick-driven sequential firing is
    // disabled while rapid mode is on so the two paths don't fight.
    rapid_fire_enabled: boolean;
    rapid_fire_interval_ms: number;
};

export const DEFAULT_SETTINGS: ApolloSettings = {
    symbol: '1HZ10V',
    stake: 0.5,
    take_profit: 5,
    stop_loss: 30,
    martingale: 2,
    martingale_enabled: true,
    contract_direction: 'over',
    prediction: 1,
    analysis_window: 30,
    vh_max_steps: 2,
    vh_min_trades: 1,
    max_consec_losses: 6,
    max_stake_multiplier: 10,
    max_stake_action: 'reset',
    recovery_cooldown_ticks: 0,
    stale_tick_ms: 2000,
    sound_enabled: true,
    rapid_fire_enabled: false,
    rapid_fire_interval_ms: 1000,
};

export type ScanResult = {
    symbol: string;
    label: string;
    sample: number;
    // The user-chosen setup the scan was run against. We echo it back so the
    // UI can show "OVER 2 on Vol 75 wins 78%" without re-deriving anything.
    side: 'OVER' | 'UNDER';
    barrier: number;            // 1..8
    win_pct: number;            // observed win rate for this setup on this symbol
    edge: number;               // win_pct − random hit rate (pp)
    error?: string;
};

export type Transaction = {
    id: string;
    contract_id: number | null;
    contract_type: string;
    contract_label: string;
    symbol: string;
    buy_price: number;
    payout: number;
    profit: number;
    is_win: boolean;
    is_virtual: boolean;
    status: 'pending' | 'won' | 'lost';
    barrier?: string;
    entry_spot?: number;
    exit_spot?: number;
    time: number;
};

export type JournalEntry = {
    id: string;
    time: number;
    type: 'info' | 'success' | 'error' | 'warn';
    message: string;
};

type Listener = () => void;

/** Robustly extract a human-readable string from any error shape returned
 *  by the Deriv API or thrown by the SDK. Handles {error:{message,code}},
 *  {message}, plain strings, and unknown objects (last-resort JSON). */
const formatApiError = (e: any): string => {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    const apiErr = e?.error?.message || e?.error?.error?.message;
    if (apiErr) {
        const code = e?.error?.code || e?.error?.error?.code;
        return code ? `${apiErr} (${code})` : apiErr;
    }
    if (e?.message && typeof e.message === 'string') return e.message;
    try {
        return JSON.stringify(e);
    } catch {
        return String(e);
    }
};

const formatContractLabel = (type: string, barrier?: string) => {
    switch (type) {
        case 'DIGITOVER':
            return `Over ${barrier ?? ''}`.trim();
        case 'DIGITUNDER':
            return `Under ${barrier ?? ''}`.trim();
        case 'DIGITEVEN':
            return 'Even';
        case 'DIGITODD':
            return 'Odd';
        case 'DIGITMATCH':
            return `Match ${barrier ?? ''}`.trim();
        case 'DIGITDIFF':
            return `Diff ${barrier ?? ''}`.trim();
        default:
            return type;
    }
};

class ApolloEngine {
    settings: ApolloSettings = { ...DEFAULT_SETTINGS };
    is_running = false;
    is_in_flight = false;
    current_stake = DEFAULT_SETTINGS.stake;
    saved_stake = DEFAULT_SETTINGS.stake;
    recovery_mode = false;
    vh_enabled = false;
    virtual_loss_count = 0;
    virtual_trade_count = 0;
    virtual_wins = 0;
    virtual_losses = 0;
    virtual_pl = 0;
    total_profit = 0;
    total_runs = 0;
    wins = 0;
    losses = 0;
    last_digit: number | null = null;
    last_quote: number | null = null;
    last_tick_epoch: number | null = null;
    last_event: { kind: 'tp' | 'sl'; at: number; message?: string } | null = null;
    tick_stream: { quote: number; digit: number; time: number }[] = [];
    tick_history: number[] = [];
    transactions: Transaction[] = [];
    journal: JournalEntry[] = [];
    tick_subscription_id: string | null = null;
    pip_size = 2;
    msg_unsub: (() => void) | null = null;
    private listeners = new Set<Listener>();
    private current_contract_id: number | null = null;
    private open_contract_ids = new Map<number, string>(); // contract_id → tx.id
    private last_recovery_choice: 'DIGITEVEN' | 'DIGITODD' | null = null;
    // Recovery-burst state: a "burst" is the TOTAL number of real Even/Odd
    // shots fired per VH-triggered cycle (the trigger trade IS shot 1). If any
    // shot wins → exit recovery; if all RECOVERY_BURST_SIZE shots lose → return
    // to VH analysis (does NOT exit recovery to base).
    burst_side: 'DIGITEVEN' | 'DIGITODD' | null = null;
    burst_shots_left = 0;
    private readonly RECOVERY_BURST_SIZE = 2;
    private virtual_loss_side: 'DIGITEVEN' | 'DIGITODD' | null = null;
    private in_flight_since: number | null = null;
    private watchdog_timer: ReturnType<typeof setInterval> | null = null;
    private readonly IN_FLIGHT_TIMEOUT_MS = 12000;
    // Safety / stats state
    consecutive_losses = 0;
    max_loss_streak = 0;
    current_streak: { kind: 'W' | 'L' | null; count: number } = { kind: null, count: 0 };
    circuit_paused = false;
    last_tick_ms = 0;
    has_live_tick = false;
    cooldown_ticks_remaining = 0;
    // ── Deep-analysis state ───────────────────────────────────────────────
    // Counts burst failures; once ≥ 1 deep analysis trades on dominance
    // with martingale until total P&L returns to ≥ 0.
    burst_failure_count = 0;
    observation_ticks_since_burst_failure = 0;
    // Live deep-analysis status shown in the UI.
    last_filter_status: {
        pass: boolean;
        reason?: string;
        z?: number;
        side?: 'DIGITEVEN' | 'DIGITODD';
        at: number;
        tier_label: string;
        z_threshold: number;
    } | null = null;
    private last_filter_reason: string | null = null;
    private last_announced_tier_label: string | null = null;
    // Rapid-fire mode state: timer ID and the contract IDs born from the
    // rapid path so the settle handler can skip recovery escalation for
    // them (they're pure throughput, not state-driven trades).
    private rapid_fire_timer: ReturnType<typeof setInterval> | null = null;
    private rapid_contract_ids: Set<number> = new Set();

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit() {
        this.listeners.forEach(l => l());
    }

    private addJournal(message: string, type: JournalEntry['type'] = 'info') {
        this.journal.unshift({
            id: `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            time: Date.now(),
            type,
            message,
        });
        if (this.journal.length > 200) this.journal.length = 200;
        this.emit();
    }

    private addTransaction(tx: Transaction) {
        const existing = this.transactions.find(t => t.id === tx.id);
        if (existing) { Object.assign(existing, tx); this.emit(); return; }
        this.transactions.unshift(tx);
        if (this.transactions.length > 300) this.transactions.length = 300;
        this.emit();
    }

    resetTransactions() {
        this.transactions = [];
        this.total_profit = 0;
        this.total_runs = 0;
        this.wins = 0;
        this.losses = 0;
        this.virtual_wins = 0;
        this.virtual_losses = 0;
        this.virtual_pl = 0;
        this.virtual_trade_count = 0;
        this.virtual_loss_count = 0;
        this.virtual_loss_side = null;
        this.last_event = null;
        // Clear the journal alongside transactions so the panels stay in
        // sync — a fresh start means a clean slate everywhere.
        this.journal = [];
        this.addJournal('Transactions and journal reset', 'info');
        this.emit();
    }

    updateSettings(s: Partial<ApolloSettings>) {
        const prev_symbol = this.settings.symbol;
        const prev_stake = this.settings.stake;
        const prev_rapid_enabled = this.settings.rapid_fire_enabled;
        const prev_rapid_interval = this.settings.rapid_fire_interval_ms;
        this.settings = { ...this.settings, ...s };

        // Live-toggle rapid-fire mode: start/stop the timer immediately when
        // the user flips the switch, and restart it if the interval changes,
        // so the running bot reflects the new settings without a stop/start.
        if (this.is_running) {
            if (prev_rapid_enabled !== this.settings.rapid_fire_enabled) {
                if (this.settings.rapid_fire_enabled) {
                    this.startRapidFireTimer();
                } else {
                    this.stopRapidFireTimer();
                    this.addJournal('⚡ Rapid-fire OFF — sequential mode resumed', 'info');
                    // Sequential path was idle while rapid was on; kick it.
                    if (!this.is_in_flight && !this.recovery_mode) {
                        void this.maybeBuy();
                    }
                }
            } else if (
                this.settings.rapid_fire_enabled &&
                prev_rapid_interval !== this.settings.rapid_fire_interval_ms
            ) {
                this.stopRapidFireTimer();
                this.startRapidFireTimer();
            }
        }

        if (!this.is_running) {
            this.current_stake = this.settings.stake;
            this.saved_stake = this.settings.stake;
        } else {
            // Live edits while running: always update the BASE stake (saved_stake)
            // so the next reset uses the new value. If we are not currently
            // martingaling (i.e. not in recovery and current matches old saved),
            // also update current_stake immediately.
            if (prev_stake !== this.settings.stake) {
                if (!this.recovery_mode && this.current_stake === this.saved_stake) {
                    this.current_stake = this.settings.stake;
                }
                this.saved_stake = this.settings.stake;
                this.addJournal(`Base stake updated → ${this.settings.stake}`, 'info');
            }
            // Symbol changed mid-run: re-subscribe to the new symbol's ticks.
            if (prev_symbol !== this.settings.symbol) {
                this.addJournal(
                    `Symbol changed ${prev_symbol} → ${this.settings.symbol}, re-subscribing ticks`,
                    'warn'
                );
                this.tick_history = [];
                this.tick_stream = [];
                this.last_digit = null;
                this.last_quote = null;
                this.last_tick_epoch = null;
                this.has_live_tick = false;
                this.last_tick_ms = 0;
                void this.unsubscribeTicks().then(() => {
                    if (this.is_running) {
                        void this.preloadTickHistory().then(() => this.subscribeTicks());
                    }
                });
            }
        }
        this.emit();
    }

    async start() {
        if (this.is_running) return;
        if (!api_base.api) {
            this.addJournal('API not connected. Please log in.', 'error');
            return;
        }
        if (!api_base.is_authorized) {
            this.addJournal('Not authorized. Please log in to your Deriv account.', 'error');
            return;
        }
        this.is_running = true;
        this.is_in_flight = false;
        this.current_stake = this.settings.stake;
        this.saved_stake = this.settings.stake;
        this.recovery_mode = false;
        this.vh_enabled = false;
        // ── Bot-state reset (per-session control flow) ─────────────────────
        // We deliberately KEEP transactions, totals (wins/losses/total_profit),
        // virtual stats, max_loss_streak, last_event and journal across
        // start/stop cycles so the user's history persists. Use the explicit
        // "Reset" button to clear those.
        this.virtual_loss_count = 0;
        this.virtual_trade_count = 0;
        this.last_digit = null;
        this.last_quote = null;
        this.last_tick_epoch = null;
        this.tick_stream = [];
        this.tick_history = [];
        this.last_recovery_choice = null;
        this.virtual_loss_side = null;
        this.burst_side = null;
        this.burst_shots_left = 0;
        this.consecutive_losses = 0;
        this.current_streak = { kind: null, count: 0 };
        this.circuit_paused = false;
        this.last_tick_ms = 0;
        this.has_live_tick = false;
        this.cooldown_ticks_remaining = 0;
        this.burst_failure_count = 0;
        this.observation_ticks_since_burst_failure = 0;
        this.last_filter_status = null;
        this.last_filter_reason = null;
        this.last_announced_tier_label = null;
        this.rapid_contract_ids.clear();
        this.open_contract_ids.clear();
        this.current_contract_id = null;
        const had_history = this.transactions.length > 0;
        this.addJournal(
            had_history
                ? `Over Under Virtual Hook Pro resumed on ${this.settings.symbol} — ${this.transactions.length} prior tx kept`
                : `Over Under Virtual Hook Pro started on ${this.settings.symbol}`,
            'success'
        );
        // Pre-fetch tick history AND subscribe to ticks IN PARALLEL so the
        // first trade can fire ~200 ms sooner. preloadTickHistory fills the
        // analysis window (so VH / barrier analysis works from trade #1) and
        // also marks `has_live_tick = true` using the preloaded "latest" tick,
        // which lets the immediate first buy below pass the stale-tick guard
        // instead of waiting ~500-1000 ms for the first live tick.
        await Promise.all([this.preloadTickHistory(), this.subscribeTicks()]);
        this.startWatchdog();
        this.emit();
        // Rapid-fire mode owns the firing schedule; do NOT also fire a
        // sequential trade or it would run afterPurchase recovery on settle
        // and corrupt state. In normal mode, fire the first trade immediately.
        if (this.settings.rapid_fire_enabled) {
            this.startRapidFireTimer();
        } else if (this.is_running && !this.is_in_flight && !this.recovery_mode) {
            void this.maybeBuy();
        }
    }

    private startRapidFireTimer() {
        if (this.rapid_fire_timer) return;
        const interval = Math.max(250, this.settings.rapid_fire_interval_ms || 1000);
        this.addJournal(
            `⚡ Rapid-fire ON — firing one contract every ${interval}ms (~${Math.round(60000 / interval)}/min)`,
            'success'
        );
        this.rapid_fire_timer = setInterval(() => {
            void this.fireRapidBuy();
        }, interval);
    }

    private stopRapidFireTimer() {
        if (this.rapid_fire_timer) {
            clearInterval(this.rapid_fire_timer);
            this.rapid_fire_timer = null;
        }
    }

    /** Fires a concurrent buy on a fixed time interval — pure throughput.
     *  Uses the BASE stake and the user's main Over/Under direction. Recovery,
     *  martingale and burst logic are bypassed for these contracts at settle
     *  so concurrent in-flight contracts don't corrupt sequential state. */
    private async fireRapidBuy() {
        if (!this.is_running) return;
        // Late-toggle guard: if rapid mode was switched off after this tick
        // was queued by setInterval, skip placing the contract.
        if (!this.settings.rapid_fire_enabled) return;
        if (this.circuit_paused) return;
        if (this.isTickStale()) return;
        // Don't add more contracts while another is in the API submit phase
        // for a NORMAL sequential path; the rapid timer should NOT collide
        // with a recovery-mode sequential trade.
        if (this.recovery_mode) return;
        // Cap concurrent in-flight rapid contracts to a safe ceiling so a
        // network slowdown doesn't spawn a runaway queue.
        if (this.rapid_contract_ids.size >= 8) return;
        const type = this.settings.contract_direction === 'under' ? 'DIGITUNDER' : 'DIGITOVER';
        const barrier = String(this.settings.prediction);
        // Pass an explicit stake so concurrent rapid buys never mutate the
        // shared current_stake — that race would clobber the value mid-flight
        // when sequential live-edits happen alongside rapid firing.
        const id = await this.buy({ type, barrier }, true, this.saved_stake);
        if (id !== null && id !== undefined) {
            this.rapid_contract_ids.add(id);
        }
    }

    async stop() {
        if (!this.is_running) return;
        this.is_running = false;
        this.stopRapidFireTimer();
        // Clear rapid-mode tracking so a later start() doesn't see stale IDs.
        // Any contracts still open at this point will not have their settles
        // processed (we unsubscribe below), so retaining them serves nothing.
        this.rapid_contract_ids.clear();
        this.stopWatchdog();
        await this.unsubscribeTicks();
        this.addJournal('Over Under Virtual Hook Pro stopped', 'warn');
        this.emit();
    }

    private startWatchdog() {
        this.stopWatchdog();
        this.watchdog_timer = setInterval(() => {
            if (
                this.is_in_flight &&
                this.in_flight_since !== null &&
                Date.now() - this.in_flight_since > this.IN_FLIGHT_TIMEOUT_MS
            ) {
                this.addJournal(
                    `Watchdog: contract ${this.current_contract_id ?? '?'} stalled, polling result…`,
                    'warn'
                );
                void this.pollContractAndRecover();
            }
        }, 3000);
    }

    private stopWatchdog() {
        if (this.watchdog_timer) {
            clearInterval(this.watchdog_timer);
            this.watchdog_timer = null;
        }
    }

    private async pollContractAndRecover() {
        const api = api_base.api;
        const cid = this.current_contract_id;
        if (!api || !cid) {
            this.is_in_flight = false;
            this.in_flight_since = null;
            this.emit();
            return;
        }
        try {
            const res: any = await api.send({ proposal_open_contract: 1, contract_id: cid });
            const poc = res?.proposal_open_contract;
            if (poc && (poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost')) {
                this.handleContractClose(poc);
                return;
            }
            this.addJournal(`Watchdog: contract ${cid} still open, releasing flag`, 'warn');
        } catch (e: any) {
            this.addJournal(`Watchdog poll failed: ${formatApiError(e)} — releasing flag`, 'error');
        }
        this.is_in_flight = false;
        this.in_flight_since = null;
        this.current_contract_id = null;
        this.emit();
    }

    private async preloadTickHistory() {
        try {
            const api = api_base.api;
            if (!api) return;
            const res: any = await api.send({
                ticks_history: this.settings.symbol,
                count: Math.max(this.settings.analysis_window, 30),
                end: 'latest',
                style: 'ticks',
            });
            const prices: any[] = res?.history?.prices || [];
            const times: any[] = res?.history?.times || [];
            if (prices.length === 0) return;
            if (res?.pip_size) this.pip_size = Number(res.pip_size);
            const now = Date.now();
            for (let i = 0; i < prices.length; i++) {
                const q = Number(prices[i]);
                if (!Number.isFinite(q)) continue;
                const d = this.extractLastDigit(q);
                this.tick_history.push(d);
                this.tick_stream.push({
                    quote: q,
                    digit: d,
                    time: times[i] ? Number(times[i]) * 1000 : now - (prices.length - i) * 100,
                });
            }
            if (this.tick_history.length > this.settings.analysis_window) {
                this.tick_history = this.tick_history.slice(-this.settings.analysis_window);
            }
            if (this.tick_stream.length > 40) this.tick_stream = this.tick_stream.slice(-40);
            // Mark live-tick state from the preloaded "latest" tick so the
            // immediate first buy after start() passes the stale-tick guard
            // instead of waiting ~500-1000 ms for the first streamed tick.
            // RACE GUARD: preload + subscribe run in parallel, so a streamed
            // tick may have already updated last_tick_ms / last_quote / last_digit
            // via handleTick before this code runs. Only overwrite when the
            // preloaded "latest" tick is actually newer, and only mark
            // has_live_tick=true when the preloaded tick is fresh enough to
            // pass the stale-tick guard (otherwise let the live stream do it).
            const lastTickTimeSec =
                times.length > 0 ? Number(times[times.length - 1]) : NaN;
            const preloadedMs = Number.isFinite(lastTickTimeSec)
                ? lastTickTimeSec * 1000
                : Date.now();
            const lastQ = Number(prices[prices.length - 1]);
            if (preloadedMs > this.last_tick_ms) {
                this.last_tick_ms = preloadedMs;
                if (Number.isFinite(lastQ)) {
                    this.last_quote = lastQ;
                    this.last_digit = this.extractLastDigit(lastQ);
                }
            }
            if (Date.now() - preloadedMs <= this.settings.stale_tick_ms) {
                this.has_live_tick = true;
            }
            this.addJournal(`Pre-loaded ${prices.length} ticks for analysis`, 'info');
        } catch {
            // ignore — live stream will fill the window
        }
    }

    /** Resume the bot after the circuit breaker tripped. Resets stake to base
     *  and clears recovery state so the next trade is a fresh Over. */
    resumeFromCircuit() {
        if (!this.circuit_paused) return;
        this.circuit_paused = false;
        this.consecutive_losses = 0;
        this.current_stake = this.saved_stake;
        this.recovery_mode = false;
        this.vh_enabled = false;
        this.virtual_loss_count = 0;
        this.virtual_trade_count = 0;
        this.virtual_loss_side = null;
        this.last_recovery_choice = null;
        this.burst_side = null;
        this.burst_shots_left = 0;
        this.cooldown_ticks_remaining = 0;
        this.burst_failure_count = 0;
        this.observation_ticks_since_burst_failure = 0;
        this.last_filter_status = null;
        this.last_filter_reason = null;
        this.last_announced_tier_label = null;
        this.addJournal('▶ Resumed from circuit breaker', 'success');
        this.emit();
        // In rapid-fire mode the timer drives buys; don't kick a sequential
        // contract here or it'd run afterPurchase on settle and corrupt state.
        if (this.is_running && !this.is_in_flight && !this.settings.rapid_fire_enabled) {
            void this.maybeBuy();
        }
    }

    /** Win-rate per barrier over current analysis window for both directions.
     *  Over barrier b → digit > b (valid b ∈ 0..8).
     *  Under barrier b → digit < b (valid b ∈ 1..9). */
    barrierWinRates(): {
        over: { barrier: number; pct: number; n: number }[];
        under: { barrier: number; pct: number; n: number }[];
    } {
        const total = this.tick_history.length;
        const over = Array.from({ length: 9 }, (_, b) => ({
            barrier: b,
            pct: total > 0 ? (this.tick_history.filter(d => d > b).length / total) * 100 : 0,
            n: total,
        }));
        const under = Array.from({ length: 9 }, (_, i) => {
            const b = i + 1;
            return {
                barrier: b,
                pct: total > 0 ? (this.tick_history.filter(d => d < b).length / total) * 100 : 0,
                n: total,
            };
        });
        return { over, under };
    }

    /** True if no live tick has arrived yet, OR the most recent tick is too old. */
    isTickStale(): boolean {
        if (!this.has_live_tick) return true;
        return Date.now() - this.last_tick_ms > this.settings.stale_tick_ms;
    }

    private playBeep(kind: 'win' | 'loss' | 'tp' | 'sl' | 'buy') {
        if (!this.settings.sound_enabled) return;
        if (typeof window === 'undefined') return;
        try {
            const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!Ctx) return;
            const ctx: AudioContext = (this as any)._audio_ctx || new Ctx();
            (this as any)._audio_ctx = ctx;

            // Warm bell-style cues. Each note is rendered as a triangle wave
            // (sweet, woody) blended with a sine harmonic an octave up at
            // ~30% gain (adds a soft "shimmer" without harshness). Smooth
            // exponential attack/release prevents clicks. All sequences are
            // tuned to be pleasant on repeat — not piercing, not muddy.
            // Each note: { f: fundamental Hz, t: start offset s, d: duration s, g: peak gain }
            const notes: Array<{ f: number; t: number; d: number; g: number }> = (() => {
                switch (kind) {
                    // WIN — Mario-coin style: short stab → bright sustained note.
                    // Two-note motif feels rewarding without being intrusive.
                    case 'win':
                        return [
                            { f: 1318.5, t: 0.00, d: 0.06, g: 0.18 }, // E6 stab
                            { f: 1975.5, t: 0.05, d: 0.22, g: 0.22 }, // B6 sustain
                        ];
                    // LOSS — soft minor-third descent on warm low octave.
                    // Acknowledges the loss without sounding punishing.
                    case 'loss':
                        return [
                            { f: 440.0, t: 0.00, d: 0.10, g: 0.14 }, // A4
                            { f: 349.2, t: 0.09, d: 0.20, g: 0.13 }, // F4
                        ];
                    // TP — full ascending C-major arpeggio + octave landing.
                    // Sounds like "level complete" — celebratory but classy.
                    case 'tp':
                        return [
                            { f: 523.3, t: 0.00, d: 0.10, g: 0.18 }, // C5
                            { f: 659.3, t: 0.09, d: 0.10, g: 0.20 }, // E5
                            { f: 784.0, t: 0.18, d: 0.10, g: 0.20 }, // G5
                            { f: 1046.5, t: 0.27, d: 0.40, g: 0.24 }, // C6 sustain
                        ];
                    // SL — soft low alert, perfect 4th → tonic. Serious but
                    // not alarming. Slow attack so it feels like a warning,
                    // not a buzzer.
                    case 'sl':
                        return [
                            { f: 349.2, t: 0.00, d: 0.30, g: 0.16 }, // F4
                            { f: 261.6, t: 0.26, d: 0.45, g: 0.18 }, // C4 resolve
                        ];
                    // BUY — single short, high "tick". Confirms the order
                    // landed without ever competing with WIN/LOSS that
                    // follows ~1 tick later.
                    case 'buy':
                        return [
                            { f: 1568.0, t: 0.00, d: 0.05, g: 0.10 }, // G6 tick
                        ];
                }
            })();

            const t0 = ctx.currentTime;
            for (const n of notes) {
                // Main triangle voice — sweet, woody fundamental.
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'triangle';
                o.frequency.value = n.f;
                g.gain.value = 0.0001;
                o.connect(g);
                g.connect(ctx.destination);
                const start = t0 + n.t;
                g.gain.exponentialRampToValueAtTime(n.g, start + 0.010);
                g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
                o.start(start);
                o.stop(start + n.d + 0.05);

                // Octave-up sine harmonic — adds a soft shimmer without harshness.
                // Skipped on the BUY tick to keep it minimal/pure.
                if (kind !== 'buy') {
                    const o2 = ctx.createOscillator();
                    const g2 = ctx.createGain();
                    o2.type = 'sine';
                    o2.frequency.value = n.f * 2;
                    g2.gain.value = 0.0001;
                    o2.connect(g2);
                    g2.connect(ctx.destination);
                    const peak2 = n.g * 0.30;
                    g2.gain.exponentialRampToValueAtTime(peak2, start + 0.010);
                    g2.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
                    o2.start(start);
                    o2.stop(start + n.d + 0.05);
                }
            }
        } catch {
            // best-effort
        }
    }

    private async subscribeTicks() {
        try {
            const api = api_base.api;
            if (!api) return;
            const sub = api.onMessage().subscribe((msg: any) => {
                if (!msg?.data) return;
                const data = msg.data;
                if (data.msg_type === 'tick' && data.tick && data.tick.symbol === this.settings.symbol) {
                    this.tick_subscription_id = data.tick.id || this.tick_subscription_id;
                    if (data.tick.pip_size) this.pip_size = Number(data.tick.pip_size);
                    if (data.tick.epoch) this.last_tick_epoch = Number(data.tick.epoch);
                    this.handleTick(Number(data.tick.quote));
                }
                if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                    const poc = data.proposal_open_contract;
                    if (this.open_contract_ids.has(poc.contract_id) && poc.is_sold) {
                        this.handleContractClose(poc);
                    }
                }
            });
            this.msg_unsub = () => sub.unsubscribe();
            await api.send({ ticks: this.settings.symbol, subscribe: 1 });
        } catch (e: any) {
            this.addJournal(`Failed to subscribe to ticks: ${formatApiError(e)}`, 'error');
            this.is_running = false;
            this.emit();
        }
    }

    private async unsubscribeTicks() {
        try {
            const api = api_base.api;
            if (!api) return;
            if (this.tick_subscription_id) {
                await api.send({ forget: this.tick_subscription_id });
                this.tick_subscription_id = null;
            }
            this.msg_unsub?.();
            this.msg_unsub = null;
        } catch {
            // ignore
        }
    }

    private extractLastDigit(quote: number): number {
        const formatted = quote.toFixed(this.pip_size);
        const last = formatted.charAt(formatted.length - 1);
        const n = Number(last);
        return Number.isFinite(n) ? n : 0;
    }

    /** Volatility scan FOR THE USER'S CHOSEN SETUP. Uses the bot's current
     *  contract_direction + prediction (barrier) — never overrides them.
     *  For each volatility:
     *    1. Pulls ~500 ticks
     *    2. Computes win-rate of the user's setup on those ticks (edge vs random)
     *    3. Finds the entry digit that, when it appears, gives the highest
     *       conditional win-rate for that setup
     *  Results are sorted by edge desc so the user can pick a stronger market. */
    async scanVolatilities(symbols: { value: string; label: string }[]): Promise<ScanResult[]> {
        const api = api_base.api;
        if (!api) return [];
        const side: 'OVER' | 'UNDER' = this.settings.contract_direction === 'under' ? 'UNDER' : 'OVER';
        const barrier = Math.max(1, Math.min(8, Math.round(this.settings.prediction)));
        const random_win = side === 'OVER' ? ((9 - barrier) / 10) * 100 : (barrier / 10) * 100;
        const empty = (sym: { value: string; label: string }, error?: string): ScanResult => ({
            symbol: sym.value,
            label: sym.label,
            sample: 0,
            side,
            barrier,
            win_pct: 0,
            edge: 0,
            error,
        });
        this.addJournal(
            `🔍 Scanning ${symbols.length} volatilities for ${side} ${barrier} (your setup)…`,
            'info'
        );
        const isWin = (next: number): boolean =>
            side === 'OVER' ? next > barrier : next < barrier;
        const results = await Promise.all(
            symbols.map(async sym => {
                try {
                    const res: any = await api.send({
                        ticks_history: sym.value,
                        count: 500,
                        end: 'latest',
                        style: 'ticks',
                    });
                    if (res?.error) return empty(sym, res.error.message || 'fetch error');
                    const prices: any[] = res?.history?.prices || [];
                    if (prices.length < 50) return empty(sym, 'insufficient ticks');
                    const pip = Number(res?.pip_size ?? this.pip_size);
                    const digits: number[] = [];
                    for (const p of prices) {
                        const q = Number(p);
                        if (!Number.isFinite(q)) continue;
                        const formatted = q.toFixed(pip);
                        const ch = formatted.charAt(formatted.length - 1);
                        const d = Number(ch);
                        if (Number.isFinite(d)) digits.push(d);
                    }
                    const n = digits.length;
                    if (n < 50) return empty(sym, 'insufficient ticks');

                    // Win-rate of the user's setup on this symbol's recent ticks.
                    let wins = 0;
                    for (const d of digits) {
                        if (isWin(d)) wins += 1;
                    }
                    const win_pct = (wins / n) * 100;
                    const edge = win_pct - random_win;

                    return {
                        symbol: sym.value,
                        label: sym.label,
                        sample: n,
                        side,
                        barrier,
                        win_pct,
                        edge,
                    };
                } catch (e: any) {
                    return empty(sym, e?.message || 'fetch failed');
                }
            })
        );
        // Rank by edge — highest-edge volatility for the user's setup wins.
        results.sort((a, b) => b.edge - a.edge);
        const top = results[0];
        if (top && top.edge > 0) {
            this.addJournal(
                `✅ Scan done — best: ${top.label} for ${side} ${barrier} (edge +${top.edge.toFixed(2)}pp over ${top.sample} ticks)`,
                'success'
            );
        } else {
            this.addJournal(
                `⚠ Scan done — no symbol shows a tradeable edge for ${side} ${barrier} right now`,
                'warn'
            );
        }
        return results;
    }

    /** Apply a scan result — ONLY updates the symbol. Direction and barrier
     *  are user-controlled and the scan was performed for those exact values. */
    applyScanResult(r: ScanResult) {
        this.updateSettings({ symbol: r.symbol });
        this.addJournal(
            `📌 Applied: ${r.label} for ${r.side} ${r.barrier} (edge +${r.edge.toFixed(2)}pp)`,
            'success'
        );
    }

    private handleTick(quote: number) {
        const lastDigit = this.extractLastDigit(quote);
        const prevDigit = this.last_digit;
        this.last_digit = lastDigit;
        this.last_quote = quote;
        this.last_tick_ms = Date.now();
        this.has_live_tick = true;

        // Decrement cooldown on EVERY incoming tick (true tick-count semantics),
        // even if the last digit didn't change.
        if (this.cooldown_ticks_remaining > 0) {
            this.cooldown_ticks_remaining -= 1;
        }

        const digitChanged = prevDigit === null || prevDigit !== lastDigit;
        if (digitChanged) {
            this.tick_stream.push({ quote, digit: lastDigit, time: Date.now() });
            if (this.tick_stream.length > 40) this.tick_stream.shift();
            this.tick_history.push(lastDigit);
            if (this.tick_history.length > this.settings.analysis_window) {
                this.tick_history.shift();
            }

            if (this.vh_enabled && this.recovery_mode && !this.is_in_flight) {
                this.evaluateVirtualPick(lastDigit);
            }
        }

        this.emit();
        if (!this.is_running) return;
        // Sequential trading — only one contract in flight at a time.
        // Zero-latency next trade is fired immediately when a contract settles
        // (see handleContractClose), so this tick path only fires when idle.
        // In rapid-fire mode the timer drives buys; the tick path stays out
        // of the way so we don't double-fire and exceed the requested rate.
        if (this.settings.rapid_fire_enabled) return;
        if (!this.is_in_flight) void this.maybeBuy();
    }

    private evaluateVirtualPick(lastDigit: number) {
        if (this.last_recovery_choice !== null) {
            const prevChoice = this.last_recovery_choice;
            const wouldWin =
                prevChoice === 'DIGITEVEN' ? lastDigit % 2 === 0 : lastDigit % 2 === 1;
            this.virtual_trade_count += 1;
            const stake = this.current_stake;
            const virtualPayout = stake * 1.95;
            const virtualProfit = wouldWin ? Number((virtualPayout - stake).toFixed(2)) : -stake;
            this.virtual_pl = Number((this.virtual_pl + virtualProfit).toFixed(2));
            if (wouldWin) {
                this.virtual_wins += 1;
                this.virtual_loss_count = 0;
                this.virtual_loss_side = null;
            } else {
                this.virtual_losses += 1;
                if (this.virtual_loss_side === prevChoice) {
                    this.virtual_loss_count += 1;
                } else {
                    this.virtual_loss_count = 1;
                    this.virtual_loss_side = prevChoice;
                }
            }
            this.addTransaction({
                id: `vtx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                contract_id: null,
                contract_type: prevChoice,
                contract_label: formatContractLabel(prevChoice),
                symbol: this.settings.symbol,
                buy_price: stake,
                payout: wouldWin ? Number(virtualPayout.toFixed(2)) : 0,
                profit: virtualProfit,
                is_win: wouldWin,
                is_virtual: true,
                status: wouldWin ? 'won' : 'lost',
                entry_spot: this.last_quote ?? undefined,
                exit_spot: this.last_quote ?? undefined,
                time: Date.now(),
            });
            this.addJournal(
                `Virtual ${formatContractLabel(prevChoice)} ${wouldWin ? 'WIN' : 'LOSS'} (vL ${this.virtual_loss_count}/${this.settings.vh_max_steps})`,
                wouldWin ? 'info' : 'info'
            );
        }

        const choice = this.chooseRecoveryContract();
        this.last_recovery_choice = choice;
    }

    evenPercentage(): number {
        if (this.tick_history.length === 0) return 0;
        const evens = this.tick_history.filter(d => d % 2 === 0).length;
        return (evens / this.tick_history.length) * 100;
    }

    oddPercentage(): number {
        if (this.tick_history.length === 0) return 0;
        return 100 - this.evenPercentage();
    }

    digitFrequencies(): { digit: number; count: number; pct: number }[] {
        const total = this.tick_history.length;
        const counts = Array.from({ length: 10 }, () => 0);
        this.tick_history.forEach(d => {
            counts[d] = (counts[d] || 0) + 1;
        });
        return counts.map((count, digit) => ({
            digit,
            count,
            pct: total > 0 ? (count / total) * 100 : 0,
        }));
    }

    private chooseRecoveryContract(): 'DIGITEVEN' | 'DIGITODD' | null {
        if (this.last_digit === null) return null;
        if (this.tick_history.length < this.settings.analysis_window) return null;

        const evenPct = this.evenPercentage();
        const oddPct = this.oddPercentage();
        const lastIsOdd = this.last_digit % 2 === 1;
        const lastIsEven = this.last_digit % 2 === 0;

        if (evenPct > oddPct && lastIsOdd) return 'DIGITEVEN';
        if (oddPct > evenPct && lastIsEven) return 'DIGITODD';
        return null;
    }

    private async maybeBuy() {
        if (!this.is_running) return;

        // Sequential gating for all modes — one contract at a time.
        if (this.is_in_flight) return;

        // Circuit breaker — bot is paused after too many consecutive losses.
        if (this.circuit_paused) return;

        // Stale-tick guard — skip trade if last tick is too old (e.g. WS reconnect).
        if (this.isTickStale()) return;

        if (!this.recovery_mode) {
            // Post-recovery cooldown — wait N ticks before resuming after a win.
            if (this.cooldown_ticks_remaining > 0) return;

            // Epoch-last-digit converter filter — only enter a trade when the last
            // digit of the tick epoch matches the predicted direction:
            //   Over  → epoch % 10 is 0-4  (lower half)
            //   Under → epoch % 10 is 5-9  (upper half)
            // If the epoch is unknown yet, skip and wait for the next tick.
            if (this.last_tick_epoch !== null) {
                const epochDigit = this.last_tick_epoch % 10;
                const isOver = this.settings.contract_direction === 'over';
                const epochMatch = isOver ? epochDigit <= 4 : epochDigit >= 5;
                if (!epochMatch) {
                    return;
                }
            }

            const type = this.settings.contract_direction === 'under' ? 'DIGITUNDER' : 'DIGITOVER';
            await this.buy({ type, barrier: String(this.settings.prediction) });
            return;
        }

        // Recovery burst — takes precedence over VH / filter analysis. After
        // a recovery trigger trade loses, fire (RECOVERY_BURST_SIZE - 1) more
        // shots on the same side so the cycle totals RECOVERY_BURST_SIZE real
        // shots. Mid-burst shots bypass all filters by design.
        if (this.burst_side !== null && this.burst_shots_left > 0) {
            const side = this.burst_side;
            this.burst_shots_left -= 1;
            const fired = this.RECOVERY_BURST_SIZE - this.burst_shots_left;
            this.addJournal(
                `Recovery burst ${fired}/${this.RECOVERY_BURST_SIZE}: ${formatContractLabel(side)} at stake ${this.current_stake}`,
                'warn'
            );
            await this.buy({ type: side });
            return;
        }

        // Deep-analysis recovery: after a full burst failure, bypass VH entirely
        // and trade directly on digit dominance. If even% > odd% AND the most
        // recent consecutive digits are even → buy DIGITEVEN immediately.
        // Vice-versa for odd. Tie (exact 50/50) → wait one more tick.
        if (this.burst_failure_count >= 1) {
            const history = this.tick_history;
            if (history.length < 2) return; // not enough data yet

            const evens = history.filter(d => d % 2 === 0).length;
            const odds  = history.length - evens;
            const evenPct = (evens / history.length) * 100;
            const oddPct  = (odds  / history.length) * 100;

            // Count trailing consecutive streak of the dominant parity.
            let streak = 0;
            if (evens !== odds) {
                const dominantIsEven = evens > odds;
                for (let i = history.length - 1; i >= 0; i--) {
                    if ((history[i] % 2 === 0) === dominantIsEven) streak++;
                    else break;
                }
            }

            if (evens === odds) {
                // Perfect tie — wait for one more tick to break the deadlock.
                this.last_filter_status = {
                    pass: false,
                    reason: `Tie — even ${evenPct.toFixed(1)}% = odd ${oddPct.toFixed(1)}%, waiting`,
                    at: Date.now(),
                    tier_label: 'Deep Analysis',
                    z_threshold: 0,
                };
                this.emit();
                return;
            }

            const side: 'DIGITEVEN' | 'DIGITODD' = evens > odds ? 'DIGITEVEN' : 'DIGITODD';
            const dominantPct = evens > odds ? evenPct : oddPct;
            this.last_filter_status = {
                pass: true,
                z: dominantPct / 100,
                side,
                at: Date.now(),
                tier_label: 'Deep Analysis',
                z_threshold: 0,
            };
            this.addJournal(
                `🔬 Deep Analysis → ${formatContractLabel(side)} ` +
                `(${evens > odds ? 'even' : 'odd'} ${dominantPct.toFixed(1)}% dominant, ` +
                `${streak} consecutive streak) — VH bypassed`,
                'success'
            );
            this.observation_ticks_since_burst_failure = 0;
            this.last_filter_reason = null;
            this.last_announced_tier_label = null;
            this.virtual_loss_count = 0;
            this.virtual_loss_side = null;
            this.last_recovery_choice = null;
            await this.buy({ type: side });
            return;
        }

        if (this.vh_enabled) {
            if (
                this.virtual_loss_count < this.settings.vh_max_steps ||
                this.virtual_trade_count < this.settings.vh_min_trades ||
                this.virtual_loss_side === null
            ) {
                return;
            }
            const side = this.virtual_loss_side;
            this.addJournal(
                `VH triggered: ${this.virtual_loss_count} consecutive ${formatContractLabel(side)} losses → REAL ${formatContractLabel(side)}`,
                'warn'
            );
            // Reset VH state immediately so next tick after settle starts fresh,
            // and no virtual entries are recorded between fire and settle.
            this.virtual_loss_count = 0;
            this.virtual_loss_side = null;
            this.last_recovery_choice = null;
            await this.buy({ type: side });
            return;
        }

        const choice = this.chooseRecoveryContract();
        if (!choice) return;
        await this.buy({ type: choice });
    }

    private async buy(
        contract: { type: string; barrier?: string },
        concurrent: boolean = false,
        explicit_stake?: number
    ): Promise<number | null> {
        const api = api_base.api;
        if (!api) return null;
        if (!concurrent) {
            this.is_in_flight = true;
            this.in_flight_since = Date.now();
        }
        const stake_basis = explicit_stake !== undefined ? explicit_stake : this.current_stake;
        const stake = Number(stake_basis.toFixed(2));
        const label = formatContractLabel(contract.type, contract.barrier);

        // Pending row — appears in the journal table immediately
        const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.addTransaction({
            id: txId, contract_id: null, contract_type: contract.type,
            contract_label: label, symbol: this.settings.symbol,
            buy_price: stake, payout: 0, profit: 0,
            is_win: false, is_virtual: false, status: 'pending',
            barrier: contract.barrier, time: Date.now(),
        });
        this.addJournal(`⏳ BUY ${label} @ ${stake.toFixed(2)} — pending…`, 'info');

        try {
            // Single-shot BUY with parameters — skips the proposal round trip
            // and goes straight to placing the contract. Saves ~150–300 ms per
            // trade on slow networks. Concurrent callers may pass an explicit
            // stake so they don't race on the shared current_stake field.
            const buy_params: any = {
                amount: stake,
                basis: 'stake',
                contract_type: contract.type,
                currency: (api_base as any).account_info?.currency || 'USD',
                duration: 1,
                duration_unit: 't',
                symbol: this.settings.symbol,
            };
            if (contract.barrier !== undefined) buy_params.barrier = contract.barrier;

            let buy_res: any;
            try {
                buy_res = await api.send({ buy: 1, price: stake, parameters: buy_params });
            } catch (err: any) {
                this.addJournal(`Buy request failed: ${formatApiError(err)}`, 'error');
                const t = this.transactions.find(x => x.id === txId);
                if (t) { t.status = 'lost'; this.emit(); }
                if (!concurrent) { this.is_in_flight = false; this.in_flight_since = null; }
                return null;
            }
            if (buy_res?.error) {
                this.addJournal(`Buy error: ${formatApiError(buy_res)}`, 'error');
                const t = this.transactions.find(x => x.id === txId);
                if (t) { t.status = 'lost'; this.emit(); }
                if (!concurrent) { this.is_in_flight = false; this.in_flight_since = null; }
                return null;
            }
            const buy = buy_res.buy;
            if (!concurrent) this.current_contract_id = buy.contract_id;
            // Light bell — confirms a real contract was placed, before outcome.
            this.playBeep('buy');
            this.open_contract_ids.set(buy.contract_id, txId);
            // Update pending row with real buy price / contract_id
            const t = this.transactions.find(x => x.id === txId);
            if (t) { t.contract_id = buy.contract_id; t.buy_price = Number(buy.buy_price); this.emit(); }
            this.addJournal(
                `BUY ${label} @ ${buy.buy_price.toFixed(2)} — id ${buy.contract_id}`,
                'info'
            );
            // Fire-and-forget the contract subscribe — the global onMessage
            // listener handles the settle event regardless, and awaiting this
            // ack would needlessly add ~150 ms of latency per trade on slow
            // networks. The watchdog covers the rare case where the subscribe
            // genuinely fails.
            void api
                .send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 })
                .catch((subErr: any) => {
                    this.addJournal(
                        `Contract subscribe failed (${subErr?.error?.message || subErr?.message || 'unknown'}) — watchdog will poll`,
                        'warn'
                    );
                });
            return buy.contract_id;
        } catch (e: any) {
            this.addJournal(`Buy exception: ${formatApiError(e)}`, 'error');
            const t = this.transactions.find(x => x.id === txId);
            if (t) { t.status = 'lost'; this.emit(); }
            if (!concurrent) { this.is_in_flight = false; this.in_flight_since = null; }
            return null;
        }
    }

    private handleContractClose(poc: any) {
        const profit = Number(poc.profit ?? 0);
        const is_win = profit > 0;
        const barrier = poc.barrier !== undefined ? String(poc.barrier) : undefined;
        // Detect rapid-fire contracts so we can record the result without
        // mutating sequential recovery / martingale state. Multiple rapid
        // contracts can settle out of order; afterPurchase would corrupt the
        // bot if it ran on every one.
        const isRapidContract = this.rapid_contract_ids.has(poc.contract_id);
        const txId  = this.open_contract_ids.get(poc.contract_id) ?? `tx_${poc.contract_id}`;
        const tx: Transaction = {
            id: txId,
            contract_id: poc.contract_id,
            contract_type: poc.contract_type,
            contract_label: formatContractLabel(poc.contract_type, barrier),
            symbol: poc.underlying || this.settings.symbol,
            buy_price: Number(poc.buy_price ?? 0),
            payout: Number(poc.payout ?? 0),
            profit,
            is_win,
            is_virtual: false,
            status: is_win ? 'won' : 'lost',
            barrier,
            entry_spot: poc.entry_spot ? Number(poc.entry_spot) : undefined,
            exit_spot: poc.exit_spot ? Number(poc.exit_spot) : undefined,
            time: (poc.purchase_time || Math.floor(Date.now() / 1000)) * 1000,
        };
        this.addTransaction(tx);
        this.total_profit = Number((this.total_profit + profit).toFixed(2));
        this.total_runs += 1;
        if (is_win) this.wins += 1;
        else this.losses += 1;
        this.addJournal(
            `${isRapidContract ? '⚡ ' : ''}${is_win ? 'WIN' : 'LOSS'} on ${tx.contract_label} — profit ${profit.toFixed(2)} | total ${this.total_profit.toFixed(2)}`,
            is_win ? 'success' : 'error'
        );
        if (isRapidContract) {
            // Rapid path: clear contract from tracking, play sound, check
            // TP/SL, but DO NOT touch sequential recovery state.
            this.rapid_contract_ids.delete(poc.contract_id);
            this.open_contract_ids.delete(poc.contract_id);
            this.playBeep(is_win ? 'win' : 'loss');
            // Honour TP / SL even in rapid mode — stop everything if hit.
            if (
                this.settings.take_profit > 0 &&
                this.total_profit >= this.settings.take_profit
            ) {
                this.addJournal(
                    `🎯 TAKE-PROFIT hit (${this.total_profit.toFixed(2)} ≥ ${this.settings.take_profit}). Stopping.`,
                    'success'
                );
                this.playBeep('tp');
                void this.stop();
            } else if (
                this.settings.stop_loss > 0 &&
                this.total_profit <= -Math.abs(this.settings.stop_loss)
            ) {
                this.addJournal(
                    `🛑 STOP-LOSS hit (${this.total_profit.toFixed(2)} ≤ -${this.settings.stop_loss}). Stopping.`,
                    'error'
                );
                this.playBeep('sl');
                void this.stop();
            }
            this.emit();
            return;
        }
        this.afterPurchase(is_win, poc.contract_type);
        this.open_contract_ids.delete(poc.contract_id);
        if (this.current_contract_id === poc.contract_id) {
            this.current_contract_id = null;
            this.is_in_flight = false;
            this.in_flight_since = null;
        }
        this.emit();
        // Zero-latency: fire next trade immediately on settle without
        // waiting for the next tick. Only when still running and not
        // already in flight (afterPurchase may have called stop on TP/SL).
        // Skip when rapid-fire owns the firing schedule.
        if (this.is_running && !this.is_in_flight && !this.settings.rapid_fire_enabled) {
            void this.maybeBuy();
        }
    }

    private afterPurchase(is_win: boolean, contract_type?: string) {
        const isRecoveryContract = contract_type === 'DIGITEVEN' || contract_type === 'DIGITODD';

        // Streak tracking (real trades only — this method is only called for real settles).
        if (is_win) {
            if (this.current_streak.kind === 'W') this.current_streak.count += 1;
            else this.current_streak = { kind: 'W', count: 1 };
        } else {
            if (this.current_streak.kind === 'L') this.current_streak.count += 1;
            else this.current_streak = { kind: 'L', count: 1 };
        }

        if (!is_win) {
            this.consecutive_losses += 1;
            if (this.consecutive_losses > this.max_loss_streak) {
                this.max_loss_streak = this.consecutive_losses;
            }
            this.playBeep('loss');
            const wasInRecovery = this.recovery_mode;
            if (!wasInRecovery) {
                this.recovery_mode = true;
                this.vh_enabled = true;
                this.virtual_loss_count = 0;
                this.virtual_trade_count = 0;
                this.virtual_loss_side = null;
                this.last_recovery_choice = null;
                this.burst_side = null;
                this.burst_shots_left = 0;
                this.addJournal('Recovery Mode ENABLED, Virtual Hook ON', 'warn');
            }
            if (this.settings.martingale_enabled) {
                this.current_stake = Number((this.current_stake * this.settings.martingale).toFixed(2));
                this.addJournal(`Martingale x${this.settings.martingale} → next stake ${this.current_stake}`, 'warn');
            } else if (wasInRecovery) {
                this.addJournal(`Martingale OFF → stake stays at ${this.current_stake}`, 'warn');
            }
            // Recovery-burst / deep-analysis loss routing.
            else if (wasInRecovery && isRecoveryContract) {
                if (this.burst_failure_count >= 1) {
                    // ── Deep-analysis mode ────────────────────────────────────
                    // A deep-analysis contract just lost. Apply martingale
                    // (already done above), keep burst_failure_count ≥ 1 so
                    // the next maybeBuy re-evaluates dominance and fires again
                    // with the scaled stake. No burst arming — just re-check.
                    this.observation_ticks_since_burst_failure = 0;
                    this.burst_side = null;
                    this.virtual_loss_count = 0;
                    this.virtual_trade_count = 0;
                    this.virtual_loss_side = null;
                    this.last_recovery_choice = null;
                    this.addJournal(
                        `🔬 Deep Analysis LOSS — martingale stake now ${this.current_stake}, re-evaluating dominance`,
                        'warn'
                    );
                } else if (this.burst_side === null) {
                    // ── Normal burst trigger ───────────────────────────────────
                    // First shot of a VH-triggered burst lost — arm remaining shots.
                    this.burst_side = contract_type as 'DIGITEVEN' | 'DIGITODD';
                    this.burst_shots_left = Math.max(0, this.RECOVERY_BURST_SIZE - 1);
                    if (this.burst_shots_left > 0) {
                        this.addJournal(
                            `Recovery trigger LOST (shot 1/${this.RECOVERY_BURST_SIZE}) → arming ${this.burst_shots_left} more ${formatContractLabel(this.burst_side)} shot(s)`,
                            'warn'
                        );
                    } else {
                        this.burst_failure_count += 1;
                        this.observation_ticks_since_burst_failure = 0;
                        this.addJournal(
                            `Recovery burst #${this.burst_failure_count} exhausted (${this.RECOVERY_BURST_SIZE} loss) → deep-analysis active`,
                            'warn'
                        );
                        this.burst_side = null;
                        this.virtual_loss_count = 0;
                        this.virtual_trade_count = 0;
                        this.virtual_loss_side = null;
                        this.last_recovery_choice = null;
                    }
                } else if (this.burst_shots_left === 0) {
                    // ── Final burst shot lost ──────────────────────────────────
                    this.burst_failure_count += 1;
                    this.observation_ticks_since_burst_failure = 0;
                    this.addJournal(
                        `Recovery burst #${this.burst_failure_count} exhausted (${this.RECOVERY_BURST_SIZE} losses) → deep-analysis active`,
                        'warn'
                    );
                    this.burst_side = null;
                    this.virtual_loss_count = 0;
                    this.virtual_trade_count = 0;
                    this.virtual_loss_side = null;
                    this.last_recovery_choice = null;
                }
                // else: mid-burst loss — next maybeBuy fires the next shot.
            }

            // ── SAFETY: stake-cap enforcement ─────────────────────────────────
            // Recovery only ever ends on a recovery WIN. The cap-reset path
            // therefore resets ONLY the stake; recovery_mode / vh_enabled /
            // burst state stay intact so the bot keeps hunting for the
            // recovery win at the base stake instead of falling back to the
            // original Over/Under direction prematurely.
            const cap = Number((this.saved_stake * this.settings.max_stake_multiplier).toFixed(2));
            if (this.current_stake > cap) {
                if (this.settings.max_stake_action === 'pause') {
                    this.circuit_paused = true;
                    this.addJournal(
                        `⛔ Stake cap hit (${this.current_stake} > ${cap}) — bot paused. Press Resume to continue.`,
                        'error'
                    );
                } else {
                    this.current_stake = this.saved_stake;
                    if (this.recovery_mode) {
                        this.addJournal(
                            `⚠️ Stake cap hit (> ${cap}) — stake reset to base ${this.saved_stake}, recovery STAYS ON until a recovery win`,
                            'warn'
                        );
                    } else {
                        this.addJournal(
                            `⚠️ Stake cap hit (> ${cap}) — stake reset to base ${this.saved_stake}`,
                            'warn'
                        );
                    }
                }
            }

            // ── SAFETY: circuit breaker on consecutive losses ─────────────────
            if (this.consecutive_losses >= this.settings.max_consec_losses && !this.circuit_paused) {
                this.circuit_paused = true;
                this.addJournal(
                    `⛔ Circuit breaker: ${this.consecutive_losses} consecutive losses — bot paused. Press Resume to continue.`,
                    'error'
                );
            }
        } else {
            // WIN
            this.consecutive_losses = 0;
            this.playBeep('win');
            const wasInRecovery = this.recovery_mode;
            const wasInDeepAnalysis = wasInRecovery && this.burst_failure_count >= 1;

            // Always reset stake to base on a win.
            this.current_stake = this.saved_stake;
            this.burst_side = null;
            this.burst_shots_left = 0;
            this.virtual_loss_count = 0;
            this.virtual_trade_count = 0;
            this.virtual_loss_side = null;
            this.last_recovery_choice = null;
            this.observation_ticks_since_burst_failure = 0;

            if (wasInDeepAnalysis && this.total_profit < 0) {
                // ── Deep-analysis partial win: still net negative ─────────────
                // Stake is reset to base but recovery stays ON — deep-analysis
                // keeps firing (dominance check each trade) until P&L ≥ 0.
                // burst_failure_count stays ≥ 1 so maybeBuy stays in deep-
                // analysis mode; VH stays off for this cycle.
                this.last_filter_status = null;
                this.last_filter_reason = null;
                this.last_announced_tier_label = null;
                this.addJournal(
                    `✅ Deep Analysis WIN — stake reset to ${this.current_stake}, but P&L still ${this.total_profit.toFixed(2)} → continuing deep analysis until positive`,
                    'warn'
                );
            } else {
                // ── Full recovery exit (P&L ≥ 0 or was normal recovery) ───────
                this.recovery_mode = false;
                this.vh_enabled = false;
                this.burst_failure_count = 0;
                this.last_filter_status = null;
                this.last_filter_reason = null;
                this.last_announced_tier_label = null;
                if (wasInDeepAnalysis) {
                    this.addJournal(
                        `✅ Deep Analysis complete — P&L ${this.total_profit.toFixed(2)} ≥ 0, recovery OFF, resuming normal trading`,
                        'success'
                    );
                } else if (wasInRecovery && this.settings.recovery_cooldown_ticks > 0) {
                    this.cooldown_ticks_remaining = this.settings.recovery_cooldown_ticks;
                    this.addJournal(
                        `Reset stake to ${this.current_stake}, Recovery OFF, cooldown ${this.cooldown_ticks_remaining} tick(s)`,
                        'success'
                    );
                } else if (wasInRecovery) {
                    this.addJournal(
                        `Reset stake to ${this.current_stake}, Recovery OFF — resuming original market immediately`,
                        'success'
                    );
                } else {
                    this.addJournal(`Reset stake to ${this.current_stake}, Recovery OFF`, 'success');
                }
            }
        }

        if (this.settings.take_profit > 0 && this.total_profit >= this.settings.take_profit) {
            this.addJournal('Take Profit Hit!!!', 'success');
            this.last_event = { kind: 'tp', at: Date.now() };
            this.playBeep('tp');
            void this.stop();
            return;
        }
        if (this.settings.stop_loss > 0 && this.total_profit <= -this.settings.stop_loss) {
            this.addJournal('Stop Loss Hit!!!', 'error');
            this.last_event = { kind: 'sl', at: Date.now() };
            this.playBeep('sl');
            void this.stop();
            return;
        }
    }

    clearLastEvent() {
        this.last_event = null;
        this.emit();
    }
}

export const apolloEngine = new ApolloEngine();
