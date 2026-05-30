import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, Zap, RefreshCw } from 'lucide-react';
import { DERIV_VOLATILITIES, type DerivVolatility } from '@/utils/deriv-volatilities';
import {
    botIdFromSignal,
    fetchAndPatchBot,
    parseDigitFrom,
    prefetchBotXml,
    type BotSignal,
} from '@/utils/bot-patch';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './ai-signal-orb.scss';

// ─── Constants ────────────────────────────────────────────────────────────────

const DERIV_WS     = 'wss://ws.derivws.com/websockets/v3?app_id=1';
const TICK_COUNT   = 4000;
const ENGINE_KEY   = 'free_bots_engine_mode';
const V2_CFG_KEY   = 'free_bots_v2_config';
const ALL_SYMS     = DERIV_VOLATILITIES;
const MIN_VOTES_OU = 4;   // Over/Under: require 4/5 models
const MIN_VOTES_EO = 4;   // Even/Odd:   require 4/5 models
const MIN_WIN_PROB_OU = 0.63; // Over/Under: minimum 63% win probability

type TradeType = 'over_under' | 'even_odd';
type RunState  = 'idle' | 'launching' | 'no-workspace' | 'error';
type ScanState = 'idle' | 'scanning' | 'done' | 'no-signal';

// ─── Analysis types ───────────────────────────────────────────────────────────

interface ModelResult { name: string; vote: boolean; score: number; }
interface ModelVotes  {
    chiSquared: ModelResult; bayesian: ModelResult; momentum: ModelResult;
    stability:  ModelResult; recentEdge: ModelResult;
    yesCount: number; totalScore: number;
}
interface MarketResult {
    sym:             DerivVolatility;
    direction:            string;
    contractType:         string;
    barrier:              number | null;
    recoveryBarrier:      number | null;      // cross-direction recovery barrier
    recoveryContractType: string | null;      // OPPOSITE contract type for recovery
    recoveryDirection:    string | null;      // e.g. "UNDER 8" — always opposite side
    winProb:              number;
    sampleSize:      number;
    votes:           ModelVotes;
    entryDigits:     { digit: number; recommended: boolean; conditional: number }[];
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const lastDigitOf = (q: number, pip: number): number => {
    const s = q.toFixed(pip);
    return parseInt(s[s.length - 1], 10);
};
const wilsonLower = (wins: number, total: number, z = 1.96): number => {
    if (total === 0) return 0;
    const p = wins / total, z2 = z * z, den = 1 + z2 / total;
    const ctr = p + z2 / (2 * total);
    const mrg = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
    return (ctr - mrg) / den;
};

// ─── 5-model analysis (mirrors entry-zone/index.tsx runModels exactly) ────────

function runModels(prices: number[], pip: number, sym: DerivVolatility, tradeType: TradeType): MarketResult {
    const N      = prices.length;
    const digits = prices.map(p => lastDigitOf(p, pip));
    const freq   = new Array(10).fill(0);
    for (const d of digits) freq[d]++;
    const freqPct = freq.map(f => f / N);

    let direction = '', contractType = '', barrier: number | null = null,
        recoveryBarrier: number | null = null, recoveryContractType: string | null = null,
        recoveryDirection: string | null = null, winProb = 0;
    let winFn: (d: number) => boolean;

    if (tradeType === 'even_odd') {
        const evenCt = digits.filter(d => d % 2 === 0).length;
        const oddCt  = N - evenCt;
        if (evenCt >= oddCt) { direction = 'EVEN'; contractType = 'DIGITEVEN'; winProb = evenCt / N; winFn = d => d % 2 === 0; }
        else                 { direction = 'ODD';  contractType = 'DIGITODD';  winProb = oddCt  / N; winFn = d => d % 2 !== 0; }
    } else {
        // Score all 16 barrier options (OVER 1-8, UNDER 1-8) to find best + recovery
        const allOptions: { side: 'OVER' | 'UNDER'; b: number; prob: number }[] = [];
        for (let b = 1; b <= 8; b++) {
            allOptions.push({ side: 'OVER',  b, prob: digits.filter(d => d > b).length / N });
            allOptions.push({ side: 'UNDER', b, prob: digits.filter(d => d < b).length / N });
        }
        allOptions.sort((a, b2) => b2.prob - a.prob);
        const best = allOptions[0];
        // Recovery: ALWAYS pick from the OPPOSITE side
        // OVER loss → best UNDER option; UNDER loss → best OVER option
        const oppositeOptions = allOptions.filter(o => o.side !== best.side);
        const recovery = oppositeOptions[0] ?? allOptions[1] ?? best;
        barrier              = best.b;
        recoveryBarrier      = recovery.b;
        recoveryContractType = recovery.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        recoveryDirection    = `${recovery.side} ${recovery.b}`;
        direction    = `${best.side} ${best.b}`;
        contractType = best.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        winProb      = best.prob;
        winFn        = d => best.side === 'OVER' ? d > best.b : d < best.b;
    }

    // Entry digits
    const cond = new Array(10).fill(null).map(() => ({ wins: 0, total: 0 }));
    for (let i = 0; i < digits.length - 1; i++) { cond[digits[i]].total++; if (winFn(digits[i + 1])) cond[digits[i]].wins++; }
    const minSmp = Math.max(50, Math.floor(N / 50));
    let entryRaw = cond
        .map((c, d) => ({ digit: d, conditional: c.total > 0 ? c.wins / c.total : 0, lowerBound: wilsonLower(c.wins, c.total), total: c.total }))
        .filter(c => c.total >= minSmp && c.lowerBound >= winProb + 0.02)
        .sort((a, b) => b.lowerBound - a.lowerBound || b.conditional - a.conditional).slice(0, 2);
    if (entryRaw.length < 2) {
        const used = new Set(entryRaw.map(e => e.digit));
        const fb = cond.map((c, d) => ({ digit: d, conditional: c.total > 0 ? c.wins / c.total : 0, lowerBound: wilsonLower(c.wins, c.total), total: c.total }))
            .filter(c => !used.has(c.digit) && c.total >= minSmp).sort((a, b) => b.lowerBound - a.lowerBound || b.conditional - a.conditional);
        while (entryRaw.length < 2 && fb.length > 0) entryRaw.push(fb.shift()!);
    }
    while (entryRaw.length < 2) {
        const used = new Set(entryRaw.map(e => e.digit));
        const fb2 = freqPct.map((p, d) => ({ digit: d, conditional: p, lowerBound: 0, total: 0 }))
            .filter(e => !used.has(e.digit)).sort((a, b) => b.conditional - a.conditional)[0];
        if (!fb2) break;
        entryRaw.push(fb2);
    }
    const entryDigits = entryRaw.map((e, i) => ({ digit: e.digit, recommended: i === 0, conditional: e.conditional }));

    // Model 1 — Chi²/Z-test
    let m1: ModelResult;
    if (tradeType === 'even_odd') {
        const zStat = (winProb - 0.5) / Math.sqrt(0.25 / N);
        const vote  = Math.abs(zStat) >= 1.65 && winProb >= 0.51;
        m1 = { name: 'Stat. Significance', vote, score: Math.min(1, Math.abs(zStat) / 4) };
    } else {
        const exp = N / 10; const chiSq = freq.reduce((acc, f) => acc + (f - exp) ** 2 / exp, 0);
        const vote = chiSq >= 16.92 && winProb >= 0.62;
        m1 = { name: 'Stat. Significance', vote, score: Math.min(1, chiSq / 30) };
    }

    // Model 2 — Bayesian
    const best2  = entryDigits[0];
    const m2Vote = best2 ? best2.conditional >= winProb + 0.05 : false;
    const m2: ModelResult = { name: 'Bayesian', vote: m2Vote, score: best2 ? Math.min(1, Math.max(0, (best2.conditional - winProb) / 0.20)) : 0 };

    // Model 3 — Trend
    const w3A = Math.floor(N * 0.10), w3B = Math.floor(N * 0.30), w3C = Math.floor(N * 0.60);
    const winR = digits.slice(-w3A).filter(winFn).length / w3A;
    const winM = digits.slice(-(w3A + w3B), -w3A).filter(winFn).length / w3B;
    const winO = digits.slice(-(w3A + w3B + w3C), -(w3A + w3B)).filter(winFn).length / w3C;
    const m3Vote = winR >= winProb - 0.01 && winM >= winProb - 0.02 && winO >= winProb - 0.03 && winR >= winM - 0.03;
    const m3: ModelResult = { name: '3-Window Trend', vote: m3Vote, score: Math.min(1, Math.max(0, ((winR - winProb) + (winM - winProb) + (winO - winProb) + 0.06) / 0.18)) };

    // Model 4 — Stability
    const wSz = Math.floor(N / 5), wThr = tradeType === 'even_odd' ? 0.50 : 0.60;
    let wAbove = 0;
    for (let w = 0; w < 5; w++) { const wr = digits.slice(w * wSz, (w + 1) * wSz).filter(winFn).length / wSz; if (wr >= wThr) wAbove++; }
    const m4: ModelResult = { name: 'Stability', vote: wAbove >= (tradeType === 'even_odd' ? 3 : 4), score: wAbove / 5 };

    // Model 5 — Recent Edge
    const rSlice100 = digits.slice(-100), rSlice500 = digits.slice(-500);
    const rWin100 = rSlice100.filter(winFn).length / rSlice100.length;
    const rWin500 = rSlice500.filter(winFn).length / rSlice500.length;
    const eThr100 = tradeType === 'even_odd' ? 0.52 : 0.61, eThr500 = tradeType === 'even_odd' ? 0.51 : 0.60;
    const m5Vote  = rWin100 >= eThr100 && rWin500 >= eThr500 && rWin100 >= rWin500 - 0.05;
    const m5: ModelResult = { name: 'Recent Edge', vote: m5Vote, score: Math.min(1, Math.max(0, (Math.min(rWin100, rWin500) - (eThr500 - 0.05)) / 0.15)) };

    const yesCount = [m1.vote, m2.vote, m3.vote, m4.vote, m5.vote].filter(Boolean).length;
    const totalScore = m1.score + m2.score + m3.score + m4.score + m5.score;
    const votes: ModelVotes = { chiSquared: m1, bayesian: m2, momentum: m3, stability: m4, recentEdge: m5, yesCount, totalScore };
    return { sym, direction, contractType, barrier, recoveryBarrier, recoveryContractType, recoveryDirection, winProb, sampleSize: N, votes, entryDigits };
}

// ─── Scan all markets ─────────────────────────────────────────────────────────

async function scanAllMarkets(
    tradeType:   TradeType,
    onProgress:  (received: number) => void,
): Promise<{ best: MarketResult | null; noVotesBest: MarketResult | null; allResults: MarketResult[] }> {
    return new Promise(resolve => {
        const ws = new WebSocket(DERIV_WS);
        const priceMap = new Map<number, { prices: number[]; pip: number; sym: DerivVolatility }>();
        let received = 0, closed = false;

        const finish = () => {
            if (closed) return;
            closed = true;
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            try { ws.close(); } catch { /* */ }
            const results: MarketResult[] = [];
            const minVotes = tradeType === 'over_under' ? MIN_VOTES_OU : MIN_VOTES_EO;
            priceMap.forEach(({ prices, pip, sym }) => { if (prices.length >= 100) results.push(runModels(prices, pip, sym, tradeType)); });
            results.sort((a, b) => b.votes.yesCount - a.votes.yesCount || b.votes.totalScore - a.votes.totalScore || b.winProb - a.winProb);
            const best = results.find(r =>
                r.votes.yesCount >= minVotes &&
                (tradeType !== 'over_under' || r.winProb >= MIN_WIN_PROB_OU)
            ) ?? null;
            resolve({ best, noVotesBest: best ? null : (results[0] ?? null), allResults: results });
        };

        ws.onopen = () => {
            ALL_SYMS.forEach((sym, i) => setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) return;
                ws.send(JSON.stringify({ ticks_history: sym.code, count: TICK_COUNT, end: 'latest', style: 'ticks', req_id: i + 1 }));
            }, i * 80));
        };
        ws.onmessage = (ev: MessageEvent) => {
            let msg: any; try { msg = JSON.parse(ev.data as string); } catch { return; }
            if (msg.msg_type !== 'history') return;
            const reqId = msg.req_id as number; const sym = ALL_SYMS[reqId - 1]; if (!sym) return;
            priceMap.set(reqId, { prices: msg.history?.prices ?? [], pip: msg.pip_size ?? 2, sym });
            onProgress(++received);
            if (received >= ALL_SYMS.length) finish();
        };
        ws.onerror = () => finish();
        ws.onclose = () => { if (!closed) finish(); };
        setTimeout(() => { if (!closed) finish(); }, 30_000);
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recommended ticks based on signal strength */
function calcRecTicks(yesCount: number): number {
    if (yesCount >= 5) return 1;
    if (yesCount >= 4) return 1;
    return 2;
}

/**
 * Recommended max contracts per session.
 * Formula: edge above 50% → 1.5/edge gives a natural session cap.
 * Vote-based ceiling keeps discipline even on high-win signals.
 * Examples: 81% win → ~5, 70% → ~8, 65% → ~10, 62% → ~12, 60% → ~15
 */
function calcRecRuns(yesCount: number, winProb: number): number {
    const edge = Math.max(0.02, winProb - 0.50);
    const raw  = Math.round(1.5 / edge);
    const cap  = yesCount >= 5 ? 8 : yesCount >= 4 ? 12 : 19;
    return Math.max(2, Math.min(cap, raw));
}

const voteColor = (v: number): string =>
    v >= 5 ? '#10b981' : v >= 4 ? '#6366f1' : v >= 3 ? '#f59e0b' : '#ef4444';

const voteLabel = (v: number): string =>
    v >= 5 ? 'STRONG' : v >= 4 ? 'GOOD' : v >= 3 ? 'FAIR' : 'WEAK';

// ─── Bot settings ───────────────────────────────────────────��─────────────────

interface BotCfg { stake: string; takeProfit: string; stopLoss: string; martingale: string; }

const DEFAULT_CFG: BotCfg = { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '2' };

// ─── Component ────────────────────────────────────────────────────────────────

const AiSignalOrb: React.FC = () => {
    const { dashboard, run_panel } = useStore();

    // Draggable orb
    const [dragged,    setDragged]    = useState(false);
    const [orbPos,     setOrbPos]     = useState({ x: 0, y: 0 });
    const dragRef = useRef({ active: false, startX: 0, startY: 0, initX: 0, initY: 0, moved: false });
    const orbRef  = useRef<HTMLDivElement>(null);

    // Panel / scan state
    const [open,       setOpen]       = useState(false);
    const [tradeType,  setTradeType]  = useState<TradeType>('over_under');
    const [scanState,  setScanState]  = useState<ScanState>('idle');
    const [progress,   setProgress]   = useState(0);
    const [result,     setResult]     = useState<MarketResult | null>(null);
    const [allResults, setAllResults] = useState<MarketResult[]>([]);
    const [noSigBest,  setNoSigBest]  = useState<MarketResult | null>(null);
    const [hasSignal,  setHasSignal]  = useState(false);

    // Editable prediction
    const [editDir,    setEditDir]    = useState<'OVER' | 'UNDER' | 'EVEN' | 'ODD'>('OVER');
    const [editBarrier,setEditBarrier]= useState<number>(5);
    const [editRecoveryBarrier, setEditRecoveryBarrier] = useState<number | null>(null);

    // ── TICKS: dedicated number state — no parseInt() fallback needed ──────────
    const [ticksNum,   setTicksNum]   = useState<number>(1);

    // ── Session discipline counter ────────────────────────────────────────────
    const [sessionCount, setSessionCount] = useState<number>(0);

    // Bot settings
    const [cfg,        setCfg]        = useState<BotCfg>(DEFAULT_CFG);
    const [runState,   setRunState]   = useState<RunState>('idle');
    const [errMsg,     setErrMsg]     = useState('');
    const [engineMode, setEngineMode] = useState<'v1' | 'v2'>(() =>
        typeof localStorage !== 'undefined' && localStorage.getItem(ENGINE_KEY) === 'v2' ? 'v2' : 'v1'
    );

    // Sync editable state when result arrives
    useEffect(() => {
        if (!result) return;
        if (tradeType === 'over_under') {
            const parts = result.direction.split(' ');
            setEditDir((parts[0] as 'OVER' | 'UNDER') ?? 'OVER');
            setEditBarrier(result.barrier ?? 5);
            setEditRecoveryBarrier(result.recoveryBarrier);
        } else {
            setEditDir((result.direction as 'EVEN' | 'ODD') ?? 'EVEN');
        }
        // ── KEY FIX: set dedicated number state, zero parsing risk ────────────
        setTicksNum(calcRecTicks(result.votes.yesCount));
        prefetchBotXml(botIdFromSignal({ market: tradeType === 'over_under' ? 'over_under' : 'even_odd', direction: result.direction }));
        setHasSignal(true);
    }, [result, tradeType]);

    // Reset on trade type change
    useEffect(() => {
        setResult(null); setNoSigBest(null); setAllResults([]); setScanState('idle'); setHasSignal(false);
    }, [tradeType]);

    // ── Drag handlers ─────────────────────────────────────────────────────────
    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        const el = orbRef.current; if (!el) return;
        const rect = el.getBoundingClientRect();
        dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, initX: rect.left, initY: rect.top, moved: false };
        el.setPointerCapture(e.pointerId);
    }, []);
    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current.active) return;
        const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY;
        if (!dragRef.current.moved && Math.sqrt(dx * dx + dy * dy) > 5) { dragRef.current.moved = true; setDragged(true); }
        if (dragRef.current.moved) {
            setOrbPos({ x: Math.max(0, Math.min(window.innerWidth - 64, dragRef.current.initX + dx)), y: Math.max(0, Math.min(window.innerHeight - 64, dragRef.current.initY + dy)) });
        }
    }, []);
    const onPointerUp = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current.active) return;
        dragRef.current.active = false;
        if (!dragRef.current.moved) setOpen(p => !p);
        orbRef.current?.releasePointerCapture(e.pointerId);
    }, []);

    // ── Scan ──────────────────────────────────────────────────────────────────
    const handleScan = useCallback(async () => {
        setScanState('scanning'); setProgress(0); setResult(null); setNoSigBest(null);
        setAllResults([]); setHasSignal(false); setRunState('idle'); setSessionCount(0);
        try {
            const { best, noVotesBest, allResults: ar } = await scanAllMarkets(tradeType, n => setProgress(n));
            setAllResults(ar);
            if (best) { setResult(best); setScanState('done'); }
            else      { setNoSigBest(noVotesBest); setScanState('no-signal'); }
        } catch { setScanState('idle'); }
    }, [tradeType]);

    // ── Effective direction from editable state ───────────────────────────────
    const effectiveDirection = () => tradeType === 'even_odd' ? (editDir as string) : `${editDir} ${editBarrier}`;

    const makeBotSignal = (): BotSignal => ({
        symbol:          result?.sym.code ?? '',
        symbolLabel:     result?.sym.label ?? '',
        direction:       effectiveDirection(),
        entryPoint:      `Digit ${result?.entryDigits?.[0]?.digit ?? 0}`,
        confidence:      Math.round((result?.winProb ?? 0.5) * 100),
        market:          tradeType === 'over_under' ? 'over_under' : 'even_odd',
        savedAt:         Date.now(),
        // Over/Under: pass recovery barrier + OPPOSITE contract type to Elite Entry Scanner Bot
        recoveryBarrier:      tradeType === 'over_under' ? (editRecoveryBarrier ?? result?.recoveryBarrier ?? undefined) : undefined,
        contractType:         tradeType === 'over_under' ? (result?.contractType ?? undefined) : undefined,
        recoveryContractType: tradeType === 'over_under' ? (result?.recoveryContractType ?? undefined) : undefined,
    });

    // ── Save & Run ────────────────────────────────────────────────────────────
    async function handleRun() {
        if (!result) return;
        setRunState('launching'); setErrMsg('');
        try {
            const stake      = parseFloat(cfg.stake)      || 0.5;
            const takeProfit = parseFloat(cfg.takeProfit) || 10;
            const stopLoss   = parseFloat(cfg.stopLoss)   || 30;
            const martingale = parseFloat(cfg.martingale) || 2;
            // ── ticksNum is already a clean integer — no parsing needed ────────
            const ticks      = Math.max(1, Math.min(10, ticksNum));

            localStorage.setItem(ENGINE_KEY, engineMode);
            window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_KEY, newValue: engineMode }));

            const signal = makeBotSignal();
            const botId  = botIdFromSignal(signal);

            if (engineMode === 'v2') {
                const martingaleLevel = Math.max(3, Math.min(10, Math.round(stopLoss / stake)));
                let contractKind: string;
                let direction: string | undefined, prediction: number | undefined, barrier: number | undefined;
                if (tradeType === 'even_odd') {
                    direction = (editDir as string).toUpperCase();
                    contractKind = direction === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';
                } else {
                    direction = editDir as string; barrier = editBarrier;
                    contractKind = direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
                }
                const v2Cfg = { symbol: result.sym.code, contractKind, direction, prediction, barrier,
                    entryPoint: result.entryDigits[0]?.digit ?? 0, initialStake: stake, martingale,
                    martingaleLevel, takeProfit, stopLoss, duration: ticks };
                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CFG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CFG_KEY, newValue: v2CfgStr }));
                setSessionCount(p => p + 1);
                // Reset runState BEFORE closing so button is ready next open
                setRunState('idle');
                setOpen(false); setHasSignal(false);
                setTimeout(() => window.dispatchEvent(new CustomEvent('deriv-v2-autostart')), 400);
            } else {
                const doc    = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale, ticks);
                const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);

                // Blockly only mounts on the Bot Builder tab. If the user hit
                // Save & Run from Dashboard / Charts / Tutorials, we must
                // navigate there first and wait for the workspace to appear,
                // otherwise the bot silently fails and the orb shows the
                // yellow "no-workspace" warning. The onboarding-tour auto
                // trigger has been disabled, so this navigation is now safe.
                try { (dashboard as any).setActiveTab?.(DBOT_TABS.BOT_BUILDER); } catch {}
                try { (dashboard as any).setActiveTour?.(''); } catch {}

                // Poll for Blockly.derivWorkspace up to ~5 s (mount + init).
                const waitForWorkspace = async (): Promise<any> => {
                    for (let i = 0; i < 50; i++) {
                        const B = (window as any).Blockly;
                        if (B?.derivWorkspace) return B;
                        await new Promise(r => setTimeout(r, 100));
                    }
                    return null;
                };
                const Blockly = await waitForWorkspace();
                if (!Blockly?.derivWorkspace) {
                    setRunState('no-workspace');
                    setErrMsg('Open the Bot Builder tab and try again.');
                    return;
                }
                const dom = Blockly.utils.xml.textToDom(xmlStr);
                Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
                Blockly.derivWorkspace.cleanUp(); Blockly.derivWorkspace.clearUndo();
                // Open the run-panel drawer and jump to the Transactions tab
                // so the user immediately sees their live trades after Save & Run.
                // run_panel tab indices: 0=Summary, 1=Transactions, 2=Journal.
                try {
                    (run_panel as any).toggleDrawer?.(true);
                    (run_panel as any).setActiveTabIndex?.(1);
                } catch {}
                setSessionCount(p => p + 1);
                setRunState('idle');
                setOpen(false); setHasSignal(false);

                // After clearWorkspaceAndLoadFromXml, Blockly fires async API calls
                // (contracts_for for the new symbol). While those are pending,
                // shouldRunBot() → checkForErroredBlocks() returns false and
                // onRunButtonClick silently aborts with unregisterBotListeners()
                // which destroys the bot.stop handler — making Stop impossible.
                //
                // Fix: call onRunButtonClick() EXACTLY ONCE after a flat 2.5 s
                // wait. This gives Blockly's async validators time to settle so
                // shouldRunBot() passes on the first attempt — no retry cycle,
                // no unregisterAll wipe, bot.stop handler stays intact.
                setTimeout(() => {
                    if (!(run_panel as any).is_running) {
                        try { run_panel.onRunButtonClick(); } catch { /* ignore */ }
                    }
                }, 2500);
            }
        } catch (e: any) { setRunState('error'); setErrMsg(e?.message || 'Failed to load bot.'); }
    }

    // ── Layout helpers ────────────────────────────────────────────────────────
    const orbStyle: React.CSSProperties = dragged
        ? { position: 'fixed', left: orbPos.x, top: orbPos.y, bottom: 'auto', right: 'auto' }
        : { position: 'fixed', right: 24, bottom: 80 };

    const panelStyle: React.CSSProperties = dragged
        ? { position: 'fixed', left: Math.max(8, orbPos.x - 304), top: Math.max(8, orbPos.y - 520), bottom: 'auto' }
        : { position: 'fixed', right: 16, bottom: 156 };

    const vc       = result ? voteColor(result.votes.yesCount) : '#6366f1';
    const recTicks = result ? calcRecTicks(result.votes.yesCount) : 1;
    const recRuns  = result ? calcRecRuns(result.votes.yesCount, result.winProb) : 5;
    const sessionOver = sessionCount >= recRuns;
    const models   = result
        ? [result.votes.chiSquared, result.votes.bayesian, result.votes.momentum, result.votes.stability, result.votes.recentEdge]
        : [];

    return (
        <>
            {/* ── Orb ── */}
            <div ref={orbRef}
                className={`ai-orb${open ? ' ai-orb--open' : ''}${hasSignal && !open ? ' ai-orb--signal' : ''}`}
                style={orbStyle}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            >
                <div className='ai-orb__glow' />
                <div className='ai-orb__btn'>
                    <Zap size={22} className='ai-orb__icon' />
                    <span className='ai-orb__label'>AI</span>
                </div>
                {scanState === 'scanning' && (
                    <div className='ai-orb__prog-ring'>
                        <svg viewBox='0 0 36 36' className='ai-orb__ring-svg'>
                            <circle cx='18' cy='18' r='15' fill='none' stroke='rgba(99,102,241,0.2)' strokeWidth='3' />
                            <circle cx='18' cy='18' r='15' fill='none' stroke='#6366f1' strokeWidth='3'
                                strokeLinecap='round' strokeDasharray={`${(progress / ALL_SYMS.length) * 94} 94`}
                                strokeDashoffset='23.5' transform='rotate(-90 18 18)' />
                        </svg>
                    </div>
                )}
                {hasSignal && !open && <span className='ai-orb__badge' />}
            </div>

            {/* ── Panel ── */}
            {open && (
                <div className='ai-panel' style={panelStyle} onClick={e => e.stopPropagation()}>

                    {/* Header */}
                    <div className='ai-panel__hd'>
                        <div className='ai-panel__hd-left'>
                            <div className='ai-panel__hd-icon'><Zap size={12} /></div>
                            <span className='ai-panel__title'>AI Signals</span>
                        </div>
                        <button className='ai-panel__close' onClick={() => setOpen(false)}><X size={13} /></button>
                    </div>

                    {/* Trade type */}
                    <div className='ai-panel__type-row'>
                        {(['over_under', 'even_odd'] as TradeType[]).map(t => (
                            <button key={t}
                                className={`ai-panel__type-btn${tradeType === t ? ' ai-panel__type-btn--active' : ''}`}
                                onClick={() => setTradeType(t)}
                            >
                                <span className='ai-panel__type-icon'>{t === 'over_under' ? '📈' : '⚖️'}</span>
                                {t === 'over_under' ? 'Over / Under' : 'Even / Odd'}
                            </button>
                        ))}
                    </div>

                    {/* Scan button */}
                    <div className='ai-panel__scan-wrap'>
                        <button
                            className={`ai-panel__scan-btn${scanState === 'scanning' ? ' ai-panel__scan-btn--loading' : ''}`}
                            onClick={handleScan}
                            disabled={scanState === 'scanning'}
                        >
                            {scanState === 'scanning'
                                ? <><Loader2 size={14} className='ai-panel__spin' /><span>Scanning {progress}/{ALL_SYMS.length} markets…</span></>
                                : <><RefreshCw size={14} /><span>{scanState === 'idle' ? 'Scan for Best Markets' : 'Re-Scan Markets'}</span></>
                            }
                        </button>
                    </div>

                    {/* Progress dots */}
                    {scanState === 'scanning' && (
                        <div className='ai-panel__dots'>
                            {ALL_SYMS.map((s, i) => (
                                <span key={s.code}
                                    className={`ai-panel__dot${i < progress ? ' ai-panel__dot--done' : ' ai-panel__dot--wait'}`}
                                    title={s.short}
                                />
                            ))}
                        </div>
                    )}

                    {/* No signal */}
                    {scanState === 'no-signal' && (
                        <div className='ai-panel__nosig'>
                            <div className='ai-panel__nosig-hd'>
                                <span className='ai-panel__nosig-icon'>⚠️</span>
                                <span className='ai-panel__nosig-txt'>No strong signal found</span>
                            </div>
                            {noSigBest && (
                                <div className='ai-panel__nosig-best'>
                                    <span>Best: <strong>{noSigBest.sym.short}</strong></span>
                                    <span className='ai-panel__nosig-votes' style={{ color: voteColor(noSigBest.votes.yesCount) }}>
                                        {noSigBest.votes.yesCount}/5 votes
                                    </span>
                                    <span className='ai-panel__nosig-need'>
                                        (need {tradeType === 'over_under' ? MIN_VOTES_OU : MIN_VOTES_EO}/5)
                                    </span>
                                </div>
                            )}
                            <span className='ai-panel__nosig-hint'>Try again in a few minutes or switch trade type.</span>
                        </div>
                    )}

                    {/* Signal result */}
                    {scanState === 'done' && result && (
                        <div className='ai-panel__result'>

                            {/* Market header */}
                            <div className='ai-panel__mkt' style={{ '--vc': vc } as React.CSSProperties}>
                                <div className='ai-panel__mkt-left'>
                                    <span className='ai-panel__mkt-short'>{result.sym.short}</span>
                                    <span className='ai-panel__mkt-label'>{result.sym.label}</span>
                                    <span className='ai-panel__mkt-samples'>{(result.sampleSize / 1000).toFixed(1)}k ticks</span>
                                </div>
                                <div className='ai-panel__mkt-right'>
                                    <div className='ai-panel__strength-badge' style={{ background: `${vc}22`, borderColor: `${vc}55`, color: vc }}>
                                        <span className='ai-panel__strength-votes'>{result.votes.yesCount}/5</span>
                                        <span className='ai-panel__strength-label'>{voteLabel(result.votes.yesCount)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Win prob bar */}
                            <div className='ai-panel__prob-row'>
                                <span className='ai-panel__prob-lbl'>Win probability</span>
                                <span className='ai-panel__prob-val' style={{ color: vc }}>{(result.winProb * 100).toFixed(1)}%</span>
                            </div>
                            <div className='ai-panel__prob-bar'>
                                <div className='ai-panel__prob-fill' style={{ width: `${result.winProb * 100}%`, background: `linear-gradient(90deg, ${vc}99, ${vc})` }} />
                                <div className='ai-panel__prob-mid' />
                            </div>

                            {/* Session discipline */}
                            <div className={`ai-panel__session${sessionOver ? ' ai-panel__session--over' : ''}`}>
                                <div className='ai-panel__session-top'>
                                    <div className='ai-panel__session-left'>
                                        <span className='ai-panel__session-icon'>🎯</span>
                                        <div>
                                            <span className='ai-panel__session-title'>Session Limit</span>
                                            <span className='ai-panel__session-sub'>Max contracts recommended</span>
                                        </div>
                                    </div>
                                    <div className='ai-panel__session-num' style={{ color: sessionOver ? '#ef4444' : '#10b981' }}>
                                        {recRuns}
                                    </div>
                                </div>

                                {/* Progress bar */}
                                <div className='ai-panel__session-bar-track'>
                                    <div
                                        className='ai-panel__session-bar-fill'
                                        style={{
                                            width: `${Math.min(100, (sessionCount / recRuns) * 100)}%`,
                                            background: sessionOver
                                                ? 'linear-gradient(90deg,#ef444499,#ef4444)'
                                                : sessionCount >= recRuns * 0.75
                                                    ? 'linear-gradient(90deg,#f59e0b99,#f59e0b)'
                                                    : 'linear-gradient(90deg,#10b98199,#10b981)',
                                        }}
                                    />
                                </div>

                                {/* Counter row */}
                                <div className='ai-panel__session-counter'>
                                    <div className='ai-panel__session-tally'>
                                        <button className='ai-panel__session-adj' onClick={() => setSessionCount(p => Math.max(0, p - 1))}>−</button>
                                        <span className='ai-panel__session-count'>
                                            <span style={{ color: sessionOver ? '#ef4444' : '#e2e8f0' }}>{sessionCount}</span>
                                            <span className='ai-panel__session-of'>/ {recRuns}</span>
                                        </span>
                                        <button className='ai-panel__session-adj' onClick={() => setSessionCount(p => p + 1)}>+</button>
                                        <button className='ai-panel__session-reset' onClick={() => setSessionCount(0)} title='Reset counter'>↺</button>
                                    </div>
                                    <span className='ai-panel__session-trades-lbl'>contracts run</span>
                                </div>

                                {/* Warning when at/over limit */}
                                {sessionOver && (
                                    <div className='ai-panel__session-warn'>
                                        🛑 Limit reached — stop trading this session to protect your account
                                    </div>
                                )}
                                {!sessionOver && sessionCount >= Math.ceil(recRuns * 0.75) && (
                                    <div className='ai-panel__session-caution'>
                                        ⚠️ Approaching limit — consider stopping soon
                                    </div>
                                )}
                                {sessionCount === 0 && (
                                    <div className='ai-panel__session-hint'>
                                        Counter auto-increments on each run · adjust manually if needed
                                    </div>
                                )}
                            </div>

                            {/* Model vote breakdown */}
                            <div className='ai-panel__models'>
                                <span className='ai-panel__section-lbl'>Model Consensus</span>
                                <div className='ai-panel__model-chips'>
                                    {models.map(m => (
                                        <div key={m.name} className={`ai-panel__model-chip${m.vote ? ' ai-panel__model-chip--yes' : ' ai-panel__model-chip--no'}`}>
                                            <span className='ai-panel__model-chip-icon'>{m.vote ? '✓' : '✗'}</span>
                                            <span className='ai-panel__model-chip-name'>{m.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Prediction editor */}
                            <div className='ai-panel__pred'>
                                <span className='ai-panel__section-lbl'>Prediction</span>
                                {tradeType === 'even_odd' ? (
                                    <div className='ai-panel__seg'>
                                        {(['EVEN', 'ODD'] as const).map(d => (
                                            <button key={d}
                                                className={`ai-panel__seg-btn${editDir === d ? ' ai-panel__seg-btn--active' : ''}`}
                                                onClick={() => setEditDir(d)}
                                            >{d}</button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className='ai-panel__pred-ou'>
                                        <div className='ai-panel__seg' style={{ marginBottom: 8 }}>
                                            {(['OVER', 'UNDER'] as const).map(d => (
                                                <button key={d}
                                                    className={`ai-panel__seg-btn${editDir === d ? ' ai-panel__seg-btn--active' : ''}`}
                                                    onClick={() => setEditDir(d)}
                                                >{d}</button>
                                            ))}
                                        </div>
                                        <div className='ai-panel__barrier'>
                                            <span className='ai-panel__barrier-lbl'>
                                                Barrier <span className='ai-panel__barrier-rec'>(AI: {result.barrier ?? '?'}★)</span>
                                            </span>
                                            <div className='ai-panel__barrier-grid'>
                                                {[1,2,3,4,5,6,7,8].map(b => (
                                                    <button key={b}
                                                        className={`ai-panel__barrier-btn${editBarrier === b ? ' ai-panel__barrier-btn--sel' : ''}${result.barrier === b ? ' ai-panel__barrier-btn--rec' : ''}`}
                                                        onClick={() => setEditBarrier(b)}
                                                    >{b}</button>
                                                ))}
                                            </div>
                                        </div>
                                        {tradeType === 'over_under' && (
                                            <div className='ai-panel__recovery'>
                                                <div className='ai-panel__recovery-hd'>
                                                    <span className='ai-panel__recovery-icon'>🔄</span>
                                                    <span className='ai-panel__recovery-lbl'>Recovery barrier (after loss)</span>
                                                    {result.recoveryBarrier !== null && (
                                                        <span className='ai-panel__recovery-rec'>
                                                            AI: {result.recoveryDirection ?? (editDir === 'OVER' ? `UNDER ${result.recoveryBarrier}` : `OVER ${result.recoveryBarrier}`)} ★
                                                        </span>
                                                    )}
                                                </div>
                                                <select
                                                    className='ai-panel__recovery-select'
                                                    value={editRecoveryBarrier ?? result.recoveryBarrier ?? ''}
                                                    onChange={e => setEditRecoveryBarrier(Number(e.target.value))}
                                                >
                                                    {editDir === 'OVER'
                                                        ? [8,7,6,5,4,3,2,1].map(v => (
                                                            <option key={v} value={v}>
                                                                UNDER {v}{result.recoveryBarrier === v ? ' ★ Recommended' : ''}
                                                            </option>
                                                        ))
                                                        : [0,1,2,3,4,5,6,7,8].map(v => (
                                                            <option key={v} value={v}>
                                                                OVER {v}{result.recoveryBarrier === v ? ' ★ Recommended' : ''}
                                                            </option>
                                                        ))
                                                    }
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Entry points */}
                            {result.entryDigits.length > 0 && (
                                <div className='ai-panel__entries'>
                                    <span className='ai-panel__section-lbl'>Entry Points (last digit before trade)</span>
                                    <div className='ai-panel__entry-grid'>
                                        {result.entryDigits.slice(0, 2).map((e, i) => (
                                            <div key={e.digit} className={`ai-panel__entry-card${i === 0 ? ' ai-panel__entry-card--rec' : ''}`}>
                                                <div className='ai-panel__entry-digit'>{e.digit}</div>
                                                <div className='ai-panel__entry-meta'>
                                                    <span className='ai-panel__entry-tag'>{i === 0 ? '★ Recommended' : '◎ Alternate'}</span>
                                                    <span className='ai-panel__entry-pct' style={{ color: i === 0 ? '#10b981' : '#94a3b8' }}>
                                                        {(e.conditional * 100).toFixed(1)}%
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Ticks — clickable button grid (no parsing bugs) */}
                            <div className='ai-panel__ticks'>
                                <div className='ai-panel__ticks-hd'>
                                    <span className='ai-panel__section-lbl'>Duration (ticks)</span>
                                    <span className='ai-panel__ticks-rec'>AI recommends: <strong>{recTicks}</strong></span>
                                </div>
                                <div className='ai-panel__ticks-grid'>
                                    {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                        <button key={n}
                                            className={`ai-panel__tick-btn${ticksNum === n ? ' ai-panel__tick-btn--sel' : ''}${n === recTicks ? ' ai-panel__tick-btn--rec' : ''}`}
                                            onClick={() => setTicksNum(n)}
                                        >
                                            {n}
                                            {n === recTicks && <span className='ai-panel__tick-star'>★</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Bot settings */}
                            <div className='ai-panel__settings'>
                                <span className='ai-panel__section-lbl'>Bot Settings</span>
                                <div className='ai-panel__fields'>
                                    {([
                                        { key: 'stake' as const,     label: 'Stake $',      step: '0.01' },
                                        { key: 'takeProfit' as const, label: 'Take Profit $', step: '0.01' },
                                        { key: 'stopLoss' as const,   label: 'Stop Loss $',  step: '0.01' },
                                        { key: 'martingale' as const, label: 'Martingale ×', step: '0.1'  },
                                    ] as { key: keyof BotCfg; label: string; step: string }[]).map(f => (
                                        <div key={f.key} className='ai-panel__field'>
                                            <label className='ai-panel__field-lbl'>{f.label}</label>
                                            <input className='ai-panel__field-inp'
                                                type='number' min='0' step={f.step}
                                                value={cfg[f.key]}
                                                onChange={e => setCfg(p => ({ ...p, [f.key]: e.target.value }))}
                                                disabled={runState === 'launching'}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Engine toggle */}
                            <div className='ai-panel__engine'>
                                <span className='ai-panel__section-lbl'>Execute with</span>
                                <div className='ai-panel__seg ai-panel__seg--sm'>
                                    {(['v1', 'v2'] as const).map(e => (
                                        <button key={e}
                                            className={`ai-panel__seg-btn${engineMode === e ? ' ai-panel__seg-btn--active' : ''}`}
                                            onClick={() => setEngineMode(e)}
                                        >⚙ {e.toUpperCase()}</button>
                                    ))}
                                </div>
                            </div>

                            {/* Warnings */}
                            {runState === 'no-workspace' && (
                                <div className='ai-panel__warn'>
                                    ⚠️ Open the <strong>Bot Builder</strong> tab once to initialise the workspace, then try again.
                                </div>
                            )}
                            {runState === 'error' && (
                                <div className='ai-panel__warn ai-panel__warn--err'>❌ {errMsg}</div>
                            )}

                            {/* Save & Run */}
                            <button className='ai-panel__run-btn' onClick={handleRun} disabled={runState === 'launching'}>
                                {runState === 'launching'
                                    ? <><Loader2 size={14} className='ai-panel__spin' />Launching…</>
                                    : <><Zap size={14} />Save &amp; Run — {ticksNum} tick{ticksNum !== 1 ? 's' : ''}</>
                                }
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default AiSignalOrb;
