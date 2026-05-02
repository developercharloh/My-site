// ─── XML Bots Section — Speed Bots ────────────────────────────────────────────
// Drop XML bots here by adding entries to XML_SPEED_BOTS.
// Engine mode (V1 / V2) is read automatically from localStorage — no per-bot
// flags needed. When V2 mode is active the bot is loaded into the Blockly
// workspace AND its config is parsed & saved so the bot builder shows
// "⚡ Run V2" instead of the normal Run button.

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { parseXmlV2Config } from '@/utils/xml-v2-parser';

// ── Config ─────────────────────────────────────────────────────────────────────
// Add / remove bots here — that's the only change needed to publish a new bot.

const ENGINE_KEY    = 'free_bots_engine_mode';
const V2_CONFIG_KEY = 'free_bots_v2_config';

export interface XmlBotEntry {
    id:       string;
    name:     string;
    emoji:    string;
    desc:     string;
    strategy: string;
    xmlPath:  string;
    gradient: string;
}

// ▼▼▼  ADD NEW XML BOTS HERE — one object per bot  ▼▼▼
export const XML_SPEED_BOTS: XmlBotEntry[] = [
    {
        id:       'over-under-vh-pro',
        name:     'Over/Under VH Pro',
        emoji:    '🎯',
        strategy: 'Digit Over/Under · Virtual Hook Martingale · Entry Scanner',
        desc:     'Over/Under digit bot with Virtual Hook Martingale recovery. Scans for entry point, then trades OVER or UNDER with smart filter and circuit breaker.',
        xmlPath:  '/bots/Over_Under_Virtual_Hook_Pro.xml',
        gradient: 'linear-gradient(135deg, #1a0a2e 0%, #3b1564 50%, #7c3aed 100%)',
    },
    {
        id:       'over2-under7-reversal',
        name:     'Over 2 / Under 7 Reversal',
        emoji:    '🔄',
        strategy: 'Digit Over/Under · Reversal Pattern · Martingale',
        desc:     'Trades Over 2 when last digit ≤ 2, Under 7 when digit ≥ 7. Martingale recovery on loss with configurable win-count take profit.',
        xmlPath:  '/bots/Over2_Under7_Reversal.xml',
        gradient: 'linear-gradient(135deg, #0f2a3d 0%, #1a4a6b 50%, #2563eb 100%)',
    },
    {
        id:       'volatility-viper',
        name:     'Volatility Viper Bot',
        emoji:    '🐍',
        strategy: 'High-Frequency Digit · Entry Point Scanner',
        desc:     'Fast digit trading bot optimised for high-volatility markets with entry point scanning and rapid re-buy after each settlement.',
        xmlPath:  '/bots/Volatility_Viper_Bot.xml',
        gradient: 'linear-gradient(135deg, #0d2e1a 0%, #1a5c3a 50%, #27ae60 100%)',
    },
    {
        id:       'binary-flipper',
        name:     'Binary Flipper AI',
        emoji:    '🤖',
        strategy: 'AI Digit Prediction · Martingale · TP/SL',
        desc:     'AI-assisted binary digit bot with adaptive prediction and martingale recovery. Stops on Take Profit or Stop Loss.',
        xmlPath:  '/bots/BINARY_FLIPPER_AI_ROBOT_PLUS_+_1765711647660.xml',
        gradient: 'linear-gradient(135deg, #1a1a0a 0%, #3d3d00 50%, #d4ac0d 100%)',
    },
    {
        id:       'even-odd-ai',
        name:     'Even Odd AI Bot',
        emoji:    '⚡',
        strategy: 'Digit Even/Odd · AI Signal · Entry Point',
        desc:     'Even/Odd digit bot with AI signal-based entry. Scans for optimal entry then trades the predicted direction with martingale protection.',
        xmlPath:  '/bots/BINARYTOOL@EVEN&ODD_AI_BOT_(2)_1765711647663.xml',
        gradient: 'linear-gradient(135deg, #0f1f3d 0%, #1a3a6b 50%, #6366f1 100%)',
    },
    {
        id:       'binarytool-wizard',
        name:     'BinaryTool Wizard AI',
        emoji:    '🧙',
        strategy: 'Multi-Digit AI · Entry Point · Martingale',
        desc:     'Advanced wizard bot with multi-layer AI digit prediction. Configurable entry point, stake, martingale and TP/SL guards.',
        xmlPath:  '/bots/BINARYTOOL_WIZARD_AI_BOT_1765711647661.xml',
        gradient: 'linear-gradient(135deg, #2d1a00 0%, #5c3a00 50%, #c27a00 100%)',
    },
    {
        id:       'expert-speed-bot',
        name:     'Expert Speed Bot 2025',
        emoji:    '📉📈',
        strategy: 'High-Speed Digit · Updated 2025 Version',
        desc:     '2025 updated version of the expert speed bot. Optimised for fast execution with improved entry logic and risk management.',
        xmlPath:  '/bots/2_2025_Updated_Expert_Speed_Bot_Version_📉📉📉📈📈📈_1_1_1765711647656.xml',
        gradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3d 50%, #3a3aad 100%)',
    },
    {
        id:       'candle-mine',
        name:     'Candle Mine 2025',
        emoji:    '⛏️',
        strategy: 'Candle Pattern · Digit Trading · Updated 2025',
        desc:     '2025 updated candle mine bot. Uses candle pattern analysis combined with digit prediction for high-accuracy entry signals.',
        xmlPath:  '/bots/3_2025_Updated_Version_Of_Candle_Mine🇬🇧_1765711647657.xml',
        gradient: 'linear-gradient(135deg, #1a0a00 0%, #3d2000 50%, #8b4500 100%)',
    },
    {
        id:       'ai-entry-point',
        name:     'AI Entry Point Bot',
        emoji:    '🧠',
        strategy: 'AI-Driven Entry Point · Digit Prediction',
        desc:     'AI-powered bot that calculates the optimal entry digit dynamically. Adapts its entry point based on recent tick patterns.',
        xmlPath:  '/bots/AI_with_Entry_Point_1765711647658.xml',
        gradient: 'linear-gradient(135deg, #001a1a 0%, #003d3d 50%, #008080 100%)',
    },
    {
        id:       'alpha-ai-two',
        name:     'Alpha AI Two Predictions',
        emoji:    '🔮',
        strategy: 'Dual AI Prediction · Digit Pattern',
        desc:     'Runs two simultaneous AI predictions and enters when both signals align. Reduces false entries with dual-confirmation logic.',
        xmlPath:  '/bots/Alpha_Ai_Two_Predictions__1765711647659.xml',
        gradient: 'linear-gradient(135deg, #1a001a 0%, #3d003d 50%, #8b008b 100%)',
    },
    {
        id:       'alex-speed-bot',
        name:     'ALEX Speed Bot ExPro 2',
        emoji:    '⚡',
        strategy: 'Expert Speed · Digit Over/Under · Martingale',
        desc:     'ALEX ExPro 2 high-frequency bot for digit Over/Under trading with expert-level martingale and smart stop logic.',
        xmlPath:  '/bots/ALEXSPEEDBOT__EXPRO2_(2)_(1)_1765711647659.xml',
        gradient: 'linear-gradient(135deg, #0a1a00 0%, #1f3d00 50%, #4a8700 100%)',
    },
    {
        id:       'auto-c4-volt',
        name:     'Auto C4 Volt Premium AI',
        emoji:    '⚡🤖',
        strategy: 'Premium AI · Auto C4 Logic · Volt Series',
        desc:     'Auto C4 Volt premium AI robot. Automated 4-stage logic with volt-series parameters for consistent digit trading.',
        xmlPath:  '/bots/AUTO_C4_VOLT_🇬🇧_2_🇬🇧_AI_PREMIUM_ROBOT_(2)_(1)_1765711647660.xml',
        gradient: 'linear-gradient(135deg, #1a1a00 0%, #3d3a00 50%, #9b9200 100%)',
    },
];
// ▲▲▲  END OF BOT LIST  ▲▲▲

// ── Component ──────────────────────────────────────────────────────────────────

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

const XmlBotsSection: React.FC = observer(() => {
    const store = useStore();

    const [engineMode, setEngineMode] = useState<'v1' | 'v2'>(() =>
        localStorage.getItem(ENGINE_KEY) === 'v2' ? 'v2' : 'v1'
    );
    const [loadStatus, setLoadStatus] = useState<Record<string, LoadStatus>>({});
    const [errorMsg,   setErrorMsg]   = useState<Record<string, string>>({});

    // Keep in sync with global engine mode changes (header selector or free-bots page)
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === ENGINE_KEY) setEngineMode(e.newValue === 'v2' ? 'v2' : 'v1');
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    const loadBot = async (bot: XmlBotEntry) => {
        if (!store) return;
        setLoadStatus(prev => ({ ...prev, [bot.id]: 'loading' }));
        setErrorMsg(prev => ({ ...prev, [bot.id]: '' }));
        try {
            const res = await fetch(bot.xmlPath);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const xmlText = await res.text();

            const Blockly = (window as any).Blockly;
            if (!Blockly?.utils?.xml?.textToDom || !Blockly?.derivWorkspace) {
                throw new Error('Switch to Bot Builder tab first, then try again.');
            }

            const dom = Blockly.utils.xml.textToDom(xmlText);
            Blockly.Xml.clearWorkspaceAndLoadFromXml(dom, Blockly.derivWorkspace);
            Blockly.derivWorkspace.cleanUp();
            Blockly.derivWorkspace.clearUndo();

            // V2 mode: parse & store config so trade-animation shows ⚡ Run V2
            if (engineMode === 'v2') {
                const v2Cfg    = parseXmlV2Config(xmlText);
                const v2CfgStr = JSON.stringify(v2Cfg);
                localStorage.setItem(V2_CONFIG_KEY, v2CfgStr);
                window.dispatchEvent(new StorageEvent('storage', { key: V2_CONFIG_KEY, newValue: v2CfgStr }));
            }

            setLoadStatus(prev => ({ ...prev, [bot.id]: 'loaded' }));
            store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
        } catch (err: any) {
            setLoadStatus(prev => ({ ...prev, [bot.id]: 'error' }));
            setErrorMsg(prev => ({ ...prev, [bot.id]: err?.message || 'Failed to load.' }));
        }
    };

    return (
        <div className='sb-xml-section'>
            <div className='sb-xml-section__header'>
                <span className='sb-xml-section__title'>📂 XML Bots</span>
                <span className={`sb-xml-section__badge sb-xml-section__badge--${engineMode}`}>
                    {engineMode === 'v2' ? '⚡ V2 Mode' : '⚙️ V1 Mode'}
                </span>
                <span className='sb-xml-section__hint'>
                    {engineMode === 'v2'
                        ? 'Bots load into Bot Builder and run with the V2 engine — all transactions appear in the run panel.'
                        : 'Bots load into the standard DBot Bot Builder. Switch to V2 in the header for faster execution.'}
                </span>
            </div>

            <div className='sb-xml-section__grid'>
                {XML_SPEED_BOTS.map(bot => {
                    const st  = loadStatus[bot.id] ?? 'idle';
                    const err = errorMsg[bot.id];
                    return (
                        <div
                            key={bot.id}
                            className='sb-xml-card'
                            style={{ background: bot.gradient }}
                        >
                            <div className='sb-xml-card__head'>
                                <span className='sb-xml-card__emoji'>{bot.emoji}</span>
                                <div>
                                    <div className='sb-xml-card__name'>{bot.name}</div>
                                    <div className='sb-xml-card__strategy'>{bot.strategy}</div>
                                </div>
                            </div>
                            <p className='sb-xml-card__desc'>{bot.desc}</p>
                            {err && <div className='sb-xml-card__error'>{err}</div>}
                            <button
                                className={`sb-xml-card__btn sb-xml-card__btn--${engineMode} ${st === 'loading' ? 'sb-xml-card__btn--busy' : ''}`}
                                onClick={() => loadBot(bot)}
                                disabled={st === 'loading'}
                            >
                                {st === 'loading' ? '⏳ Loading…'
                                 : st === 'loaded'  ? '✅ Open in Builder'
                                 : engineMode === 'v2' ? '⚡ V2 Load'
                                 : '📂 Load Bot'}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

export default XmlBotsSection;
