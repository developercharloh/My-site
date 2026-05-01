import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import {
    triEngine,
    TriSettings,
    DEFAULT_TRI_SETTINGS,
    TRI_FAMILIES,
    TRI_FAMILY_SIDES,
    triNeedsDigit,
    MarketSlot,
} from './tri-engine';

const SYMBOLS = [
    { value: '1HZ10V',  label: 'Vol 10 (1s)' },
    { value: '1HZ25V',  label: 'Vol 25 (1s)' },
    { value: '1HZ50V',  label: 'Vol 50 (1s)' },
    { value: '1HZ75V',  label: 'Vol 75 (1s)' },
    { value: '1HZ100V', label: 'Vol 100 (1s)' },
    { value: 'R_10',    label: 'Vol 10 Index' },
    { value: 'R_25',    label: 'Vol 25 Index' },
    { value: 'R_50',    label: 'Vol 50 Index' },
    { value: 'R_75',    label: 'Vol 75 Index' },
    { value: 'R_100',   label: 'Vol 100 Index' },
];

const SCAN_SYMBOLS = ['R_10','R_25','R_50','R_75','R_100','1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V'];

// Over barrier options: 0–8 (win if last digit > barrier)
const OVER_OPTIONS  = [0,1,2,3,4,5,6,7,8].map(v => ({ value: v, label: `Over ${v}` }));
// Under barrier options: 1–9 (win if last digit < barrier)
const UNDER_OPTIONS = [1,2,3,4,5,6,7,8,9].map(v => ({ value: v, label: `Under ${v}` }));

type Theme   = 'light' | 'dark';
type JFilter = 'all' | 'info' | 'success' | 'warn' | 'error';
type TFilter = 'all' | 'm1' | 'm2' | 'm3' | 'wins' | 'losses';
type MarketKey = 'M1' | 'M2' | 'M3';

const useEngine = () => {
    const [, bump] = useState(0);
    useEffect(() => triEngine.subscribe(() => bump(t => t + 1)), []);
    return triEngine;
};

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({
    checked, onChange, disabled,
}) => (
    <button
        type='button'
        className={`df-toggle ${checked ? 'df-toggle--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
    >
        <span className='df-toggle__knob' />
    </button>
);

const fmtProfit = (n: number) =>
    (n >= 0 ? '+' : '') + '$' + Math.abs(n).toFixed(2);

const symLabel = (sym: string) => SYMBOLS.find(s => s.value === sym)?.label ?? sym;

const MARKET_COLORS: Record<MarketKey, string> = {
    M1: '#38bdf8',
    M2: '#a78bfa',
    M3: '#34d399',
};

/* ── AI Auto Config ──────────────────────────────────────────────────────── */

type AutoCandidate = {
    family:      TriFamily;
    side:        TriSide;
    prediction:  number;
    label:       string;
    payout_mult: number; // approximate profit multiplier on stake (e.g. 0.95 = 95% profit)
};

// Only include contracts with payout_mult ≥ 0.85 so a single win can recover
// martingale losses. Low-payout types (Matches, Differs, Over 2, Under 8, Under 7)
// are excluded — their near-certain wins pay so little that 3 losses destroy the account.
const AUTO_CANDIDATES: AutoCandidate[] = [
    { family: 'rise_fall',         side: 'CALL',        prediction: 0, label: 'Rise',    payout_mult: 0.95 },
    { family: 'rise_fall',         side: 'PUT',         prediction: 0, label: 'Fall',    payout_mult: 0.95 },
    { family: 'digits_even_odd',   side: 'DIGITEVEN',   prediction: 0, label: 'Even',    payout_mult: 0.95 },
    { family: 'digits_even_odd',   side: 'DIGITODD',    prediction: 0, label: 'Odd',     payout_mult: 0.95 },
    { family: 'digits_over_under', side: 'DIGITOVER',   prediction: 4, label: 'Over 4',  payout_mult: 0.95 },
    { family: 'digits_over_under', side: 'DIGITOVER',   prediction: 5, label: 'Over 5',  payout_mult: 1.50 },
    { family: 'digits_over_under', side: 'DIGITOVER',   prediction: 6, label: 'Over 6',  payout_mult: 2.30 },
    { family: 'digits_over_under', side: 'DIGITUNDER',  prediction: 4, label: 'Under 4', payout_mult: 1.50 },
    { family: 'digits_over_under', side: 'DIGITUNDER',  prediction: 5, label: 'Under 5', payout_mult: 0.95 },
    { family: 'digits_over_under', side: 'DIGITUNDER',  prediction: 6, label: 'Under 6', payout_mult: 0.65 },
    { family: 'higher_lower',      side: 'CALL_HIGHER', prediction: 0, label: 'Higher',  payout_mult: 0.95 },
    { family: 'higher_lower',      side: 'PUT_LOWER',   prediction: 0, label: 'Lower',   payout_mult: 0.95 },
];

type ScoredCandidate = AutoCandidate & { score: number; wins: number; total: number };

type AutoConfigResult = {
    symbol: string;
    label:  string;
    m1:     ScoredCandidate;
    m2:     ScoredCandidate;
    m3:     ScoredCandidate;
};

async function runAutoConfig(
    onProgress: (pct: number) => void,
): Promise<AutoConfigResult | null> {
    const api = (api_base as any).api;
    if (!api) return null;

    const lastDigit = (p: number) => { const s = p.toFixed(5); return Number(s.charAt(s.length - 1)); };

    // Fetch all 10 vols in parallel (progress 0→60%)
    const fetched = await Promise.all(
        SCAN_SYMBOLS.map(async (sym, i) => {
            try {
                const res: any = await api.send({ ticks_history: sym, count: 500, end: 'latest', style: 'ticks' });
                onProgress(Math.round(((i + 1) / SCAN_SYMBOLS.length) * 60));
                return { sym, prices: (res?.history?.prices ?? []) as number[] };
            } catch {
                onProgress(Math.round(((i + 1) / SCAN_SYMBOLS.length) * 60));
                return { sym, prices: [] as number[] };
            }
        })
    );

    // Score a single candidate against a price array
    const scoreOne = (c: AutoCandidate, prices: number[]): ScoredCandidate => {
        if (prices.length < 2) return { ...c, score: 0, wins: 0, total: prices.length };
        let hits = 0;
        for (let j = 1; j < prices.length; j++) {
            const d  = lastDigit(prices[j]);
            const up = prices[j] > prices[j - 1];
            switch (c.side) {
                case 'CALL': case 'CALL_HIGHER': if (up)  hits++; break;
                case 'PUT':  case 'PUT_LOWER':   if (!up) hits++; break;
                case 'DIGITEVEN':  if (d % 2 === 0)         hits++; break;
                case 'DIGITODD':   if (d % 2 !== 0)         hits++; break;
                case 'DIGITOVER':  if (d > c.prediction)    hits++; break;
                case 'DIGITUNDER': if (d < c.prediction)    hits++; break;
                case 'DIGITMATCH': if (d === c.prediction)  hits++; break;
                case 'DIGITDIFF':  if (d !== c.prediction)  hits++; break;
            }
        }
        // Weight by payout_mult so the scanner ranks by expected recovery value,
        // not just win rate. A 50% win × 0.95 payout beats a 90% win × 0.10 payout.
        const hit_rate = hits / prices.length;
        return { ...c, score: hit_rate * c.payout_mult, wins: hits, total: prices.length };
    };

    // For each vol: score all candidates, pick best 3 from different families
    type SymResult = { sym: string; top3: ScoredCandidate[]; combined: number };
    const symResults: SymResult[] = fetched.map(({ sym, prices }, idx) => {
        const scored = AUTO_CANDIDATES.map(c => scoreOne(c, prices));
        scored.sort((a, b) => b.score - a.score);

        const top3: ScoredCandidate[] = [];
        const usedFamilies = new Set<string>();
        for (const s of scored) {
            if (top3.length >= 3) break;
            if (!usedFamilies.has(s.family)) { top3.push(s); usedFamilies.add(s.family); }
        }
        // Fallback: fill remaining without family uniqueness constraint
        for (const s of scored) {
            if (top3.length >= 3) break;
            if (!top3.includes(s)) top3.push(s);
        }
        const combined = top3.reduce((acc, c) => acc + c.score, 0) / Math.max(top3.length, 1);
        onProgress(60 + Math.round(((idx + 1) / SCAN_SYMBOLS.length) * 40));
        return { sym, top3, combined };
    });

    symResults.sort((a, b) => b.combined - a.combined);
    const best = symResults[0];
    if (!best || best.top3.length < 3) return null;

    return {
        symbol: best.sym,
        label:  symLabel(best.sym),
        m1:     best.top3[0],
        m2:     best.top3[1],
        m3:     best.top3[2],
    };
}

/* ── AI Auto Config Modal ────────────────────────────────────────────────── */
const AutoConfigModal: React.FC<{
    onApply:      (r: AutoConfigResult) => void;
    onSaveAndRun: (r: AutoConfigResult) => void;
    onClose:      () => void;
}> = ({ onApply, onSaveAndRun, onClose }) => {
    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [result,   setResult]   = useState<AutoConfigResult | null>(null);
    const [error,    setError]    = useState('');

    const run = async () => {
        setScanning(true); setProgress(0); setError(''); setResult(null);
        try {
            const r = await runAutoConfig(pct => setProgress(pct));
            if (r) setResult(r);
            else   setError('Could not reach market data. Please try again.');
        } catch { setError('Analysis failed. Check your connection.'); }
        setScanning(false);
    };

    return (
        <div className='ou-scan-overlay' onClick={onClose}>
            <div className='ou-scan-modal' onClick={e => e.stopPropagation()}>

                <div className='ou-scan-modal__head'>
                    <span>🤖 AI Auto Configuration</span>
                    <button className='ou-scan-modal__close' onClick={onClose}>✕</button>
                </div>

                <p className='ou-scan-modal__sub'>
                    Scans all 10 volatilities · excludes Matches &amp; low-payout types · picks contracts scored by <strong>win rate × payout</strong> for martingale safety.
                </p>

                {scanning ? (
                    <div className='ou-scan-modal__scanning'>
                        <div className='ou-scan-progress-bar'>
                            <div className='ou-scan-progress-bar__fill' style={{ width: `${progress}%` }} />
                        </div>
                        <span className='ou-scan-progress-label'>Analysing markets… {progress}%</span>
                    </div>
                ) : result ? (
                    <div className='ac-result'>
                        <div className='ac-result__vol'>
                            <span className='ac-result__vol-icon'>⚡</span>
                            <div>
                                <div className='ac-result__vol-tag'>Best Volatility</div>
                                <div className='ac-result__vol-name'>{result.label}</div>
                            </div>
                        </div>
                        <div className='ac-result__markets'>
                            {(['m1','m2','m3'] as const).map((k, i) => {
                                const slot    = result[k];
                                const key     = (['M1','M2','M3'] as const)[i];
                                const winRate = slot.total > 0 ? Math.round((slot.wins / slot.total) * 100) : 0;
                                const payout  = `+${(slot.payout_mult * 100).toFixed(0)}%`;
                                return (
                                    <div key={k} className='ac-result__mkt'
                                         style={{ '--mcolor': MARKET_COLORS[key] } as any}>
                                        <span className='ac-result__mkt-key'>{key}</span>
                                        <div className='ac-result__mkt-info'>
                                            <span className='ac-result__mkt-type'>{slot.label}</span>
                                            <div className='ac-result__mkt-bar-wrap'>
                                                <div className='ac-result__mkt-bar' style={{ width: `${Math.min(winRate * 2, 100)}%` }} />
                                            </div>
                                        </div>
                                        <span className='ac-result__mkt-rate'>{winRate}% <span className='ac-result__payout'>{payout}</span></span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className='ac-result__actions'>
                            <button className='ac-result__apply'
                                    onClick={() => { onApply(result); onClose(); }}>
                                ✓ Apply Only
                            </button>
                            <button className='ac-result__run'
                                    onClick={() => { onSaveAndRun(result); onClose(); }}>
                                🚀 Save &amp; Run
                            </button>
                        </div>
                        <div className='ou-scan-modal__footer'>
                            <button className='ou-scan-start-btn ou-scan-start-btn--rescan' onClick={run}>
                                ↺ Re-scan
                            </button>
                        </div>
                    </div>
                ) : error ? (
                    <div style={{ padding: '20px 18px', textAlign: 'center' }}>
                        <p style={{ color: '#f87171', marginBottom: 12 }}>{error}</p>
                        <button className='ou-scan-start-btn' onClick={run}>▶ Retry</button>
                    </div>
                ) : (
                    <button className='ou-scan-start-btn' onClick={run}>▶ Start Analysis</button>
                )}
            </div>
        </div>
    );
};

/* ── Compact collapsible MarketConfig ───────────────────────────────────── */
const MarketConfig: React.FC<{
    marketKey: MarketKey;
    slot: MarketSlot;
    state: any;
    disabled: boolean;
    defaultOpen?: boolean;
    globalSymbol: string;
    onUpdate: (patch: Partial<MarketSlot>) => void;
}> = ({ marketKey, slot, state, disabled, defaultOpen = false, globalSymbol, onUpdate }) => {
    const [open, setOpen] = useState(defaultOpen);
    const sides      = TRI_FAMILY_SIDES[slot.family];
    const needsDigit = triNeedsDigit(slot.family);

    const overUnderOptions = slot.side === 'DIGITOVER' ? OVER_OPTIONS : UNDER_OPTIONS;

    return (
        <div className={`tri-mc ${!slot.enabled ? 'tri-mc--disabled' : ''}`}
             style={{ '--mcolor': MARKET_COLORS[marketKey] } as any}>

            <button className={`tri-mc__head ${open ? 'tri-mc__head--open' : ''}`}
                    onClick={() => setOpen(o => !o)}>
                <span className='tri-mc__badge' style={{ background: MARKET_COLORS[marketKey] }}>
                    {marketKey}
                </span>
                <span className='tri-mc__name'>Market {marketKey.slice(1)}</span>
                <span className='tri-mc__sym'>{symLabel(globalSymbol)}</span>
                <span className={state.profit >= 0 ? 'tri-mc__pnl--pos' : 'tri-mc__pnl--neg'}>
                    {fmtProfit(state.profit)}
                </span>
                <Toggle checked={slot.enabled} onChange={v => onUpdate({ enabled: v })} disabled={disabled} />
                <span className='tri-mc__arrow'>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className='tri-mc__body'>
                    {/* Contract — full width */}
                    <div className='tri-mc__field tri-mc__field--full'>
                        <label>Contract</label>
                        <select value={slot.family} disabled={disabled}
                            onChange={e => {
                                const fam = e.target.value as MarketSlot['family'];
                                onUpdate({ family: fam, side: TRI_FAMILY_SIDES[fam][0].value });
                            }}>
                            {TRI_FAMILIES.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Direction pills — full width */}
                    <div className='tri-mc__field tri-mc__field--full'>
                        <label>Direction</label>
                        <div className='tri-side-pills'>
                            {sides.map(s => (
                                <button key={s.value}
                                    className={`tri-pill ${slot.side === s.value ? 'tri-pill--active' : ''}`}
                                    onClick={() => !disabled && onUpdate({ side: s.value })}
                                    disabled={disabled}>
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Prediction | Duration — side by side */}
                    {slot.family === 'digits_over_under' && (
                        <div className='tri-mc__field'>
                            <label>{slot.side === 'DIGITOVER' ? 'Over (0–8)' : 'Under (1–9)'}</label>
                            <select value={slot.prediction} disabled={disabled}
                                onChange={e => onUpdate({ prediction: Number(e.target.value) })}>
                                {overUnderOptions.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {slot.family === 'digits_matches_differs' && (
                        <div className='tri-mc__field'>
                            <label>Digit (0–9)</label>
                            <input type='number' value={slot.prediction} min={0} max={9} disabled={disabled}
                                onChange={e => onUpdate({ prediction: Number(e.target.value) })} />
                        </div>
                    )}
                    {/* if no prediction field, Duration still gets paired in 2nd col */}
                    {(slot.family === 'digits_rise_fall' || slot.family === 'digits_higher_lower' || slot.family === 'digits_even_odd') && (
                        <div className='tri-mc__field' />
                    )}

                    <div className='tri-mc__field'>
                        <label>Duration (ticks)</label>
                        <select value={slot.duration} disabled={disabled}
                            onChange={e => onUpdate({ duration: Number(e.target.value) })}>
                            {Array.from({ length: 10 }, (_, i) => i + 1).map(t =>
                                <option key={t} value={t}>{t} tick{t > 1 ? 's' : ''}</option>)}
                        </select>
                    </div>

                    {/* Martingale toggle | Multiplier — side by side */}
                    <div className='tri-mc__field tri-mc__field--toggle'>
                        <label>Martingale</label>
                        <Toggle checked={slot.martingale_enabled}
                            onChange={v => onUpdate({ martingale_enabled: v })} disabled={disabled} />
                    </div>
                    {slot.martingale_enabled ? (
                        <div className='tri-mc__field'>
                            <label>Multiplier</label>
                            <input type='number' value={slot.martingale_multiplier} min={1.1} max={10} step={0.1}
                                disabled={disabled}
                                onChange={e => onUpdate({ martingale_multiplier: Number(e.target.value) })} />
                        </div>
                    ) : <div />}

                    {/* Cooldown toggle | After losses — side by side */}
                    <div className='tri-mc__field tri-mc__field--toggle'>
                        <label>Cooldown</label>
                        <Toggle checked={slot.cooldown_enabled}
                            onChange={v => onUpdate({ cooldown_enabled: v })} disabled={disabled} />
                    </div>
                    {slot.cooldown_enabled ? (
                        <div className='tri-mc__field'>
                            <label>After losses</label>
                            <input type='number' value={slot.cooldown_after_losses} min={1} max={50}
                                disabled={disabled}
                                onChange={e => onUpdate({ cooldown_after_losses: Number(e.target.value) })} />
                        </div>
                    ) : <div />}

                    {slot.cooldown_enabled && (
                        <div className='tri-mc__field tri-mc__field--full'>
                            <label>Pause (ticks)</label>
                            <input type='number' value={slot.cooldown_duration_ticks} min={1} max={500}
                                disabled={disabled}
                                onChange={e => onUpdate({ cooldown_duration_ticks: Number(e.target.value) })} />
                        </div>
                    )}

                    {/* Best-entry filter */}
                    <div className='tri-mc__field tri-mc__field--toggle tri-mc__field--full'>
                        <label>🎯 Entry filter</label>
                        <Toggle checked={slot.entry_filter_enabled}
                            onChange={v => onUpdate({ entry_filter_enabled: v })} disabled={disabled} />
                    </div>

                    {state.cooldown_ticks > 0 && (
                        <div className='tri-cooldown-badge tri-mc__field--full'>⏸ Cooldown: {state.cooldown_ticks} ticks left</div>
                    )}
                    {state.in_flight && (
                        <div className='tri-inflight-badge tri-mc__field--full'>⚡ Trade active…</div>
                    )}
                </div>
            )}
        </div>
    );
};


/* ── TriBot ──────────────────────────────────────────────────────────────── */
const TriBot: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const engine = useEngine();
    const [theme, setTheme]       = useState<Theme>('dark');
    const [settings, setSettings] = useState<TriSettings>({
        ...DEFAULT_TRI_SETTINGS,
        m1: { ...DEFAULT_TRI_SETTINGS.m1 },
        m2: { ...DEFAULT_TRI_SETTINGS.m2 },
        m3: { ...DEFAULT_TRI_SETTINGS.m3 },
    });
    const [tab,      setTab]      = useState<'trades' | 'journal'>('trades');
    const [jFilter,  setJFilter]  = useState<JFilter>('all');
    const [tFilter,  setTFilter]  = useState<TFilter>('all');
    const [mktsOpen, setMktsOpen] = useState(false);
    const [showAutoConfig, setShowAutoConfig] = useState(false);
    const configPanelRef = useRef<HTMLDivElement>(null);

    // Scroll config panel into view whenever it opens
    useEffect(() => {
        if (mktsOpen && configPanelRef.current) {
            setTimeout(() => {
                configPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
        }
    }, [mktsOpen]);

    const running = engine.is_running;

    const apply = (patch: Partial<TriSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        engine.updateSettings(next);
    };

    const applySlot = (m: 'm1' | 'm2' | 'm3', patch: Partial<MarketSlot>) => {
        const next = { ...settings, [m]: { ...settings[m], ...patch } };
        setSettings(next);
        engine.updateSettings(next);
    };

    const handleStart = () => {
        engine.updateSettings(settings);
        setMktsOpen(false);
        void engine.start();
    };

    const handleAutoApply = (r: AutoConfigResult) => {
        const makeSlot = (existing: MarketSlot, c: ScoredCandidate): MarketSlot => ({
            ...existing,
            family:     c.family,
            side:       c.side,
            prediction: c.prediction,
        });
        const next: TriSettings = {
            ...settings,
            symbol: r.symbol,
            m1: makeSlot(settings.m1, r.m1),
            m2: makeSlot(settings.m2, r.m2),
            m3: makeSlot(settings.m3, r.m3),
        };
        setSettings(next);
        engine.updateSettings(next);
    };

    const handleAutoSaveAndRun = (r: AutoConfigResult) => {
        handleAutoApply(r);
        setMktsOpen(false);
        void engine.start();
    };

    const totalW  = engine.states.M1.wins   + engine.states.M2.wins   + engine.states.M3.wins;
    const totalL  = engine.states.M1.losses + engine.states.M2.losses + engine.states.M3.losses;
    const winRate = totalW + totalL > 0 ? Math.round((totalW / (totalW + totalL)) * 100) : 0;

    const filteredTrades = engine.trades.filter(t => {
        if (tFilter === 'm1')     return t.market === 'M1';
        if (tFilter === 'm2')     return t.market === 'M2';
        if (tFilter === 'm3')     return t.market === 'M3';
        if (tFilter === 'wins')   return t.status === 'won';
        if (tFilter === 'losses') return t.status === 'lost';
        return true;
    });

    const filteredJournal = engine.journal.filter(j =>
        jFilter === 'all' ? true : j.type === jFilter
    );

    const event = engine.last_event;

    return (
        <>
        <div className={`speed-bots speed-bots--${theme} tri-root`}>

            {/* ── TP / SL / Circuit modal (matches VH Pro style) ── */}
            {event && (
                <div className={`sb-modal sb-modal--${event.kind}`} onClick={() => engine.clearLastEvent()}>
                    <div className='sb-modal__card' onClick={e => e.stopPropagation()}>
                        {event.kind === 'tp' ? (
                            <>
                                <div className='sb-modal__emoji'>🎉</div>
                                <h2 className='sb-modal__title'>Congratulations!</h2>
                                <p className='sb-modal__msg'>TP Hit 💵💵 ✅</p>
                                <p className='sb-modal__sub'>
                                    Total profit: <strong>+{engine.total_profit.toFixed(2)} USD</strong>
                                </p>
                            </>
                        ) : event.message?.startsWith('Circuit breaker') ? (
                            <>
                                <div className='sb-modal__emoji'>🔌</div>
                                <h2 className='sb-modal__title'>Circuit Breaker</h2>
                                <p className='sb-modal__msg'>{engine.settings.circuit_breaker_losses} consecutive losses</p>
                                <p className='sb-modal__sub'>
                                    Total P/L: <strong>{engine.total_profit.toFixed(2)} USD</strong>
                                </p>
                            </>
                        ) : (
                            <>
                                <div className='sb-modal__emoji'>🙃</div>
                                <h2 className='sb-modal__title'>Auch, SL Hit</h2>
                                <p className='sb-modal__msg'>Protect your capital</p>
                                <p className='sb-modal__sub'>
                                    Total loss: <strong>{engine.total_profit.toFixed(2)} USD</strong>
                                </p>
                            </>
                        )}
                        <button className='sb-modal__close' onClick={() => engine.clearLastEvent()}>
                            Close
                        </button>
                    </div>
                </div>
            )}

            {/* ── Topbar ── */}
            <div className='sb-top'>
                <button className='sb-top__back' onClick={onBack}>← Back</button>
                <button className='tri-cfg-btn' onClick={() => setMktsOpen(o => !o)}>
                    ⚙ Configure {mktsOpen ? '▲' : '▼'}
                </button>
                {running ? (
                    <button className='tri-run-stop-btn tri-run-stop-btn--stop' onClick={() => void engine.stop()}>
                        ■ Stop Bot
                    </button>
                ) : (
                    <button className='tri-run-stop-btn tri-run-stop-btn--run' onClick={handleStart}>
                        ▶ Run Bot
                    </button>
                )}
                <div className='tri-top-pnl'>
                    <span className={`tri-top-pnl__value ${engine.total_profit >= 0 ? 'tri-top-pnl__value--pos' : 'tri-top-pnl__value--neg'}`}>
                        {fmtProfit(engine.total_profit)}
                    </span>
                    {/* TP progress */}
                    {settings.take_profit > 0 && (
                        <div className='tri-tpsl tri-tpsl--tp'>
                            <span className='tri-tpsl__label'>TP</span>
                            <div className='tri-tpsl__bar'>
                                <div className='tri-tpsl__fill tri-tpsl__fill--tp'
                                    style={{ width: `${Math.min(100, (Math.max(0, engine.total_profit) / settings.take_profit) * 100)}%` }} />
                            </div>
                            <span className='tri-tpsl__target'>${settings.take_profit}</span>
                        </div>
                    )}
                    {/* SL progress */}
                    {settings.stop_loss > 0 && (
                        <div className='tri-tpsl tri-tpsl--sl'>
                            <span className='tri-tpsl__label'>SL</span>
                            <div className='tri-tpsl__bar'>
                                <div className='tri-tpsl__fill tri-tpsl__fill--sl'
                                    style={{ width: `${Math.min(100, (Math.abs(Math.min(0, engine.total_profit)) / settings.stop_loss) * 100)}%` }} />
                            </div>
                            <span className='tri-tpsl__target'>${settings.stop_loss}</span>
                        </div>
                    )}
                </div>
                <button className='sb-top__theme' onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
                    {theme === 'dark' ? '☀️' : '🌙'}
                </button>
            </div>

            {/* ── Stats 2×4 grid ── */}
            <div className='tri-stats-grid'>
                <div className='tri-stat-cell tri-stat-cell--total'>
                    <span className='tri-stat-cell__label'>Total P/L</span>
                    <span className={`tri-stat-cell__value ${engine.total_profit >= 0 ? 'tri-stat-cell__value--pos' : 'tri-stat-cell__value--neg'}`}>
                        {fmtProfit(engine.total_profit)}
                    </span>
                </div>
                {(['M1','M2','M3'] as const).map(m => (
                    <div key={m} className='tri-stat-cell'>
                        <span className='tri-stat-cell__label' style={{ color: MARKET_COLORS[m] }}>{m}</span>
                        <span className={`tri-stat-cell__value ${engine.states[m].profit >= 0 ? 'tri-stat-cell__value--pos' : 'tri-stat-cell__value--neg'}`}>
                            {fmtProfit(engine.states[m].profit)}
                        </span>
                    </div>
                ))}
                <div className='tri-stat-cell'>
                    <span className='tri-stat-cell__label'>Win Rate</span>
                    <span className='tri-stat-cell__value'>{winRate}%</span>
                </div>
                <div className='tri-stat-cell'>
                    <span className='tri-stat-cell__label'>Trades</span>
                    <span className='tri-stat-cell__value'>{engine.total_runs}</span>
                </div>
                <div className='tri-stat-cell'>
                    <span className='tri-stat-cell__label'>Last Digit</span>
                    <span className='tri-stat-cell__value'>{engine.last_digit ?? '—'}</span>
                </div>
                <div className='tri-stat-cell'>
                    <span className='tri-stat-cell__label'>Quote</span>
                    <span className='tri-stat-cell__value'>{engine.last_quote?.toFixed(2) ?? '—'}</span>
                </div>
                <div className='tri-stat-cell'>
                    <span className='tri-stat-cell__label'>Loss Streak</span>
                    <span className={`tri-stat-cell__value ${engine.consec_all_losses > 0 ? 'tri-stat-cell__value--neg' : ''}`}>
                        {engine.consec_all_losses > 0 ? `🔴 ${engine.consec_all_losses}` : '✅ 0'}
                    </span>
                </div>
                <div className='tri-stat-cell'>
                    <span className='tri-stat-cell__label'>Circuit</span>
                    <span className='tri-stat-cell__value'>
                        {settings.circuit_breaker_enabled
                            ? `${engine.consec_all_losses}/${settings.circuit_breaker_losses}`
                            : '—'}
                    </span>
                </div>
            </div>

            {/* ── Live status bar ── */}
            <div className={`tri-live-bar ${engine.has_live_tick ? 'tri-live-bar--live' : ''}`}>
                <span className='tri-live-dot' />
                <span>{engine.has_live_tick ? 'Live' : running ? 'Connecting…' : 'Stopped'}</span>
                {running && (
                    <span className='tri-running-indicator'>
                        {(['M1','M2','M3'] as const).map(m => (
                            <span key={m}
                                className={`tri-mkt-dot ${engine.states[m].in_flight ? 'tri-mkt-dot--active' : ''} ${engine.states[m].cooldown_ticks > 0 ? 'tri-mkt-dot--cooldown' : ''}`}
                                style={{ '--mcolor': MARKET_COLORS[m] } as any} title={m}>
                                {m}
                            </span>
                        ))}
                    </span>
                )}
                {running && (
                    <button className='sb-control-btn sb-control-btn--stop tri-live-stop'
                            onClick={() => void engine.stop()}>■ Stop</button>
                )}
            </div>

            {/* ── AI Auto Config trigger ── */}
            <div className='tri-mkt-collapse'>
                <button
                    className='tri-mkt-collapse__btn tri-mkt-collapse__btn--ai'
                    onClick={() => setShowAutoConfig(true)}>
                    <span>🤖 AI Auto Configuration</span>
                    <span className='tri-mkt-collapse__arrow'>▶</span>
                </button>

                {mktsOpen && (
                    <div className='tri-config-panel' ref={configPanelRef}>

                        {/* Global settings */}
                        <div className='tri-global-strip'>
                            <div className='tri-gs-item'>
                                <label>Total stake ($)</label>
                                <input type='number' value={settings.total_stake} min={0.35} step={0.01}
                                    onChange={e => apply({ total_stake: Number(e.target.value) })} />
                            </div>
                            <div className='tri-gs-item'>
                                <label>Per market</label>
                                <span className='tri-gs-per'>${(settings.total_stake / 3).toFixed(2)}</span>
                            </div>
                            <div className='tri-gs-item'>
                                <label>Take profit ($)</label>
                                <input type='number' value={settings.take_profit} min={0} step={0.5}
                                    onChange={e => apply({ take_profit: Number(e.target.value) })} />
                            </div>
                            <div className='tri-gs-item'>
                                <label>Stop loss ($)</label>
                                <input type='number' value={settings.stop_loss} min={0} step={0.5}
                                    onChange={e => apply({ stop_loss: Number(e.target.value) })} />
                            </div>
                            <div className='tri-gs-item tri-gs-item--toggle'>
                                <label>Sound</label>
                                <Toggle checked={settings.sound_enabled} onChange={v => apply({ sound_enabled: v })} />
                            </div>
                            <div className='tri-gs-item tri-gs-item--toggle'>
                                <label>🔌 Circuit breaker</label>
                                <Toggle checked={settings.circuit_breaker_enabled}
                                    onChange={v => apply({ circuit_breaker_enabled: v })} />
                            </div>
                            {settings.circuit_breaker_enabled && (
                                <div className='tri-gs-item'>
                                    <label>Stop after losses</label>
                                    <input type='number' value={settings.circuit_breaker_losses} min={3} max={30} step={1}
                                        onChange={e => apply({ circuit_breaker_losses: Number(e.target.value) })} />
                                </div>
                            )}
                            <div className='tri-gs-item tri-gs-item--toggle'>
                                <label>📡 Auto vol rescan</label>
                                <Toggle checked={settings.auto_vol_rescan_enabled}
                                    onChange={v => apply({ auto_vol_rescan_enabled: v })} />
                            </div>
                            <div className='tri-gs-actions'>
                                {!running ? (
                                    <button className='sb-control-btn sb-control-btn--start' onClick={handleStart}>▶ Start</button>
                                ) : (
                                    <button className='sb-control-btn sb-control-btn--stop' onClick={() => void engine.stop()}>■ Stop</button>
                                )}
                                <button className='sb-control-btn sb-control-btn--reset'
                                    onClick={() => engine.resetStats()}>↺ Reset</button>
                            </div>
                        </div>

                        {/* Individual market cards */}
                        <MarketConfig marketKey='M1' slot={settings.m1} state={engine.states.M1}
                            disabled={false} defaultOpen={true} globalSymbol={settings.symbol}
                            onUpdate={p => applySlot('m1', p)} />
                        <MarketConfig marketKey='M2' slot={settings.m2} state={engine.states.M2}
                            disabled={false} globalSymbol={settings.symbol}
                            onUpdate={p => applySlot('m2', p)} />
                        <MarketConfig marketKey='M3' slot={settings.m3} state={engine.states.M3}
                            disabled={false} globalSymbol={settings.symbol}
                            onUpdate={p => applySlot('m3', p)} />

                    </div>
                )}
            </div>

            {/* ── Transactions / Journal ── */}
            <div className='df-tabs'>
                <button className={`df-tab ${tab === 'trades' ? 'df-tab--active' : ''}`} onClick={() => setTab('trades')}>
                    Transactions ({engine.trades.length})
                </button>
                <button className={`df-tab ${tab === 'journal' ? 'df-tab--active' : ''}`} onClick={() => setTab('journal')}>
                    Journal ({engine.journal.length})
                </button>
                <button
                    className='df-clear-btn'
                    title='Reset everything — trades, journal, P/L, TP & SL'
                    onClick={() => engine.resetStats()}>
                    🗑
                </button>
            </div>

            {tab === 'trades' && (
                <div className='df-panel'>
                    <div className='df-filter-bar'>
                        {(['all','m1','m2','m3','wins','losses'] as TFilter[]).map(f => (
                            <button key={f}
                                className={`df-filter-btn ${tFilter === f ? 'df-filter-btn--active' : ''}`}
                                onClick={() => setTFilter(f)}>
                                {f.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    {filteredTrades.length === 0 ? (
                        <div className='sb-empty'>No trades yet</div>
                    ) : (
                        <div className='df-tx-list'>
                            {filteredTrades.slice(0, 200).map(t => (
                                <div key={t.id} className={`df-tx df-tx--tri ${t.status === 'pending' ? 'df-tx--pending' : t.is_win ? 'df-tx--win' : 'df-tx--loss'}`}>
                                    {/* Row 1: badge · market label · stake · P&L · time */}
                                    <div className='tri-tx__row1'>
                                        <span className='tri-tx__badge'>{t.status === 'pending' ? '⏳' : t.is_win ? '✓ WIN' : '✗ LOSS'}</span>
                                        <span className='tri-tx__mkt-label' style={{ color: MARKET_COLORS[t.market] }}>
                                            [{t.market}] {t.label}
                                        </span>
                                        <span className='tri-tx__stake'>${t.buy_price.toFixed(2)}</span>
                                        <span className='tri-tx__pnl'>{t.status === 'pending' ? '—' : fmtProfit(t.profit)}</span>
                                        <span className='tri-tx__time'>{new Date(t.time).toLocaleTimeString()}</span>
                                    </div>
                                    {/* Row 2: symbol chip · entry → exit */}
                                    <div className='tri-tx__row2'>
                                        <span className='tri-tx__sym'>{t.symbol}</span>
                                        <div className='tri-tx__prices'>
                                            <span className='tri-tx__price-label'>Entry</span>
                                            <span className='tri-tx__price-val'>{t.entry_price}</span>
                                            <span className='tri-tx__arrow'>→</span>
                                            <span className='tri-tx__price-label'>Exit</span>
                                            <span className='tri-tx__price-val'>{t.exit_price}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {tab === 'journal' && (
                <div className='df-panel'>
                    <div className='df-filter-bar'>
                        {(['all','info','success','warn','error'] as JFilter[]).map(f => (
                            <button key={f}
                                className={`df-filter-btn ${jFilter === f ? 'df-filter-btn--active' : ''}`}
                                onClick={() => setJFilter(f)}>
                                {f.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    {filteredJournal.length === 0 ? (
                        <div className='sb-empty'>No log entries</div>
                    ) : (
                        <div className='df-journal-list'>
                            {filteredJournal.slice(0, 400).map(e => (
                                <div key={e.id} className={`df-journal-entry df-journal-entry--${e.type}`}>
                                    <span className='df-journal__time'>{new Date(e.time).toLocaleTimeString()}</span>
                                    <span className='df-journal__msg'>{e.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* ── AI Auto Config Modal ── */}
        {showAutoConfig && (
            <AutoConfigModal
                onApply={handleAutoApply}
                onSaveAndRun={handleAutoSaveAndRun}
                onClose={() => setShowAutoConfig(false)}
            />
        )}
        </>
    );
};

export default TriBot;
