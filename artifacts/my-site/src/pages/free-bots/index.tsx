import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import './free-bots.scss';

type BotStatus = 'idle' | 'loading' | 'loaded' | 'error';

type BotConfig = {
    id: string;
    name: string;
    emoji: string;
    description: string;
    market: string;
    strategy: string;
    params: { label: string; value: string }[];
    xmlPath: string;
    gradient: string;
};

const BOTS: BotConfig[] = [
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

const BotCard: React.FC<{ bot: BotConfig }> = observer(({ bot }) => {
    const store = useStore();
    const [status, setStatus] = useState<BotStatus>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const loadBot = async (run: boolean) => {
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

            if (run) {
                setTimeout(() => {
                    const runBtn = document.querySelector<HTMLButtonElement>(
                        '[data-testid="dt_run-panel_run-button"], .run-controls__run-button, button[class*="run"]'
                    );
                    runBtn?.click();
                }, 600);
            }
        } catch (err: any) {
            setStatus('error');
            setErrorMsg(err?.message || 'Failed to load bot.');
        }
    };

    return (
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

                {status === 'error' && (
                    <div className='free-bots__card-error'>{errorMsg}</div>
                )}

                <div className='free-bots__card-actions'>
                    <button
                        className={`free-bots__card-btn free-bots__card-btn--load ${status === 'loading' ? 'free-bots__card-btn--busy' : ''}`}
                        onClick={() => loadBot(false)}
                        disabled={status === 'loading'}
                    >
                        {status === 'loading' ? '⏳ Loading…' : status === 'loaded' ? '✅ Loaded' : '📂 Load Bot'}
                    </button>
                </div>
            </div>
        </div>
    );
});

const FreeBots = observer(() => {
    return (
        <div className='free-bots'>
            <div className='free-bots__header'>
                <h1 className='free-bots__title'>Free Trading Bots</h1>
                <p className='free-bots__subtitle'>
                    Ready-to-use bots — load directly into the Bot Builder and run with one click.
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
