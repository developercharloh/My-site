import { api_base } from '@/external/bot-skeleton';

// ─── Settings ─────────────────────────────────────────────────────────────────

export type OULookback = 1 | 2 | 3 | 4;

export interface OUSettings {
    symbol:               string;
    stake:                number;
    lookback:             OULookback;
    over_threshold:       number;
    under_threshold:      number;
    martingale_enabled:   boolean;
    martingale_multiplier: number;
    max_stake_cap:        number;
    take_profit:          number;
    stop_loss:            number;
    consec_wins_target:   number;
    sound_enabled:        boolean;
    stale_tick_ms:        number;
}

export const DEFAULT_OU_SETTINGS: OUSettings = {
    symbol:               'R_25',
    stake:                0.5,
    lookback:             1,
    over_threshold:       2,
    under_threshold:      7,
    martingale_enabled:   true,
    martingale_multiplier: 3.5,
    max_stake_cap:        50,
    take_profit:          30,
    stop_loss:            30,
    consec_wins_target:   4,
    sound_enabled:        true,
    stale_tick_ms:        3000,
};

// ─── Transaction / journal types ──────────────────────────────────────────────

export type OUTrade = {
    id:            string;
    contract_id:   number | null;
    contract_type: string;
    label:         string;
    symbol:        string;
    buy_price:     number;
    payout:        number;
    profit:        number;
    is_win:        boolean;
    status:        'pending' | 'won' | 'lost';
    time:          number;
    entry_price:   string | null;
    exit_price:    string | null;
};

export type OUJournalEntry = {
    id:      string;
    time:    number;
    type:    'info' | 'success' | 'error' | 'warn';
    message: string;
};

// ─── Signal type ──────────────────────────────────────────────────────────────

export type OUSignal = 'over' | 'under' | 'none';

// ─── Scanner types ─────────────────────────────────────────────────────────────

export type OUScanResult = {
    symbol:      string;
    label:       string;
    hit_rate:    number;
    over_count:  number;
    under_count: number;
    total_ticks: number;
};

export type OUScanStatus = 'idle' | 'scanning' | 'done' | 'error';

type Listener = () => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtApiErr = (e: any): string => {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    const msg = e?.error?.message || e?.error?.error?.message;
    if (msg) return msg;
    if (e?.message) return String(e.message);
    try { return JSON.stringify(e); } catch { return String(e); }
};

export const ALL_SYMBOLS: { value: string; label: string }[] = [
    { value: 'R_10',    label: 'Volatility 10 Index' },
    { value: 'R_25',    label: 'Volatility 25 Index' },
    { value: 'R_50',    label: 'Volatility 50 Index' },
    { value: 'R_75',    label: 'Volatility 75 Index' },
    { value: 'R_100',   label: 'Volatility 100 Index' },
    { value: '1HZ10V',  label: 'Volatility 10 (1s)' },
    { value: '1HZ25V',  label: 'Volatility 25 (1s)' },
    { value: '1HZ50V',  label: 'Volatility 50 (1s)' },
    { value: '1HZ75V',  label: 'Volatility 75 (1s)' },
    { value: '1HZ100V', label: 'Volatility 100 (1s)' },
];

// ─── Over/Under Engine ────────────────────────────────────────────────────────

export class OUEngine {
    settings: OUSettings = { ...DEFAULT_OU_SETTINGS };

    is_running    = false;
    total_profit  = 0;
    total_runs    = 0;
    wins          = 0;
    losses        = 0;
    consec_wins   = 0;
    consec_losses = 0;

    current_stake = DEFAULT_OU_SETTINGS.stake;

    last_digit:    number | null = null;
    last_quote:    number | null = null;
    last_tick_ms   = 0;
    has_live_tick  = false;
    tick_history:  number[] = [];
    pip_size       = 2;

    current_signal: OUSignal = 'none';

    last_event: { kind: 'tp' | 'sl' | 'wins'; message: string } | null = null;

    trades:  OUTrade[]       = [];
    journal: OUJournalEntry[] = [];

    // Scanner state
    scan_status:  OUScanStatus   = 'idle';
    scan_results: OUScanResult[] = [];
    scan_progress = 0;

    private listeners        = new Set<Listener>();
    private is_in_flight     = false;
    private tick_sub_id:     string | null = null;
    private msg_unsub:       (() => void) | null = null;
    private open_ids         = new Map<number, string>(); // contract_id → trade.id
    private watchdog:        ReturnType<typeof setInterval> | null = null;
    private in_flight_since: number | null = null;
    private readonly IN_FLIGHT_TIMEOUT_MS = 15000;

    // ── Pub/sub ──────────────────────────────────────────────────────────────

    subscribe(fn: Listener) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit() { this.listeners.forEach(l => l()); }

    private log(message: string, type: OUJournalEntry['type'] = 'info') {
        this.journal.unshift({
            id:   `j_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            time: Date.now(),
            type,
            message,
        });
        if (this.journal.length > 300) this.journal.length = 300;
        this.emit();
    }

    private addTrade(tx: OUTrade) {
        const existing = this.trades.find(t => t.id === tx.id);
        if (existing) { Object.assign(existing, tx); this.emit(); return; }
        this.trades.unshift(tx);
        if (this.trades.length > 500) this.trades.length = 500;
        this.emit();
    }

    // ── Public control ───────────────────────────────────────────────────────

    updateSettings(s: Partial<OUSettings>) {
        const prevSym = this.settings.symbol;
        this.settings = { ...this.settings, ...s };
        if (!this.is_running) {
            this.current_stake = this.settings.stake;
        }
        if (this.is_running && prevSym !== this.settings.symbol) {
            this.log(`Symbol changed → ${this.settings.symbol}, resubscribing`, 'warn');
            this.tick_history = [];
            this.has_live_tick = false;
            this.current_signal = 'none';
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

        this.is_running     = true;
        this.is_in_flight   = false;
        this.current_stake  = this.settings.stake;
        this.consec_wins    = 0;
        this.consec_losses  = 0;
        this.last_digit     = null;
        this.last_quote     = null;
        this.last_tick_ms   = 0;
        this.has_live_tick  = false;
        this.tick_history   = [];
        this.current_signal = 'none';
        this.open_ids.clear();
        this.in_flight_since = null;
        this.last_event      = null;

        const had = this.trades.length > 0;
        this.log(
            had
                ? `O2U7 Bot resumed on ${this.settings.symbol}`
                : `O2U7 Bot started on ${this.settings.symbol}`,
            'success'
        );
        await this.subTicks();
        this.startWatchdog();
        this.emit();
    }

    async stop() {
        if (!this.is_running) return;
        this.is_running   = false;
        this.is_in_flight = false;
        this.current_signal = 'none';
        this.stopWatchdog();
        await this.unsubTicks();
        this.log('O2U7 Bot stopped', 'warn');
        this.emit();
    }

    resetStats() {
        this.trades         = [];
        this.total_profit   = 0;
        this.total_runs     = 0;
        this.wins = this.losses = 0;
        this.last_event     = null;
        this.journal        = [];
        this.current_stake  = this.settings.stake;
        this.consec_losses  = 0;
        this.log('Stats reset', 'info');
        this.emit();
    }

    clearLastEvent() { this.last_event = null; this.emit(); }

    // ── Volatility Scanner ───────────────────────────────────────────────────

    async scanBestVolatility() {
        const api = api_base.api;
        if (!api) {
            this.log('Cannot scan — not connected. Log in first.', 'error');
            return;
        }

        this.scan_status   = 'scanning';
        this.scan_results  = [];
        this.scan_progress = 0;
        this.emit();

        const overThreshold  = this.settings.over_threshold;
        const underThreshold = this.settings.under_threshold;
        const pipSize        = this.pip_size;

        const TICKS_COUNT = 500;
        const symbols     = ALL_SYMBOLS;
        const total       = symbols.length;
        const results: OUScanResult[] = [];

        const tasks = symbols.map(async ({ value: sym, label }) => {
            try {
                const res: any = await api.send({
                    ticks_history: sym,
                    count: TICKS_COUNT,
                    end: 'latest',
                    style: 'ticks',
                });
                const prices: number[] = res?.history?.prices ?? [];
                let over_count = 0;
                let under_count = 0;
                prices.forEach((p: number) => {
                    const str   = p.toFixed(pipSize);
                    const digit = Number(str.charAt(str.length - 1));
                    if (digit <= overThreshold)  over_count++;
                    if (digit >= underThreshold) under_count++;
                });
                const total_ticks = prices.length;
                const hit_rate = total_ticks > 0
                    ? Math.round(((over_count + under_count) / total_ticks) * 100)
                    : 0;
                results.push({ symbol: sym, label, hit_rate, over_count, under_count, total_ticks });
            } catch {
                results.push({ symbol: sym, label, hit_rate: 0, over_count: 0, under_count: 0, total_ticks: 0 });
            }
            this.scan_progress = Math.round((results.length / total) * 100);
            this.emit();
        });

        await Promise.allSettled(tasks);

        results.sort((a, b) => b.hit_rate - a.hit_rate);
        this.scan_results = results;
        this.scan_status  = 'done';
        this.emit();

        if (results.length > 0) {
            this.log(`Scanner done — best: ${results[0].label} (${results[0].hit_rate}% hit rate)`, 'success');
        }
    }

    dismissScanResults() {
        this.scan_status = 'idle';
        this.emit();
    }

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
            this.log(`Tick subscribe failed: ${fmtApiErr(e)}`, 'error');
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
                this.log('⚠ Contract timed out (watchdog) — resetting', 'warn');
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

    // ── Signal detection ─────────────────────────────────────────────────────

    private detectSignal(): OUSignal {
        const n = this.settings.lookback;
        if (this.tick_history.length < n) return 'none';
        const last = this.tick_history.slice(-n);
        if (last.every(d => d <= this.settings.over_threshold)) return 'over';
        if (last.every(d => d >= this.settings.under_threshold)) return 'under';
        return 'none';
    }

    // ── Tick handler ─────────────────────────────────────────────────────────

    private onTick(quote: number) {
        const str  = quote.toFixed(this.pip_size);
        const digit = Number(str.charAt(str.length - 1));
        this.last_quote   = quote;
        this.last_digit   = digit;
        this.last_tick_ms = Date.now();
        this.has_live_tick = true;
        this.tick_history.push(digit);
        if (this.tick_history.length > 200) this.tick_history.shift();

        this.current_signal = this.detectSignal();
        this.emit();

        if (!this.is_running || this.is_in_flight) return;
        if (Date.now() - this.last_tick_ms > this.settings.stale_tick_ms) return;
        if (this.current_signal !== 'none') void this.fireTrade(this.current_signal);
    }

    // ── Trade ────────────────────────────────────────────────────────────────

    private async fireTrade(signal: OUSignal) {
        if (!this.is_running || this.is_in_flight || signal === 'none') return;
        const api = api_base.api;
        if (!api) return;

        const contractType = signal === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
        const barrier      = signal === 'over'
            ? String(this.settings.over_threshold)
            : String(this.settings.under_threshold);
        const label = signal === 'over'
            ? `Over ${this.settings.over_threshold}`
            : `Under ${this.settings.under_threshold}`;

        const stake = Number(
            Math.min(this.current_stake, this.settings.max_stake_cap).toFixed(2)
        );

        this.is_in_flight    = true;
        this.in_flight_since = Date.now();

        // Pending entry — visible in UI immediately before API responds
        const tradeId = `ou_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const pendingTrade: OUTrade = {
            id: tradeId, contract_id: null, contract_type: contractType,
            label, symbol: this.settings.symbol, buy_price: stake,
            payout: 0, profit: 0, is_win: false, status: 'pending',
            time: Date.now(), entry_price: null, exit_price: null,
        };
        this.addTrade(pendingTrade);
        this.log(`⏳ BUY ${label} @ $${stake.toFixed(2)} — pending…`, 'info');

        try {
            const params: any = {
                amount:        stake,
                basis:         'stake',
                contract_type: contractType,
                currency:      (api_base as any).account_info?.currency || 'USD',
                duration:      1,
                duration_unit: 't',
                symbol:        this.settings.symbol,
                barrier,
            };
            const res: any = await api.send({ buy: 1, price: stake, parameters: params });
            if (res?.error) {
                this.log(`Buy error: ${fmtApiErr(res)}`, 'error');
                const t = this.trades.find(x => x.id === tradeId);
                if (t) { t.status = 'lost'; this.emit(); }
                this.is_in_flight    = false;
                this.in_flight_since = null;
                return;
            }
            const buy = res.buy;
            this.open_ids.set(buy.contract_id, tradeId);
            const t = this.trades.find(x => x.id === tradeId);
            if (t) { t.contract_id = buy.contract_id; t.buy_price = Number(buy.buy_price); this.emit(); }
            this.playBeep('buy');
            void api
                .send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 })
                .catch(() => { /* watchdog handles */ });
        } catch (e) {
            this.log(`Buy exception: ${fmtApiErr(e)}`, 'error');
            const t = this.trades.find(x => x.id === tradeId);
            if (t) { t.status = 'lost'; this.emit(); }
            this.is_in_flight    = false;
            this.in_flight_since = null;
        }
    }

    // ── Settle ───────────────────────────────────────────────────────────────

    private onSettle(poc: any) {
        const profit = Number(poc.profit ?? 0);
        const is_win = profit > 0;
        const barrier = poc.barrier !== undefined ? String(poc.barrier) : '';
        const contractLabel = poc.contract_type === 'DIGITOVER'
            ? `Over ${barrier}`
            : `Under ${barrier}`;

        // Update the pending trade row in-place
        const tradeId = this.open_ids.get(poc.contract_id);
        const existing = tradeId ? this.trades.find(t => t.id === tradeId) : null;
        if (existing) {
            existing.contract_type = poc.contract_type;
            existing.label         = contractLabel;
            existing.symbol        = poc.underlying || this.settings.symbol;
            existing.buy_price     = Number(poc.buy_price ?? 0);
            existing.payout        = Number(poc.payout ?? 0);
            existing.profit        = profit;
            existing.is_win        = is_win;
            existing.status        = is_win ? 'won' : 'lost';
            existing.time          = (poc.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
            existing.entry_price   = poc.entry_tick_display_value ?? poc.entry_spot_display_value ?? null;
            existing.exit_price    = poc.exit_tick_display_value  ?? poc.exit_spot_display_value  ?? null;
        } else {
            this.addTrade({
                id: `ou_${poc.contract_id}`, contract_id: poc.contract_id,
                contract_type: poc.contract_type, label: contractLabel,
                symbol: poc.underlying || this.settings.symbol,
                buy_price: Number(poc.buy_price ?? 0), payout: Number(poc.payout ?? 0),
                profit, is_win, status: is_win ? 'won' : 'lost',
                time: (poc.purchase_time || Math.floor(Date.now() / 1000)) * 1000,
                entry_price: poc.entry_tick_display_value ?? poc.entry_spot_display_value ?? null,
                exit_price:  poc.exit_tick_display_value  ?? poc.exit_spot_display_value  ?? null,
            });
        }

        this.total_profit = Number((this.total_profit + profit).toFixed(2));
        this.total_runs++;
        this.open_ids.delete(poc.contract_id);
        this.is_in_flight    = false;
        this.in_flight_since = null;

        if (is_win) {
            this.wins++;
            this.consec_wins++;
            this.consec_losses = 0;
            this.current_stake = this.settings.stake;
            this.log(
                `✓ WIN ${contractLabel} +$${profit.toFixed(2)} | streak ${this.consec_wins} | total $${this.total_profit.toFixed(2)}`,
                'success'
            );
        } else {
            this.losses++;
            this.consec_losses++;
            this.consec_wins = 0;
            if (this.settings.martingale_enabled) {
                this.current_stake = Number(
                    Math.min(
                        this.current_stake * this.settings.martingale_multiplier,
                        this.settings.max_stake_cap
                    ).toFixed(2)
                );
                this.log(
                    `✗ LOSS ${contractLabel} -$${Math.abs(profit).toFixed(2)} | next $${this.current_stake.toFixed(2)} | total $${this.total_profit.toFixed(2)}`,
                    'error'
                );
            } else {
                this.log(
                    `✗ LOSS ${contractLabel} -$${Math.abs(profit).toFixed(2)} | total $${this.total_profit.toFixed(2)}`,
                    'error'
                );
            }
        }

        this.playBeep(is_win ? 'win' : 'loss');
        this.checkStopConditions();
        // Zero-latency: re-fire immediately after settle if signal still present
        if (this.is_running && !this.is_in_flight && this.current_signal !== 'none') {
            void this.fireTrade(this.current_signal);
        }
    }

    private checkStopConditions() {
        if (this.settings.take_profit > 0 && this.total_profit >= this.settings.take_profit) {
            const msg = `Take profit $${this.settings.take_profit} reached — total $${this.total_profit.toFixed(2)}`;
            this.log(`🎉 ${msg}`, 'success');
            this.last_event = { kind: 'tp', message: msg };
            void this.stop();
            return;
        }
        if (this.settings.stop_loss > 0 && this.total_profit <= -this.settings.stop_loss) {
            const msg = `Stop loss $${this.settings.stop_loss} reached — total $${this.total_profit.toFixed(2)}`;
            this.log(`⛔ ${msg}`, 'error');
            this.last_event = { kind: 'sl', message: msg };
            void this.stop();
            return;
        }
        if (this.settings.consec_wins_target > 0 && this.consec_wins >= this.settings.consec_wins_target) {
            const msg = `${this.consec_wins} consecutive wins reached`;
            this.log(`🏆 ${msg}`, 'success');
            this.last_event = { kind: 'wins', message: msg };
            void this.stop();
        }
    }

    // ── Sound ────────────────────────────────────────────────────────────────

    private playBeep(type: 'buy' | 'win' | 'loss') {
        if (!this.settings.sound_enabled) return;
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            if (type === 'buy')  { osc.frequency.value = 880; gain.gain.value = 0.05; }
            if (type === 'win')  { osc.frequency.value = 1200; gain.gain.value = 0.08; }
            if (type === 'loss') { osc.frequency.value = 300; gain.gain.value = 0.08; }
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } catch { /* audio not available */ }
    }
}

export const ouEngine = new OUEngine();
