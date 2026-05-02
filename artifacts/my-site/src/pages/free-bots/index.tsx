import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './free-bots.scss';

// ─── Types ────────────────────────────────────────────────────────────────────

type BotStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface LiveSignal {
    symbol:      string;
    symbolLabel: string;
    direction:   string;
    entryPoint:  string;
    confidence:  number;
    market:      string;
    savedAt:     number;
}

interface SignalSettings {
    stake:      string;
    takeProfit: string;
    stopLoss:   string;
    martingale: string;
}

type BotConfig = {
    id:          string;
    name:        string;
    emoji:       string;
    description: string;
    market:      string;
    strategy:    string;
    params:      { label: string; value: string }[];
    xmlPath:     string;
    gradient:    string;
    signalKey?:  string;
};

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

function parseDigitFrom(str: string): number {
    const m = str.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
}

function confColor(conf: number): string {
    return conf >= 70 ? '#10b981' : conf >= 60 ? '#eab308' : '#ef4444';
}

// ─── XML Patching ─────────────────────────────────────────────────────────────
// Walks the bot XML by block ID and updates math_number values in-place.

interface BlockPatch {
    blockId:   string;
    numValue?: number;   // patches math_number → field[NUM]
    textValue?: string;  // patches text        → field[TEXT]
}

function patchBotXml(
    xmlText: string,
    symbol:  string,
    patches: BlockPatch[],
): Document {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, 'text/xml');

    // 1. Patch SYMBOL_LIST (first match = market block)
    const allFields = doc.getElementsByTagName('field');
    for (let i = 0; i < allFields.length; i++) {
        if (allFields[i].getAttribute('name') === 'SYMBOL_LIST') {
            allFields[i].textContent = symbol;
            break;
        }
    }

    // 2. Patch initialisation blocks by variables_set block ID
    const allBlocks = doc.getElementsByTagName('block');
    for (let i = 0; i < allBlocks.length; i++) {
        const block = allBlocks[i];
        const bid   = block.getAttribute('id') ?? '';
        const patch = patches.find(p => p.blockId === bid);
        if (!patch) continue;

        // Descend: variables_set → value[name=VALUE] → (math_number|text) → field
        const children = block.childNodes;
        for (let j = 0; j < children.length; j++) {
            const node = children[j] as Element;
            if (node.nodeType !== 1) continue;
            if (node.getAttribute('name') !== 'VALUE') continue;

            const innerBlocks = node.getElementsByTagName('block');
            for (let k = 0; k < innerBlocks.length; k++) {
                const btype = innerBlocks[k].getAttribute('type');

                if (btype === 'math_number' && patch.numValue !== undefined) {
                    const numFields = innerBlocks[k].getElementsByTagName('field');
                    for (let m = 0; m < numFields.length; m++) {
                        if (numFields[m].getAttribute('name') === 'NUM') {
                            numFields[m].textContent = String(patch.numValue);
                        }
                    }
                    break;
                }

                if (btype === 'text' && patch.textValue !== undefined) {
                    const txtFields = innerBlocks[k].getElementsByTagName('field');
                    for (let m = 0; m < txtFields.length; m++) {
                        if (txtFields[m].getAttribute('name') === 'TEXT') {
                            txtFields[m].textContent = patch.textValue;
                        }
                    }
                    break;
                }
            }
            break;
        }
    }

    return doc;
}

// ─── Per-bot patch maps ───────────────────────────────────────────────────────
// Block IDs sourced directly from each bot's INITIALIZATION chain.

function getBotPatches(
    botId:       string,
    signal:      LiveSignal,
    stake:       number,
    takeProfit:  number,
    stopLoss:    number,
    martingale:  number,
): BlockPatch[] {
    const digit = parseDigitFrom(signal.direction);   // prediction / entry
    const entry = parseDigitFrom(signal.entryPoint);  // only Even Odd uses entryPoint separately
    const martingaleLevel = Math.max(3, Math.min(10, Math.round(stopLoss / stake)));

    switch (botId) {
        case 'matches-signal':
            return [
                { blockId: '!BDtc{tIb5~vb#O@Ogky', numValue: digit },           // Prediction
                { blockId: 'Dww98I}prRuVxr_mn~}k',  numValue: stake },           // Stake
                { blockId: 'P@g)b:jeg|/F)mD8%X,w',  numValue: stake },           // InitialStake
                { blockId: 't0b1vxY9xaXc@*IwT7C{',  numValue: takeProfit },      // TakeProfit
                { blockId: 'tuMdgDH=EiDY~j.b%n;]',  numValue: martingaleLevel }, // MartingaleLevel
                { blockId: 'zHWiC2`O-~qH2R`7]FaG',  numValue: martingale },      // Martingale
                { blockId: 'ep_matches_init',         numValue: digit },           // entry point
            ];

        case 'differ-v2':
            return [
                { blockId: '%,Z?it?u3w,4)WTx2Hq:',  numValue: stake },      // stake
                { blockId: '/a.5Q3QDR2c)VR/XZvD-',  numValue: digit },      // entry point
                { blockId: 'ij(6Iu2cn[H}M;H3Y%9[',  numValue: digit },      // prediction
                { blockId: 's;EQ~zMi)cPYPc-kzha`',  numValue: martingale }, // martingale
                { blockId: ';N@3iS.2#]xK[5,E{gCO',  numValue: takeProfit }, // take profit
                { blockId: 'h~GA!H78SVi}._e5N:ur',   numValue: stopLoss },  // stop loss
            ];

        case 'even-odd-scanner':
            return [
                { blockId: 'eo_dir_init',             textValue: signal.direction.trim().toUpperCase() }, // Direction: EVEN or ODD
                { blockId: 'Wa]y_n3s-T4*h(bmYz+k',  numValue: stake },      // Stake
                { blockId: 'Z:R@MLC*=N3%meT)IuPt',   numValue: stopLoss },  // Max Loss
                { blockId: ':Vn+w]Y.(QKzgKKENIfo',   numValue: takeProfit }, // Target Profit
                { blockId: 'eo_ep_init_fixed',         numValue: entry },     // entry point
            ];

        default:
            return [];
    }
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
            if (!Blockly?.derivWorkspace) {
                setState('no-ws');
                return;
            }

            const stake      = parseFloat(cfg.stake)      || 0.5;
            const takeProfit = parseFloat(cfg.takeProfit) || 10;
            const stopLoss   = parseFloat(cfg.stopLoss)   || 30;
            const martingale = parseFloat(cfg.martingale) || 2;

            // Fetch the real static bot XML
            const res = await fetch(xmlPath);
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching bot XML.`);
            const rawXml = await res.text();

            // Patch symbol + all financial parameters directly in the DOM
            const patches = getBotPatches(botId, signal, stake, takeProfit, stopLoss, martingale);
            const doc     = patchBotXml(rawXml, signal.symbol, patches);

            if (doc.querySelector('parsererror')) throw new Error('Bot XML parse error — check the bot file.');

            Blockly.Xml.clearWorkspaceAndLoadFromXml(doc.documentElement, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            onClose();

            // Auto-click the Run button once the workspace has settled
            setTimeout(() => {
                const runBtn = document.querySelector<HTMLButtonElement>(
                    '#db-animation__run-button, [data-testid="dt_run-panel_run-button"], .run-controls__run-button, button[class*="run"]'
                );
                runBtn?.click();
            }, 700);
        } catch (e: any) {
            setState('error');
            setErrMsg(e?.message || 'Failed to launch bot.');
        }
    }

    const cc = confColor(signal.confidence);

    // Derive display labels for what will be injected
    const injectedSymbol = signal.symbolLabel
        .replace('Volatility ', 'V').replace(' Index', '').replace(' (1s)', 's');
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
                        <span className='fb-modal__conf' style={{ color: cc }}>
                            {signal.confidence}% confidence
                        </span>
                    </div>
                    <button className='fb-modal__close' onClick={onClose}>✕</button>
                </div>

                {/* Wire summary — what the bot will actually receive */}
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
                    <button className='fb-modal__btn fb-modal__btn--cancel' onClick={onClose} disabled={state === 'launching'}>
                        Cancel
                    </button>
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

const BotCard: React.FC<{ bot: BotConfig }> = observer(({ bot }) => {
    const store = useStore();
    const [status,    setStatus]    = useState<BotStatus>('idle');
    const [errorMsg,  setErrorMsg]  = useState('');
    const [showModal, setShowModal] = useState(false);

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
                        <SignalBadge signal={signal} onClick={() => setShowModal(true)} />
                    )}

                    {status === 'error' && (
                        <div className='free-bots__card-error'>{errorMsg}</div>
                    )}

                    <div className='free-bots__card-actions'>
                        <button
                            className={`free-bots__card-btn free-bots__card-btn--load ${status === 'loading' ? 'free-bots__card-btn--busy' : ''}`}
                            onClick={loadBot}
                            disabled={status === 'loading'}
                        >
                            {status === 'loading' ? '⏳ Loading…' : status === 'loaded' ? '✅ Loaded' : '📂 Load Bot'}
                        </button>

                        {signal && (
                            <button
                                className='free-bots__card-btn free-bots__card-btn--signal'
                                onClick={() => setShowModal(true)}
                            >
                                ⚡ Trade Signal
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {showModal && signal && (
                <SignalTradeModal
                    botId={bot.id}
                    xmlPath={bot.xmlPath}
                    signal={signal}
                    onClose={() => setShowModal(false)}
                />
            )}
        </>
    );
});

// ─── Page ─────────────────────────────────────────────────────────────────────

const FreeBots = observer(() => {
    return (
        <div className='free-bots'>
            <div className='free-bots__header'>
                <h1 className='free-bots__title'>Free Trading Bots</h1>
                <p className='free-bots__subtitle'>
                    Ready-to-use bots — load directly into the Bot Builder, or tap <strong>Trade Signal</strong> to wire a live signal into the bot and run it instantly.
                </p>
            </div>

            <div className='free-bots__grid'>
                {BOTS.map(bot => (
                    <BotCard key={bot.id} bot={bot} />
                ))}
            </div>

            <div className='free-bots__footer'>
                <p>All bots are provided for educational purposes. Always test with a demo account first.</p>
            </div>
        </div>
    );
});

export default FreeBots;
