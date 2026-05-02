import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { parseDigitFrom, fetchAndPatchBot, type BotSignal } from '@/utils/bot-patch';
import V2EngineModal from './V2EngineModal';
import type { BotConfig } from './types';
import './free-bots.scss';

// ─── Types ────────────────────────────────────────────────────────────────────

type BotStatus = 'idle' | 'loading' | 'loaded' | 'error';
type EngineMode = 'v1' | 'v2';
type LiveSignal = BotSignal;

interface SignalSettings {
    stake:      string;
    takeProfit: string;
    stopLoss:   string;
    martingale: string;
}

// ─── Signal helpers ───────────────────────────────────────────────────────────

const SIGNAL_TTL = 5 * 60 * 1000;

function readSignal(key: string): LiveSignal | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const sig = JSON.parse(raw) as LiveSignal;
        if (Date.now() - sig.savedAt > SIGNAL_TTL) return null;
        return sig;
    } catch { return null; }
}

function useSignal(key: string | undefined): LiveSignal | null {
    const [signal, setSignal] = useState<LiveSignal | null>(() => key ? readSignal(key) : null);

    useEffect(() => {
        if (!key) return;
        const refresh = () => setSignal(readSignal(key));
        window.addEventListener('fb_signal_update', refresh);
        window.addEventListener('storage', refresh);
        const interval = setInterval(refresh, 15_000);
        return () => {
            window.removeEventListener('fb_signal_update', refresh);
            window.removeEventListener('storage', refresh);
            clearInterval(interval);
        };
    }, [key]);

    return signal;
}

function confColor(conf: number): string {
    return conf >= 70 ? '#10b981' : conf >= 60 ? '#eab308' : '#ef4444';
}

// ─── BOTS config ──────────────────────────────────────────────────────────────

const BOTS: BotConfig[] = [
    {
        id: 'matches-signal',
        name: 'Matches Bot',
        emoji: '🎯',
        description:
            'Trades Digit Matches on Volatility 75 (1s) Index. Scans every tick — enters only when last digit equals entry point 4, then bets the digit matches exactly. Stops after 6 consecutive losses or Take Profit.',
        market: 'Volatility 75 (1s) Index (1HZ75V)',
        strategy: 'Digit Matches · Entry Point Scanner',
        params: [
            { label: 'Entry Point', value: 'Digit 4' },
            { label: 'Prediction', value: 'Digit 4' },
            { label: 'Stake', value: '$10' },
            { label: 'Take Profit', value: '$15' },
            { label: 'Max Losses', value: '6' },
        ],
        xmlPath: '/bots/Matches_Signal_Bot.xml',
        gradient: 'linear-gradient(135deg, #1a0533 0%, #3b0764 50%, #7c3aed 100%)',
        signalKey: 'fb_signal_matches',
        v2Enabled: true,
    },
    {
        id: 'differ-v2',
        name: 'Differ V2 Bot',
        emoji: '🔀',
        description:
            'Trades Digit Differs on Volatility 100 Index. Waits for entry point digit 9, then bets the last digit will NOT be 9. Martingale recovery on losses with Take Profit and Stop Loss.',
        market: 'Volatility 100 Index (R_100)',
        strategy: 'Digit Differs · Martingale · Entry Point',
        params: [
            { label: 'Stake', value: '$1' },
            { label: 'Take Profit', value: '$1' },
            { label: 'Stop Loss', value: '$10' },
            { label: 'Martingale', value: '2.5×' },
            { label: 'Entry / Prediction', value: 'Digit 9' },
        ],
        xmlPath: '/bots/BINARYTOOL@_DIFFER_V2.0_(1)_(1)_1765711647662.xml',
        gradient: 'linear-gradient(135deg, #0c1a33 0%, #1e3a5f 50%, #2563eb 100%)',
        signalKey: 'fb_signal_differs',
        v2Enabled: true,
    },
    {
        id: 'even-odd-scanner',
        name: 'Even Odd Entry Scanner Bot',
        emoji: '⚡',
        description:
            'Trades Digit Even/Odd on Volatility 100 Index. Scans every tick — enters only when last digit matches the signal entry point, then buys the direction (EVEN or ODD) from the signal. 10-level martingale recovery on losses.',
        market: 'Volatility 100 Index (R_100)',
        strategy: 'Digit Even / Odd · Signal Direction · Entry Point Scanner',
        params: [
            { label: 'Entry Point', value: 'Digit 0' },
            { label: 'Stake', value: '$0.55' },
            { label: 'Target Profit', value: '$10' },
            { label: 'Max Loss', value: '$100' },
        ],
        xmlPath: '/bots/BINARYTOOL@EVEN_ODD_THUNDER_AI_PRO_BOT_1765711647662.xml',
        gradient: 'linear-gradient(135deg, #1a1a0a 0%, #3d3d00 50%, #d4ac0d 100%)',
        signalKey: 'fb_signal_even_odd',
        v2Enabled: true,
    },
    {
        id: 'over-under-signal',
        name: 'Over Under Bot',
        emoji: '📊',
        description:
            'Trades Digit Over/Under using live signal intelligence. Scans every tick — enters only when the last digit equals the signal barrier, then bets OVER or UNDER exactly as the signal directs. Martingale recovery on losses with Take Profit guard.',
        market: 'Signal-driven (any Volatility Index)',
        strategy: 'Digit Over / Under · Signal Direction · Entry Point Scanner',
        params: [
            { label: 'Entry Point', value: 'Barrier digit' },
            { label: 'Direction', value: 'OVER / UNDER (from signal)' },
            { label: 'Stake', value: '$0.5' },
            { label: 'Take Profit', value: '$10' },
            { label: 'Max Losses', value: '6' },
        ],
        xmlPath: '/bots/OverUnder_Signal_Bot.xml',
        gradient: 'linear-gradient(135deg, #0f1f3d 0%, #1a3a6b 50%, #6366f1 100%)',
        signalKey: 'fb_signal_over_under',
        v2Enabled: true,
    },
    {
        id: 'over-destroyer',
        name: 'Over Destroyer Bot',
        emoji: '📈📉',
        description:
            'Trades Digit Over/Under on Volatility 50 Index. Alternates between Over and Under predictions with a Martingale recovery on losses. Stops automatically on Take Profit or Stop Loss.',
        market: 'Volatility 50 Index (1HZ50V)',
        strategy: 'Digit Over / Under · Martingale',
        params: [
            { label: 'Initial Stake', value: '$5.97' },
            { label: 'Take Profit', value: '$50' },
            { label: 'Stop Loss', value: '$15' },
            { label: 'Martingale', value: '1.5×' },
            { label: 'Over Prediction', value: '1' },
            { label: 'Under Prediction', value: '6' },
        ],
        xmlPath: '/bots/Over_Destroyer_Bot.xml',
        gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    },
    {
        id: 'under-destroyer',
        name: 'Under Destroyer Bot',
        emoji: '📈📉',
        description:
            'Trades Digit Over/Under on Volatility 50 Index. Opens Under on first trade, then switches to Over on a loss (Martingale recovery). Aggressive stop-loss protects the balance.',
        market: 'Volatility 50 Index (1HZ50V)',
        strategy: 'Digit Under / Over · Martingale',
        params: [
            { label: 'Initial Stake', value: '$2.97' },
            { label: 'Take Profit', value: '$5' },
            { label: 'Stop Loss', value: '$45' },
            { label: 'Martingale', value: '1.5×' },
            { label: 'Under Prediction', value: '8' },
            { label: 'Over Prediction', value: '4' },
        ],
        xmlPath: '/bots/Under_Destroyer_Bot.xml',
        gradient: 'linear-gradient(135deg, #0d3b2e 0%, #1a5c42 50%, #27ae60 100%)',
    },
];

// ─── Engine selector dropdown ─────────────────────────────────────────────────

const ENGINE_KEY = 'free_bots_engine_mode';

const EngineSelector: React.FC<{
    mode:    EngineMode;
    onChange: (m: EngineMode) => void;
}> = ({ mode, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const labels: Record<EngineMode, string> = {
        v1: '⚙️ Classic V1',
        v2: '⚡ Advanced V2',
    };

    return (
        <div className='fb-engine-selector' ref={ref}>
            <button
                className={`fb-engine-selector__btn fb-engine-selector__btn--${mode}`}
                onClick={() => setOpen(p => !p)}
            >
                <span>{labels[mode]}</span>
                <span className='fb-engine-selector__arrow'>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className='fb-engine-selector__dropdown'>
                    <button
                        className={`fb-engine-selector__option ${mode === 'v1' ? 'fb-engine-selector__option--active' : ''}`}
                        onClick={() => { onChange('v1'); setOpen(false); }}
                    >
                        <div className='fb-engine-selector__opt-title'>⚙️ Classic V1 — DBot</div>
                        <div className='fb-engine-selector__opt-desc'>Loads bot into Deriv's standard DBot engine</div>
                    </button>
                    <button
                        className={`fb-engine-selector__option ${mode === 'v2' ? 'fb-engine-selector__option--active' : ''}`}
                        onClick={() => { onChange('v2'); setOpen(false); }}
                    >
                        <div className='fb-engine-selector__opt-title'>⚡ Advanced V2 — Direct</div>
                        <div className='fb-engine-selector__opt-desc'>Connects directly to Deriv API — zero-overhead execution</div>
                    </button>
                </div>
            )}
        </div>
    );
};

// ─── Signal Trade Modal ───────────────────────────────────────────────────────

const SignalTradeModal: React.FC<{
    botId:   string;
    xmlPath: string;
    signal:  LiveSignal;
    onClose: () => void;
}> = ({ botId, xmlPath, signal, onClose }) => {
    const store      = useStore();
    const storageKey = `fb_cfg_${botId}`;

    const [cfg, setCfg] = useState<SignalSettings>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) return JSON.parse(raw) as SignalSettings;
        } catch { /* ignore */ }
        return { stake: '0.5', takeProfit: '10', stopLoss: '30', martingale: '2' };
    });

    const [state,  setState]  = useState<'idle' | 'launching' | 'no-ws' | 'error'>('idle');
    const [errMsg, setErrMsg] = useState('');

    async function handleRun() {
        localStorage.setItem(storageKey, JSON.stringify(cfg));
        setState('launching');
        setErrMsg('');
        try {
            const Blockly = (window as any).Blockly;
            if (!Blockly?.derivWorkspace) { setState('no-ws'); return; }

            const stake      = parseFloat(cfg.stake)      || 0.5;
            const takeProfit = parseFloat(cfg.takeProfit) || 10;
            const stopLoss   = parseFloat(cfg.stopLoss)   || 30;
            const martingale = parseFloat(cfg.martingale) || 2;

            const doc    = await fetchAndPatchBot(botId, signal, stake, takeProfit, stopLoss, martingale);
            const xmlStr = new XMLSerializer().serializeToString(doc.documentElement);
            const dom    = Blockly.utils.xml.textToDom(xmlStr);

            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            onClose();

            setTimeout(() => {
                if (!store.run_panel.is_running) store.run_panel.onRunButtonClick();
            }, 500);
        } catch (e: any) {
            setState('error');
            setErrMsg(e?.message || 'Failed to launch bot.');
        }
    }

    const cc = confColor(signal.confidence);
    const injectedSymbol = signal.symbolLabel.replace('Volatility ', 'V').replace(' Index', '').replace(' (1s)', 's');
    const injectedDigit  = botId === 'even-odd-scanner'
        ? parseDigitFrom(signal.entryPoint)
        : parseDigitFrom(signal.direction);

    return (
        <div className='fb-modal-overlay' onClick={onClose}>
            <div className='fb-modal' onClick={e => e.stopPropagation()}>
                <div className='fb-modal__header'>
                    <div className='fb-modal__signal-info'>
                        <span className='fb-modal__direction'>{signal.direction}</span>
                        <span className='fb-modal__sym'>{signal.symbolLabel}</span>
                        <span className='fb-modal__entry'>{signal.entryPoint}</span>
                        <span className='fb-modal__conf' style={{ color: cc }}>{signal.confidence}% confidence</span>
                    </div>
                    <button className='fb-modal__close' onClick={onClose}>✕</button>
                </div>

                <div className='fb-modal__wire-summary'>
                    <span className='fb-modal__wire-item'>📡 Market: <strong>{injectedSymbol}</strong></span>
                    <span className='fb-modal__wire-item'>🎯 Entry: <strong>Digit {injectedDigit}</strong></span>
                    <span className='fb-modal__wire-item'>⬇️ Will scan ticks until entry digit appears, then trade</span>
                </div>

                <div className='fb-modal__fields'>
                    {([
                        { label: 'Stake ($)',       key: 'stake'      as const, step: '0.01' },
                        { label: 'Take Profit ($)', key: 'takeProfit' as const, step: '0.5'  },
                        { label: 'Stop Loss ($)',   key: 'stopLoss'   as const, step: '0.5'  },
                        { label: 'Martingale (×)',  key: 'martingale' as const, step: '0.1'  },
                    ]).map(f => (
                        <div key={f.key} className='fb-modal__field'>
                            <label>{f.label}</label>
                            <input
                                type='number' step={f.step} min='0'
                                value={cfg[f.key]}
                                onChange={e => setCfg(c => ({ ...c, [f.key]: e.target.value }))}
                                disabled={state === 'launching'}
                            />
                        </div>
                    ))}
                </div>

                {state === 'no-ws' && (
                    <div className='fb-modal__warn'>
                        ⚠️ Open the <strong>Bot Builder</strong> tab once to initialise the workspace, then try again.
                        <button onClick={() => setState('idle')}>OK</button>
                    </div>
                )}
                {state === 'error' && (
                    <div className='fb-modal__error'>{errMsg} <button onClick={() => setState('idle')}>Retry</button></div>
                )}

                <div className='fb-modal__footer'>
                    <button className='fb-modal__btn fb-modal__btn--cancel' onClick={onClose} disabled={state === 'launching'}>Cancel</button>
                    <button className='fb-modal__btn fb-modal__btn--run' onClick={handleRun} disabled={state === 'launching'}>
                        {state === 'launching' ? '⏳ Launching…' : '🚀 Load Signal & Run'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Signal Badge ─────────────────────────────────────────────────────────────

const SignalBadge: React.FC<{ signal: LiveSignal; onClick: () => void }> = ({ signal, onClick }) => {
    const cc = confColor(signal.confidence);
    return (
        <div className='fb-signal-badge' onClick={onClick} title='Live signal — click to wire it to this bot'>
            <span className='fb-signal-badge__dot' style={{ background: cc }} />
            <span className='fb-signal-badge__dir'>{signal.direction}</span>
            <span className='fb-signal-badge__sym'>{signal.symbolLabel.replace('Volatility ', 'V').replace(' Index', '')}</span>
            <span className='fb-signal-badge__conf' style={{ color: cc }}>{signal.confidence}%</span>
            <span className='fb-signal-badge__cta'>Load Signal →</span>
        </div>
    );
};

// ─── Bot Card ─────────────────────────────────────────────────────────────────

const BotCard: React.FC<{ bot: BotConfig; engineMode: EngineMode }> = observer(({ bot, engineMode }) => {
    const store = useStore();
    const [status,     setStatus]     = useState<BotStatus>('idle');
    const [errorMsg,   setErrorMsg]   = useState('');
    const [showSignal, setShowSignal] = useState(false);
    const [showV2,     setShowV2]     = useState(false);

    const signal = useSignal(bot.signalKey);

    const loadBot = async () => {
        if (!store) return;
        const { dashboard } = store;
        setStatus('loading');
        setErrorMsg('');
        try {
            const res = await fetch(bot.xmlPath);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const xmlText = await res.text();

            const Blockly = (window as any).Blockly;
            if (!Blockly?.utils?.xml?.textToDom || !Blockly?.derivWorkspace) {
                throw new Error('Blockly workspace not ready — switch to Bot Builder tab first, then try again.');
            }

            const dom = Blockly.utils.xml.textToDom(xmlText);
            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            setStatus('loaded');
            dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
        } catch (err: any) {
            setStatus('error');
            setErrorMsg(err?.message || 'Failed to load bot.');
        }
    };

    const isV2Mode = engineMode === 'v2' && bot.v2Enabled;

    return (
        <>
            <div className='free-bots__card'>
                <div className='free-bots__card-header' style={{ background: bot.gradient }}>
                    <span className='free-bots__card-emoji'>{bot.emoji}</span>
                    <div className='free-bots__card-header-text'>
                        <h2 className='free-bots__card-name'>{bot.name}</h2>
                        <span className='free-bots__card-strategy'>{bot.strategy}</span>
                    </div>
                </div>

                <div className='free-bots__card-body'>
                    <p className='free-bots__card-desc'>{bot.description}</p>

                    {signal && (
                        <SignalBadge signal={signal} onClick={() => setShowSignal(true)} />
                    )}

                    {status === 'error' && (
                        <div className='free-bots__card-error'>{errorMsg}</div>
                    )}

                    <div className='free-bots__card-actions'>
                        {/* V1 mode: show normal Load Bot button */}
                        {!isV2Mode && (
                            <button
                                className={`free-bots__card-btn free-bots__card-btn--load ${status === 'loading' ? 'free-bots__card-btn--busy' : ''}`}
                                onClick={loadBot}
                                disabled={status === 'loading'}
                            >
                                {status === 'loading' ? '⏳ Loading…' : status === 'loaded' ? '✅ Loaded' : '📂 Load Bot'}
                            </button>
                        )}

                        {/* V2 mode: show V2 launch button (or "coming soon" for unsupported bots) */}
                        {engineMode === 'v2' && (
                            bot.v2Enabled ? (
                                <button
                                    className='free-bots__card-btn free-bots__card-btn--v2'
                                    onClick={() => setShowV2(true)}
                                >
                                    ⚡ V2 Launch
                                </button>
                            ) : (
                                <button className='free-bots__card-btn free-bots__card-btn--v2soon' disabled>
                                    ⚡ V2 Coming Soon
                                </button>
                            )
                        )}

                        {signal && !isV2Mode && (
                            <button
                                className='free-bots__card-btn free-bots__card-btn--signal'
                                onClick={() => setShowSignal(true)}
                            >
                                ⚡ Trade Signal
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Signal modal (V1 only) */}
            {showSignal && signal && (
                <SignalTradeModal
                    botId={bot.id}
                    xmlPath={bot.xmlPath}
                    signal={signal}
                    onClose={() => setShowSignal(false)}
                />
            )}

            {/* V2 engine modal */}
            {showV2 && (
                <V2EngineModal
                    bot={bot}
                    onClose={() => setShowV2(false)}
                />
            )}
        </>
    );
});

// ─── Page ─────────────────────────────────────────────────────────────────────

const FreeBots = observer(() => {
    const [engineMode, setEngineMode] = useState<EngineMode>(() => {
        try { return (localStorage.getItem(ENGINE_KEY) as EngineMode) || 'v1'; } catch { return 'v1'; }
    });

    // Sync with header engine selector via storage events
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === ENGINE_KEY && (e.newValue === 'v1' || e.newValue === 'v2')) {
                setEngineMode(e.newValue as EngineMode);
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    const handleModeChange = (m: EngineMode) => {
        setEngineMode(m);
        try { localStorage.setItem(ENGINE_KEY, m); } catch { /* ignore */ }
        window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_KEY, newValue: m }));
    };

    return (
        <div className='free-bots'>
            <div className='free-bots__header'>
                <div className='free-bots__header-top'>
                    <div className='free-bots__header-text'>
                        <h1 className='free-bots__title'>Free Trading Bots</h1>
                        <p className='free-bots__subtitle'>
                            Ready-to-use bots — load into Bot Builder, or tap <strong>Trade Signal</strong> to wire a live signal and run instantly.
                        </p>
                    </div>
                    <EngineSelector mode={engineMode} onChange={handleModeChange} />
                </div>

                {engineMode === 'v2' && (
                    <div className='free-bots__v2-banner'>
                        <span className='free-bots__v2-banner-icon'>⚡</span>
                        <div>
                            <strong>Advanced V2 Engine active</strong> — bots connect directly to Deriv's WebSocket API.
                            Re-buys fire the instant each contract settles, with zero DBot overhead.
                            You'll need a Deriv API token to run.
                        </div>
                    </div>
                )}
            </div>

            <div className='free-bots__grid'>
                {BOTS.map(bot => (
                    <BotCard key={bot.id} bot={bot} engineMode={engineMode} />
                ))}
            </div>

            <div className='free-bots__footer'>
                <p>All bots are provided for educational purposes. Always test with a demo account first.</p>
            </div>
        </div>
    );
});

export default FreeBots;
