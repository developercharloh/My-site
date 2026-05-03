import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, ChevronDown, Wifi, WifiOff, Loader2, Bot, X } from 'lucide-react';
import '../entry-zone/entry-zone.scss';
import './signal-engine.scss';
import {
    analyzeSignals, trainMLWeights, modelVolatility,
    initialMLWeights, type Signal, type MarketType, type MLWeights,
} from './signal-brain';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { botIdFromSignal, fetchAndPatchBot, parseDigitFrom, prefetchBotXml } from '@/utils/bot-patch';

const ENGINE_KEY    = 'free_bots_engine_mode';
const V2_CONFIG_KEY = 'free_bots_v2_config';

// ─── All 13 volatility symbols ────────────────────────────────────────────────

const ALL_SYMBOLS = [
    '1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V',
    '1HZ15V','1HZ30V','1HZ90V',
    'R_10','R_25','R_50','R_75','R_100',
] as const;
type Sym = typeof ALL_SYMBOLS[number];

const SYM_SHORT: Record<string, string> = {
    '1HZ10V':'V10s', '1HZ15V':'V15s', '1HZ25V':'V25s', '1HZ30V':'V30s',
    '1HZ50V':'V50s', '1HZ75V':'V75s', '1HZ90V':'V90s', '1HZ100V':'V100s',
    'R_10':'V10',    'R_25':'V25',    'R_50':'V50',
    'R_75':'V75',    'R_100':'V100',
};
const SYM_LONG: Record<string, string> = {
    '1HZ10V':'Volatility 10 (1s) Index',   '1HZ15V':'Volatility 15 (1s) Index',
    '1HZ25V':'Volatility 25 (1s) Index',   '1HZ30V':'Volatility 30 (1s) Index',
    '1HZ50V':'Volatility 50 (1s) Index',   '1HZ75V':'Volatility 75 (1s) Index',
    '1HZ90V':'Volatility 90 (1s) Index',   '1HZ100V':'Volatility 100 (1s) Index',
    'R_10':'Volatility 10 Index',   'R_25':'Volatility 25 Index',
    'R_50':'Volatility 50 Index',   'R_75':'Volatility 75 Index',
    'R_100':'Volatility 100 Index',
};

const DERIV_WS = 'wss://ws.binaryws.com/websockets/v3?app_id=1';
const BUF_SIZE = 300;

const DISPLAY_MARKETS = [
    { group: 'Volatility (1s) Indices', items: [
        '1HZ10V','1HZ15V','1HZ25V','1HZ30V','1HZ50V','1HZ75V','1HZ90V','1HZ100V',
    ] },
    { group: 'Volatility Indices', items: ['R_10','R_25','R_50','R_75','R_100'] },
];

// ─── Win rate tracking ────────────────────────────────────────────────────────

interface WinRecord {
    id:        string;
    symbol:    string;
    direction: string;
    market:    MarketType;
    resolved:  boolean;
    won:       boolean;
}

function resolveSignal(market: MarketType, direction: string, digit: number): boolean {
    if (market === 'over_under') {
        const b = Number(direction.split(' ')[1]);
        return direction.startsWith('OVER') ? digit > b : digit < b;
    }
    if (market === 'even_odd') {
        return direction === 'EVEN' ? digit % 2 === 0 : digit % 2 !== 0;
    }
    const d = Number(direction.split(' ')[1]);
    return direction.startsWith('MATCHES') ? digit === d : digit !== d;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

function getRankColor(rank: number): string {
    if (rank === 1)  return '#10b981';
    if (rank === 2)  return '#0ea5e9';
    if (rank === 10) return '#ef4444';
    if (rank === 9)  return '#eab308';
    return '#64748b';
}
function getRankLabel(rank: number): string {
    if (rank === 1)  return 'Most';
    if (rank === 2)  return '2nd';
    if (rank === 10) return 'Least';
    if (rank === 9)  return '2nd↓';
    return '';
}
function computeRanks(dist: number[]): number[] {
    const indexed = dist.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const ranks   = new Array(10).fill(0);
    indexed.forEach(({ i }, pos) => { ranks[i] = pos + 1; });
    return ranks;
}
function circleSize(p: number): number { return Math.round(28 + (p / 20) * 16); }
const D_COLORS = ['#6366f1','#8b5cf6','#0ea5e9','#10b981','#eab308','#f97316','#ef4444','#ec4899','#14b8a6','#84cc16'];

// ─── Tick helpers ─────────────────────────────────────────────────────────────

function lastDigit(price: number, pip: number): number {
    return Math.abs(Math.round(price * Math.pow(10, pip))) % 10;
}
function buildDist(digits: number[]): number[] {
    const counts = Array(10).fill(0);
    for (const d of digits) counts[d]++;
    const n = digits.length || 1;
    return counts.map(c => Math.round((c / n) * 1000) / 10);
}

// ─── Per-symbol buffer ────────────────────────────────────────────────────────

interface SymBuf {
    digits:       number[];
    ts:           number[];
    pip:          number;
    liveDigit:    number | null;
    livePrice:    number | null;
    prevPrice:    number | null;
    distribution: number[];
    tickCount:    number;
    status:       'connecting' | 'live' | 'error';
}
function makeBuf(): SymBuf {
    return { digits:[], ts:[], pip:2, liveDigit:null, livePrice:null, prevPrice:null,
             distribution: Array(10).fill(0), tickCount:0, status:'connecting' };
}

// ─── Display snapshot ─────────────────────────────────────────────────────────

interface DisplaySnap {
    distribution: number[];
    liveDigit:    number | null;
    livePrice:    number | null;
    prevPrice:    number | null;
    pipSize:      number;
    tickCount:    number;
    status:       'connecting' | 'live' | 'error';
}
const INIT_SNAP: DisplaySnap = {
    distribution: Array(10).fill(0), liveDigit:null, livePrice:null,
    prevPrice:null, pipSize:2, tickCount:0, status:'connecting',
};

// ─── Multi-market hook ────────────────────────────────────────────────────────

interface TickEvent { sym: string; tc: number; }
interface MultiMarketHook {
    snap:       DisplaySnap;
    scanStatus: Record<string, 'connecting'|'live'|'error'>;
    tickEvent:  TickEvent | null;
    bufsRef:    React.MutableRefObject<Map<string, SymBuf>>;
}

function useMultiMarket(selectedSym: string): MultiMarketHook {
    const bufsRef    = useRef<Map<string, SymBuf>>(new Map(ALL_SYMBOLS.map(s => [s, makeBuf()])));
    const [snap, setSnap]         = useState<DisplaySnap>(INIT_SNAP);
    const [scanStatus, setScan]   = useState<Record<string, 'connecting'|'live'|'error'>>(
        Object.fromEntries(ALL_SYMBOLS.map(s => [s, 'connecting' as const])));
    const [tickEvent, setTickEvt] = useState<TickEvent | null>(null);
    const selectedRef             = useRef(selectedSym); selectedRef.current = selectedSym;

    const pushSnap = useCallback((sym: string) => {
        if (sym !== selectedRef.current) return;
        const buf = bufsRef.current.get(sym)!;
        setSnap({ distribution: [...buf.distribution], liveDigit: buf.liveDigit,
            livePrice: buf.livePrice, prevPrice: buf.prevPrice,
            pipSize: buf.pip, tickCount: buf.tickCount, status: buf.status });
    }, []);

    useEffect(() => {
        const wsList: WebSocket[] = [];

        ALL_SYMBOLS.forEach((sym, idx) => {
            const timer = setTimeout(() => {
                const ws = new WebSocket(DERIV_WS);
                wsList.push(ws);

                ws.onopen = () => ws.send(JSON.stringify({
                    ticks_history: sym, count: BUF_SIZE, end: 'latest',
                    style: 'ticks', subscribe: 1,
                }));

                ws.onmessage = (ev: MessageEvent) => {
                    const msg = JSON.parse(ev.data as string);
                    if (msg.error) {
                        bufsRef.current.get(sym)!.status = 'error';
                        setScan(s => ({ ...s, [sym]: 'error' }));
                        return;
                    }

                    const buf = bufsRef.current.get(sym)!;

                    if (msg.msg_type === 'history') {
                        const prices: number[] = msg.history?.prices ?? [];
                        const pip  = msg.pip_size ?? 2;
                        const digs = prices.map((p: number) => lastDigit(p, pip));
                        buf.pip          = pip;
                        buf.digits       = digs.slice(-BUF_SIZE);
                        buf.ts           = digs.map((_, i) => Date.now() - (digs.length - 1 - i) * 1000).slice(-50);
                        buf.tickCount    = buf.digits.length;
                        buf.liveDigit    = digs[digs.length - 1] ?? null;
                        buf.livePrice    = prices[prices.length - 1] ?? null;
                        buf.prevPrice    = null;
                        buf.distribution = buildDist(buf.digits);
                        buf.status       = 'live';
                        setScan(s => ({ ...s, [sym]: 'live' }));
                        pushSnap(sym);
                    }

                    if (msg.msg_type === 'tick' && msg.tick) {
                        const { quote, pip_size } = msg.tick;
                        const pip = pip_size ?? buf.pip;
                        const dig = lastDigit(quote, pip);
                        buf.pip          = pip;
                        buf.prevPrice    = buf.livePrice;
                        buf.digits       = [...buf.digits.slice(-(BUF_SIZE - 1)), dig];
                        buf.ts           = [...buf.ts.slice(-49), Date.now()];
                        buf.tickCount++;
                        buf.liveDigit    = dig;
                        buf.livePrice    = quote;
                        buf.distribution = buildDist(buf.digits);
                        buf.status       = 'live';
                        pushSnap(sym);
                        if (buf.tickCount % 10 === 0) {
                            setTickEvt({ sym, tc: buf.tickCount });
                        }
                    }
                };

                ws.onerror = () => {
                    bufsRef.current.get(sym)!.status = 'error';
                    setScan(s => ({ ...s, [sym]: 'error' }));
                };
            }, idx * 150);

            return () => clearTimeout(timer);
        });

        return () => wsList.forEach(ws => {
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            ws.close();
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const buf = bufsRef.current.get(selectedSym);
        if (!buf || buf.digits.length === 0) { setSnap(INIT_SNAP); return; }
        setSnap({ distribution: [...buf.distribution], liveDigit: buf.liveDigit,
            livePrice: buf.livePrice, prevPrice: null, pipSize: buf.pip,
            tickCount: buf.tickCount, status: buf.status });
    }, [selectedSym]);

    return { snap, scanStatus, tickEvent, bufsRef };
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useNow(ms = 1000): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
    return now;
}
function fmtCountdown(ms: number): string {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── QuadrantRow ──────────────────────────────────────────────────────────────

function QuadrantRow({ digits, distribution, ranks, liveDigit }: {
    digits: number[]; distribution: number[]; ranks: number[]; liveDigit: number | null;
}) {
    // Split 0–9 across two fixed-cell rows (0–4 upper, 5–9 lower) so a
    // circle resizing on each tick stays *inside* its grid cell instead of
    // shoving neighbors around. Cursor X is computed from the row index
    // (no DOM measurement → no per-tick reflow).
    const upper = digits.slice(0, 5);
    const lower = digits.slice(5, 10);

    const renderCell = (d: number) => {
        const rank   = ranks[d]; const color = getRankColor(rank);
        const p      = distribution[d] ?? 0; const size = circleSize(p);
        const isLive = liveDigit === d; const isHigh = rank <= 2 || rank >= 9;
        return (
            <div key={d} className='ez-circle-col'>
                <div className='ez-circle-holder'>
                    <motion.div
                        className='ez-circle'
                        animate={{ width: size, height: size, ...(isLive ? { boxShadow:[`0 0 0px ${color}00`,`0 0 32px ${color}cc`,`0 0 12px ${color}66`], scale:[1,1.2,1] } : {}) }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        style={{ background: isHigh ? color : `${color}20`, border: `2px solid ${color}`, color: isHigh ? '#fff' : color, boxShadow: isLive ? `0 0 16px ${color}` : isHigh ? `0 0 6px ${color}44` : 'none' }}
                    >
                        {d}
                        {isLive && (
                            <motion.div className='ez-circle__pulse'
                                animate={{ scale:[1,1.8], opacity:[0.5,0] }}
                                transition={{ duration:0.7, ease:'easeOut' }}
                                style={{ background: color }} />
                        )}
                    </motion.div>
                </div>
                <div className='ez-bar-track'><motion.div className='ez-bar-fill' style={{ background: color }} animate={{ width:`${Math.min(100,p*7)}%` }} transition={{ duration:0.6,ease:'easeOut' }} /></div>
                <span className='ez-pct' style={{ color }}>{p.toFixed(1)}%</span>
            </div>
        );
    };

    const renderBand = (rowDigits: number[], key: string) => {
        const liveIdx = liveDigit !== null ? rowDigits.indexOf(liveDigit) : -1;
        return (
            <div className='ez-band' key={key}>
                <div className='ez-cursor-layer'>
                    <AnimatePresence>
                        {liveIdx !== -1 && (
                            <motion.div className='ez-cursor'
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0, left: `${(liveIdx + 0.5) * 20}%` }}
                                transition={{ type: 'spring', stiffness: 500, damping: 28 }}>
                                <span className='ez-cursor__arrow'>▼</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <div className='ez-circles ez-circles--grid'>
                    {rowDigits.map(renderCell)}
                </div>
            </div>
        );
    };

    return (
        <div className='ez-quadrant ez-quadrant--split'>
            {renderBand(upper, 'upper')}
            {renderBand(lower, 'lower')}
        </div>
    );
}

// ─── LivePriceDisplay ─────────────────────────────────────────────────────────

function LivePriceDisplay({ livePrice, prevPrice, liveDigit, pipSize, status }: {
    livePrice:number|null; prevPrice:number|null; liveDigit:number|null; pipSize:number; status:string;
}) {
    const dir      = livePrice !== null && prevPrice !== null ? livePrice > prevPrice ? 'up' : livePrice < prevPrice ? 'down' : 'flat' : 'flat';
    const priceStr = livePrice !== null ? livePrice.toFixed(pipSize) : '—';
    const prefix   = livePrice !== null ? priceStr.slice(0, -1) : '—';
    const lastChar = liveDigit !== null ? String(liveDigit) : '—';
    const dc       = liveDigit !== null ? D_COLORS[liveDigit] : '#94a3b8';
    return (
        <div className='ez-price'>
            <div className='ez-price__status'>
                {status==='live'       ? <span className='ez-dot ez-dot--live'/>       : null}
                {status==='connecting' ? <span className='ez-dot ez-dot--connecting'/> : null}
                {status==='error'      ? <span className='ez-dot ez-dot--error'/>      : null}
                <span className='ez-price__status-text'>{status==='live'?'Live':status==='connecting'?'Connecting…':'Error'}</span>
                {dir==='up'   && <TrendingUp   className='ez-price__arrow ez-price__arrow--up'/>}
                {dir==='down' && <TrendingDown  className='ez-price__arrow ez-price__arrow--down'/>}
            </div>
            <div className='ez-price__value'>
                <span className='ez-price__prefix'>{prefix}</span>
                <AnimatePresence mode='wait'>
                    <motion.span key={lastChar} className='ez-price__last-digit' style={{ color:dc, textShadow:`0 0 16px ${dc}80` }}
                        initial={{ y:-18, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:18, opacity:0 }} transition={{ duration:0.2 }}>
                        {lastChar}
                    </motion.span>
                </AnimatePresence>
            </div>
        </div>
    );
}

// ─── Scan status row ──────────────────────────────────────────────────────────

function ScanStatusRow({ statuses }: { statuses: Record<string, 'connecting'|'live'|'error'> }) {
    const liveCount = ALL_SYMBOLS.filter(s => statuses[s] === 'live').length;
    return (
        <div className='se-scan-row'>
            <span className='se-scan-row__label'>
                {liveCount}/{ALL_SYMBOLS.length} markets live
            </span>
            <div className='se-scan-row__dots'>
                {ALL_SYMBOLS.map(sym => (
                    <span key={sym} className={`se-scan-dot se-scan-dot--${statuses[sym] ?? 'connecting'}`} title={SYM_SHORT[sym]} />
                ))}
            </div>
        </div>
    );
}

// ─── Signal Settings Modal ────────────────────────────────────────────────────

interface SignalSettings {
    stake:      string;
    takeProfit: string;
    stopLoss:   string;
    martingale: string;
    ticks:      string;
}

type RunState = 'idle' | 'launching' | 'no-workspace' | 'error';

function SignalSettingsModal({ signal, rank, onClose }: {
    signal: Signal; rank: number; onClose: () => void;
}) {
    const { dashboard, run_panel } = useStore();
    const storageKey = `sig_cfg_${signal.symbol}_${signal.market}`;
    const defaultTicks = String(signal.recommendedTicks ?? 1);
    const [cfg, setCfg] = useState<SignalSettings>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<SignalSettings>;
                // Always honour the signal's recommended ticks for a fresh open
                // (the user can still change it before clicking Save & Run).
                return {
                    stake:      parsed.stake      ?? '0.5',
                    takeProfit: parsed.takeProfit ?? '10',
                    stopLoss:   parsed.stopLoss   ?? '30',
                    martingale: parsed.martingale ?? '2',
                    ticks:      defaultTicks,
                };
            }
        } catch { /* ignore */ }
        return { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '2', ticks: defaultTicks };
    });
    const [runState,   setRunState]   = useState<RunState>('idle');
    const [errMsg,     setErrMsg]     = useState('');
    const [engineMode, setEngineMode] = useState<'v1' | 'v2'>(() =>
        localStorage.getItem(ENGINE_KEY) === 'v2' ? 'v2' : 'v1'
    );
    const color = MARKET_COLOR[signal.market];

    // Pre-warm the bot XML the moment the modal opens. By the time the user
    // finishes adjusting stake/TP/SL/martingale and clicks Run, the file is
    // already cached in memory — saves the ~200–500 ms cold fetch + parse.
    useEffect(() => {
        try { prefetchBotXml(botIdFromSignal(signal)); } catch { /* ignore */ }
    }, [signal.market, signal.direction]);

    async function handleRun() {
        localStorage.setItem(storageKey, JSON.stringify(cfg));
        setRunState('launching');
        setErrMsg('');

        try {
            const stake      = parseFloat(cfg.stake)      || 0.5;
            const takeProfit = parseFloat(cfg.takeProfit) || 10;
            const stopLoss   = parseFloat(cfg.stopLoss)   || 30;
            const martingale = parseFloat(cfg.martingale) || 2;
            const ticks      = Math.max(1, Math.min(10, Math.round(parseInt(cfg.ticks, 10) || 1)));

            // Persist the chosen engine mode globally
            localStorage.setItem(ENGINE_KEY, engineMode);
            window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_KEY, newValue: engineMode }));

            if (engineMode === 'v2') {
                // ── V2: build config directly from signal — no XML needed ──────────────
                // XML parsing was unreliable (TYPE_LIST varies per bot file). The signal
                // already carries the exact market + direction, so we derive V2BotConfig
                // straight from those values.
                const entryPoint      = parseDigitFrom(signal.entryPoint);
                const martingaleLevel = Math.max(3, Math.min(10, Math.round(stopLoss / stake)));

                type ContractKind  = 'DIGITMATCH'|'DIGITDIFF'|'DIGITEVEN'|'DIGITODD'|'DIGITOVER'|'DIGITUNDER';
                type TradeDir      = 'EVEN'|'ODD'|'OVER'|'UNDER';

                let contractKind: ContractKind;
                let direction:    TradeDir | undefined;
                let prediction:   number   | undefined;
                let barrier:      number   | undefined;

                if (signal.market === 'even_odd') {
                    const d = signal.direction.trim().toUpperCase();
                    direction    = d === 'ODD' ? 'ODD' : 'EVEN';
                    contractKind = d === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';

                } else if (signal.market === 'over_under') {
                    const parts  = signal.direction.trim().toUpperCase().split(/\s+/);
                    direction    = parts[0] === 'UNDER' ? 'UNDER' : 'OVER';
                    barrier      = parseInt(parts[1] ?? '5', 10);
                    contractKind = direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';

                } else {
                    // matches_differs
                    const parts  = signal.direction.trim().toUpperCase().split(/\s+/);
                    const isDiff = parts[0] === 'DIFFERS' || parts[0] === 'DIFFER';
                    contractKind = isDiff ? 'DIGITDIFF' : 'DIGITMATCH';
                    prediction   = parseInt(parts[1] ?? '0', 10);
                }

                const v2Cfg = {
                    symbol: signal.symbol,
                    contractKind,
                    direction,
                    prediction,
                    barrier,
                    entryPoint,
                    initialStake:    stake,
                    martingale,
                    martingaleLevel,
                    takeProfit,
                    stopLoss,
                    duration:        ticks,
                };

                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CONFIG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CONFIG_KEY, newValue: v2CfgStr }));

                onClose();

                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('deriv-v2-autostart'));
                }, 400);

            } else {
                // ── V1: fetch XML, load into DBot Blockly workspace, auto-run ──────────
                const botId  = botIdFromSignal(signal);
                const doc    = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale, ticks);
                const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);

                const Blockly = (window as any).Blockly;
                if (!Blockly?.derivWorkspace) {
                    setRunState('no-workspace');
                    return;
                }

                const dom = Blockly.utils.xml.textToDom(xmlStr);
                Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
                Blockly.derivWorkspace.cleanUp();
                Blockly.derivWorkspace.clearUndo();

                dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
                onClose();

                // 150 ms is enough for the Bot Builder tab to mount and the
                // Blockly workspace to register the freshly-loaded XML. The old
                // 500 ms was an over-conservative buffer.
                setTimeout(() => {
                    if (!(run_panel as any).is_running) {
                        run_panel.onRunButtonClick();
                    }
                }, 150);
            }

        } catch (e: any) {
            setRunState('error');
            setErrMsg(e?.message || 'Failed to load bot.');
        }
    }

    const fields: { label: string; key: keyof SignalSettings; hint: string; step: string; min: string; max?: string }[] = [
        { label: 'Stake',       key: 'stake',      hint: '$',     step: '0.01', min: '0' },
        { label: 'Take Profit', key: 'takeProfit',  hint: '$',     step: '0.01', min: '0' },
        { label: 'Stop Loss',   key: 'stopLoss',    hint: '$',     step: '0.01', min: '0' },
        { label: 'Martingale',  key: 'martingale',  hint: '×',     step: '0.1',  min: '0' },
        { label: 'Ticks',       key: 'ticks',       hint: 'duration', step: '1', min: '1', max: '10' },
    ];

    return (
        <div className='se-modal-overlay' onClick={onClose}>
            <motion.div className='se-modal'
                initial={{ opacity:0, scale:0.94, y:24 }} animate={{ opacity:1, scale:1, y:0 }}
                exit={{ opacity:0, scale:0.94, y:24 }} transition={{ duration:0.22, ease:'easeOut' }}
                onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className='se-modal__header'>
                    <span className='se-modal__title'>Signal Settings</span>
                    <button className='se-modal__close' onClick={onClose}><X size={16}/></button>
                </div>

                {/* Signal info card */}
                <div className='se-modal__info-card'>
                    <div className='se-modal__info-left'>
                        <span className='se-modal__info-row-label'>Selected:</span>
                        <span className='se-modal__info-sym'>{signal.symbolLabel}</span>
                    </div>
                    <div className='se-modal__info-right'>
                        <span className='se-modal__info-dir' style={{ color }}>{signal.direction}</span>
                        <span className='se-modal__info-meta'>Rank #{rank} | Confidence: {signal.confidence}%</span>
                    </div>
                </div>

                {/* Engine mode selector */}
                <div className='se-modal__engine-row'>
                    <div className='se-modal__engine-label-wrap'>
                        <span className='se-modal__engine-label'>Execute with</span>
                        <span className='se-modal__engine-rec'>
                            ★ Recommended: <strong>{signal.recommendedEngine.toUpperCase()}</strong>
                        </span>
                    </div>
                    <div className='se-modal__engine-seg'>
                        <button
                            type='button'
                            className={`se-modal__engine-opt ${engineMode === 'v1' ? 'se-modal__engine-opt--active' : ''}`}
                            onClick={() => setEngineMode('v1')}
                        >
                            ⚙️ V1
                            {signal.recommendedEngine === 'v1' && <span className='se-modal__engine-star'>★</span>}
                        </button>
                        <button
                            type='button'
                            className={`se-modal__engine-opt se-modal__engine-opt--v2 ${engineMode === 'v2' ? 'se-modal__engine-opt--v2-active' : ''}`}
                            onClick={() => setEngineMode('v2')}
                        >
                            ⚡ V2
                            {signal.recommendedEngine === 'v2' && <span className='se-modal__engine-star'>★</span>}
                        </button>
                    </div>
                </div>

                {/* Inputs 2×2 */}
                <div className='se-modal__inputs'>
                    {fields.map(({ label, key, hint, step, min, max }) => {
                        const isTicks = key === 'ticks';
                        return (
                            <div key={key} className={`se-modal__field${isTicks ? ' se-modal__field--full' : ''}`}>
                                <label className='se-modal__field-label'>
                                    {label} <span className='se-modal__field-hint'>{hint}</span>
                                    {isTicks && (
                                        <span className='se-modal__field-rec'>
                                            recommended: {signal.recommendedTicks}
                                        </span>
                                    )}
                                </label>
                                {isTicks ? (
                                    <select
                                        className='se-modal__input se-modal__select'
                                        value={cfg.ticks}
                                        onChange={e => setCfg(p => ({ ...p, ticks: e.target.value }))}
                                        disabled={runState === 'launching'}
                                    >
                                        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                            <option key={n} value={String(n)}>
                                                {n} {n === 1 ? 'tick' : 'ticks'}
                                                {n === signal.recommendedTicks ? '  ★ recommended' : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        className='se-modal__input'
                                        type='number' min={min} step={step} max={max}
                                        value={cfg[key]}
                                        onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
                                        disabled={runState === 'launching'}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* No-workspace warning */}
                {runState === 'no-workspace' && (
                    <motion.div className='se-modal__warn-banner'
                        initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}>
                        <div className='se-modal__warn-icon'>⚠️</div>
                        <div className='se-modal__warn-body'>
                            <strong>Bot Builder not ready yet.</strong>
                            <span>Visit the <strong>Bot Builder</strong> tab once to initialise the workspace, then come back and tap Save &amp; Run again.</span>
                        </div>
                        <button className='se-modal__btn se-modal__btn--cancel se-modal__warn-close' onClick={() => setRunState('idle')}>OK</button>
                    </motion.div>
                )}

                {/* Generic error */}
                {runState === 'error' && (
                    <motion.div className='se-modal__warn-banner se-modal__warn-banner--error'
                        initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}>
                        <div className='se-modal__warn-icon'>❌</div>
                        <div className='se-modal__warn-body'>
                            <strong>Could not load bot.</strong>
                            <span>{errMsg}</span>
                        </div>
                        <button className='se-modal__btn se-modal__btn--cancel se-modal__warn-close' onClick={() => setRunState('idle')}>Retry</button>
                    </motion.div>
                )}

                {/* Footer */}
                <div className='se-modal__footer'>
                    <button className='se-modal__btn se-modal__btn--cancel'
                        onClick={onClose} disabled={runState === 'launching'}>Cancel</button>
                    <button className='se-modal__btn se-modal__btn--run'
                        onClick={handleRun} disabled={runState === 'launching'}>
                        {runState === 'launching'
                            ? <><Loader2 size={13} className='se-modal__spin'/> Launching…</>
                            : 'Save and Run'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

const MARKET_LABEL: Record<MarketType, string> = {
    over_under:'OVER / UNDER', even_odd:'EVEN / ODD', matches_differs:'MATCH / DIFFER',
};
const MARKET_COLOR: Record<MarketType, string> = {
    over_under:'#6366f1', even_odd:'#10b981', matches_differs:'#f59e0b',
};

function SignalCard({ signal, now, winResult, onLoadAI }: {
    signal: Signal; now: number; winResult?: boolean; onLoadAI: () => void;
}) {
    const remaining = signal.expiresAt - now;
    const ttl       = signal.expiresAt - signal.createdAt; // 60 000 or 120 000
    const pct       = Math.max(0, remaining / ttl);
    const color     = MARKET_COLOR[signal.market];
    const urgent    = remaining < 30_000;

    // Recency bar colour: green if strong, amber if moderate
    const recentPct  = signal.recentTotal > 0 ? signal.recentScore / signal.recentTotal : 0;
    const recentColor = recentPct >= 0.70 ? '#10b981' : recentPct >= 0.55 ? '#eab308' : '#ef4444';

    return (
        <motion.div className='se-signal-card'
            initial={{ opacity:0, y:12, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }}
            exit={{ opacity:0, y:-10, scale:0.95 }} transition={{ duration:0.3 }}
            style={{ '--sig-color': color } as React.CSSProperties}>

            {/* head: market badge + timer + optional win/loss */}
            <div className='se-signal-card__head'>
                <span className='se-signal-card__badge' style={{ background:`${color}22`, color }}>
                    {MARKET_LABEL[signal.market]}
                </span>
                <div className='se-signal-card__head-right'>
                    {winResult !== undefined && (
                        <span className={`se-signal-card__result se-signal-card__result--${winResult ? 'win' : 'loss'}`}>
                            {winResult ? '✓ WIN' : '✗ LOSS'}
                        </span>
                    )}
                    <span className={`se-signal-card__timer ${urgent ? 'se-signal-card__timer--urgent' : ''}`}>
                        ⏱ {fmtCountdown(remaining)}
                    </span>
                </div>
            </div>

            <div className='se-signal-card__direction' style={{ color }}>{signal.direction}</div>

            <div className='se-signal-card__symbol'>
                <span className='se-signal-card__sym-badge'>{SYM_SHORT[signal.symbol] ?? signal.symbol}</span>
                {signal.symbolLabel}
            </div>

            <div className='se-signal-card__models'>
                {signal.modelsAgreeing.map(m => (
                    <span key={m} className='se-signal-card__model-chip'>{m}</span>
                ))}
            </div>

            {/* meta: sample size + recency score */}
            <div className='se-signal-card__meta'>
                <span className='se-signal-card__meta-pill'>
                    📊 {signal.sampleSize} ticks
                </span>
                <span className='se-signal-card__meta-pill' style={{ color: recentColor }}>
                    🕐 {signal.recentScore}/{signal.recentTotal} recent
                </span>
            </div>

            <div className='se-signal-card__conf-row'>
                <span className='se-signal-card__conf-label'>Confidence</span>
                <span className='se-signal-card__conf-val' style={{ color }}>{signal.confidence}%</span>
            </div>
            <div className='se-signal-card__conf-track'>
                <motion.div className='se-signal-card__conf-fill' style={{ background: color }}
                    initial={{ width:0 }} animate={{ width:`${signal.confidence}%` }}
                    transition={{ duration:0.6, ease:'easeOut' }} />
            </div>

            <div className='se-signal-card__entry'>{signal.entryPoint}</div>

            <button className='se-signal-card__ai-btn' onClick={onLoadAI}>
                <Bot size={11} /> Load AI Signal
            </button>

            <div className='se-signal-card__ttl-track'>
                <motion.div className='se-signal-card__ttl-fill'
                    style={{ background: urgent ? '#ef4444' : color }}
                    animate={{ width:`${pct*100}%` }} transition={{ duration:0.9, ease:'linear' }} />
            </div>
        </motion.div>
    );
}

// ─── Volatility badge ─────────────────────────────────────────────────────────

function VolBadge({ digits, tickTimes }: { digits: number[]; tickTimes: number[] }) {
    const { status, reason } = modelVolatility(digits, tickTimes);
    return (
        <div className={`se-vol-badge se-vol-badge--${status.toLowerCase()}`}>
            <span className='se-vol-badge__dot' />
            <span>{status === 'ALLOW' ? 'Stable' : reason}</span>
        </div>
    );
}

// ─── Win rate pill ────────────────────────────────────────────────────────────

function WinRatePill({ wins, total }: { wins: number; total: number }) {
    if (total === 0) return null;
    const pct   = Math.round((wins / total) * 100);
    const color = pct >= 60 ? '#10b981' : pct >= 45 ? '#eab308' : '#ef4444';
    return (
        <span className='se-win-rate' style={{ color, borderColor: `${color}40`, background: `${color}12` }}>
            {wins}/{total} won · {pct}%
        </span>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SignalEngine = () => {
    const [selectedSym, setSelectedSym] = useState<string>('1HZ10V');
    const { snap, scanStatus, tickEvent, bufsRef } = useMultiMarket(selectedSym);

    const { distribution, liveDigit, livePrice, prevPrice, pipSize, tickCount, status } = snap;
    const ranks = computeRanks(distribution);

    // Signal state
    const [signals,   setSignals]   = useState<Signal[]>([]);
    const mlWeightsRef              = useRef<MLWeights>(initialMLWeights());
    const now                       = useNow(1000);

    // Signal settings modal
    const [settingsSignal, setSettingsSignal] = useState<{ signal: Signal; rank: number } | null>(null);

    // Win rate tracking
    const winRecordsRef = useRef<WinRecord[]>([]);
    const [winStats,  setWinStats]  = useState<{ wins: number; total: number }>({ wins: 0, total: 0 });
    const [winMap,    setWinMap]    = useState<Map<string, boolean>>(new Map());

    // Expire signals every second
    useEffect(() => {
        setSignals(prev => prev.filter(s => s.expiresAt > now));
    }, [now]);

    // Run analysis on every 10-tick event + resolve win records
    useEffect(() => {
        if (!tickEvent) return;
        const { sym, tc } = tickEvent;
        const buf = bufsRef.current.get(sym);
        if (!buf || buf.digits.length < 50) return;

        const dig = buf.liveDigit;

        // 1. Resolve any pending win records for this symbol
        if (dig !== null) {
            let anyResolved = false;
            winRecordsRef.current.forEach(rec => {
                if (rec.resolved || rec.symbol !== sym) return;
                rec.won      = resolveSignal(rec.market, rec.direction, dig);
                rec.resolved = true;
                anyResolved  = true;
            });
            if (anyResolved) {
                // Keep at most 100 records
                if (winRecordsRef.current.length > 100)
                    winRecordsRef.current = winRecordsRef.current.slice(-100);
                const resolved = winRecordsRef.current.filter(r => r.resolved);
                const newMap   = new Map(resolved.map(r => [r.id, r.won]));
                setWinMap(newMap);
                setWinStats({ wins: resolved.filter(r => r.won).length, total: resolved.length });
            }
        }

        // 2. Retrain ML every 50 ticks on the selected symbol
        if (sym === selectedSym && tc % 50 === 0) {
            mlWeightsRef.current = trainMLWeights(buf.digits, mlWeightsRef.current);
        }

        // 3. Run signal analysis
        const symLabel = SYM_LONG[sym] ?? sym;
        setSignals(prev => {
            const nowT          = Date.now();
            const active        = prev.filter(s => s.expiresAt > nowT);
            const activeMarkets = new Set(
                active.filter(s => s.symbol === sym).map(s => s.market)
            ) as Set<MarketType>;

            const newSigs = analyzeSignals(
                buf.digits, buf.ts, sym, symLabel,
                mlWeightsRef.current, activeMarkets,
            );

            if (newSigs.length > 0) {
                // Register new signals for win tracking
                newSigs.forEach(s => winRecordsRef.current.push({
                    id: s.id, symbol: s.symbol,
                    direction: s.direction, market: s.market,
                    resolved: false, won: false,
                }));
            }

            return newSigs.length > 0 ? [...active, ...newSigs] : active;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tickEvent]);

    // Publish top signal per direction type to localStorage for Free Bots wiring
    useEffect(() => {
        const now = Date.now();
        const active = signals.filter(s => s.expiresAt > now);

        const topMatch  = active.filter(s => s.market === 'matches_differs' && s.direction.startsWith('MATCHES'))
                                .sort((a, b) => b.confidence - a.confidence)[0];
        const topDiffer = active.filter(s => s.market === 'matches_differs' && s.direction.startsWith('DIFFERS'))
                                .sort((a, b) => b.confidence - a.confidence)[0];
        const topEO     = active.filter(s => s.market === 'even_odd')
                                .sort((a, b) => b.confidence - a.confidence)[0];
        const topOU     = active.filter(s => s.market === 'over_under')
                                .sort((a, b) => b.confidence - a.confidence)[0];

        const push = (key: string, sig: Signal | undefined) => {
            if (!sig) return;
            localStorage.setItem(key, JSON.stringify({
                symbol:      sig.symbol,
                symbolLabel: sig.symbolLabel,
                direction:   sig.direction,
                entryPoint:  sig.entryPoint,
                confidence:  sig.confidence,
                market:      sig.market,
                savedAt:     now,
            }));
        };
        push('fb_signal_matches',    topMatch);
        push('fb_signal_differs',    topDiffer);
        push('fb_signal_even_odd',   topEO);
        push('fb_signal_over_under', topOU);
        window.dispatchEvent(new Event('fb_signal_update'));
    }, [signals]);

    // Sort signals: highest confidence first, cap at 6
    const displaySignals = [...signals]
        .sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt)
        .slice(0, 6);

    const liveCount = ALL_SYMBOLS.filter(s => scanStatus[s] === 'live').length;

    const selBuf    = bufsRef.current.get(selectedSym);
    const selDigits = selBuf?.digits ?? [];
    const selTs     = selBuf?.ts     ?? [];

    return (
        <>
        <div className='ez-root se-root'>
            {/* ── Header ── */}
            <div className='ez-header'>
                <div className='ez-header__title-block'>
                    <span className='ez-header__title'>Signal Engine</span>
                    <span className='ez-header__sub'>
                        Scanning all 13 volatility indices · {tickCount} ticks
                    </span>
                </div>
                <div className='ez-selector'>
                    <label className='ez-selector__label'>Display</label>
                    <div className='ez-selector__wrap'>
                        <select className='ez-selector__select' value={selectedSym} onChange={e => setSelectedSym(e.target.value)}>
                            {DISPLAY_MARKETS.map(g => (
                                <optgroup key={g.group} label={g.group}>
                                    {g.items.map(s => <option key={s} value={s}>{SYM_LONG[s]}</option>)}
                                </optgroup>
                            ))}
                        </select>
                        <ChevronDown className='ez-selector__chevron' />
                    </div>
                </div>
            </div>

            {/* ── Scan status row ── */}
            <ScanStatusRow statuses={scanStatus} />

            {/* ── Live price ── */}
            <div className='ez-price-row'>
                <LivePriceDisplay livePrice={livePrice} prevPrice={prevPrice} liveDigit={liveDigit} pipSize={pipSize} status={status} />
                <div className='ez-cursor-tag'>
                    {liveDigit !== null && (<>
                        <span className='ez-cursor-tag__arrow' style={{ color:'#ef4444' }}>▼</span>
                        <span className='ez-cursor-tag__label'>Digit</span>
                        <AnimatePresence mode='wait'>
                            <motion.span key={liveDigit} className='ez-cursor-tag__digit' style={{ color:D_COLORS[liveDigit] }}
                                initial={{ scale:0.5, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0.5, opacity:0 }}
                                transition={{ type:'spring', stiffness:500, damping:22 }}>
                                {liveDigit}
                            </motion.span>
                        </AnimatePresence>
                    </>)}
                    {status === 'connecting' && <Loader2 className='ez-spinner'/>}
                    {status === 'error'      && <WifiOff className='ez-error-icon'/>}
                    {status === 'live' && liveDigit === null && <Wifi className='ez-wifi-icon'/>}
                </div>
            </div>

            {/* ── Digit circles (single row, single cursor) ── */}
            <div className='ez-quadrants ez-quadrants--single'>
                <QuadrantRow digits={[0,1,2,3,4,5,6,7,8,9]} distribution={distribution} ranks={ranks} liveDigit={liveDigit} />
            </div>

            {/* ── Signals section ── */}
            <div className='se-signals-card'>
                <div className='se-signals-card__header'>
                    <span className='se-signals-card__title'>
                        ⚡ Signals
                        {signals.length > 0 && (
                            <span className='se-signals-card__count'>{signals.length}</span>
                        )}
                    </span>
                    <div className='se-signals-card__header-right'>
                        <WinRatePill wins={winStats.wins} total={winStats.total} />
                        {selDigits.length > 0 && <VolBadge digits={selDigits} tickTimes={selTs} />}
                    </div>
                </div>
                <div className='se-signals-card__body'>
                    {displaySignals.length === 0 ? (
                        <div className='se-signals-card__empty'>
                            <span className='se-signals-card__empty-icon'>
                                {liveCount === 0 ? '🔌' : liveCount < 13 ? '📡' : '🔍'}
                            </span>
                            <span className='se-signals-card__empty-text'>
                                {liveCount === 0
                                    ? 'Connecting to markets…'
                                    : liveCount < 13
                                    ? `Connected ${liveCount}/13 markets — collecting data…`
                                    : 'All 13 markets live — scanning for high-confidence signals…'}
                            </span>
                        </div>
                    ) : (
                        <AnimatePresence>
                            {displaySignals.map((sig, idx) => (
                                <SignalCard key={sig.id} signal={sig} now={now} winResult={winMap.get(sig.id)}
                                    onLoadAI={() => setSettingsSignal({ signal: sig, rank: idx + 1 })} />
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>
        </div>

        {/* ── Signal Settings Modal ── */}
        <AnimatePresence>
            {settingsSignal && (
                <SignalSettingsModal
                    signal={settingsSignal.signal}
                    rank={settingsSignal.rank}
                    onClose={() => setSettingsSignal(null)}
                />
            )}
        </AnimatePresence>
        </>
    );
};

export default SignalEngine;
