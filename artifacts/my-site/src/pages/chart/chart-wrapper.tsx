import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/hooks/useStore';
import Chart from './chart';
import './chart.scss';

interface ChartWrapperProps {
    prefix?:           string;
    show_digits_stats: boolean;
}

type ChartView = 'deriv' | 'tradingview';

// Deriv's official TradingView page — carries every Deriv symbol including
// synthetic Volatility 10/25/50/75/100 (1s & 2s), Boom/Crash, Step, Range Break,
// Jump indices, plus full TradingView drawing tools and 100+ indicators.
const DERIV_TV_URL = 'https://charts.deriv.com/deriv';

const TradingViewPanel: React.FC = () => {
    const [reload_key, setReloadKey] = useState(0);

    return (
        <div className='chart-wrapper__tradingview'>
            <div className='tv-bar'>
                <span className='tv-bar__title'>
                    <span aria-hidden='true'>📈</span> Deriv TradingView
                </span>
                <div className='tv-bar__actions'>
                    <button
                        type='button'
                        className='tv-bar__btn tv-bar__btn--ghost'
                        onClick={() => setReloadKey(k => k + 1)}
                        title='Reload chart'
                    >
                        ⟳ Reload
                    </button>
                </div>
            </div>

            <div className='tv-frame'>
                <iframe
                    key={reload_key}
                    title='Deriv TradingView Charts'
                    src={DERIV_TV_URL}
                    className='tv-iframe'
                    allow='fullscreen; clipboard-read; clipboard-write'
                    loading='lazy'
                />
            </div>
        </div>
    );
};

const ChartWrapper = observer(({ prefix = 'chart', show_digits_stats }: ChartWrapperProps) => {
    const { client }      = useStore();
    const [uuid]          = useState(uuidv4());
    const [view, setView] = useState<ChartView>('deriv');

    const uniqueKey = client.loginid ? `${prefix}-${client.loginid}` : `${prefix}-${uuid}`;

    return (
        <div className='chart-wrapper'>
            <div className='chart-wrapper__toggle'>
                <button
                    type='button'
                    className={`chart-wrapper__toggle-btn ${view === 'deriv' ? 'chart-wrapper__toggle-btn--active' : ''}`}
                    onClick={() => setView('deriv')}
                >
                    📊 Charts
                </button>
                <span className='chart-wrapper__toggle-sep'>/</span>
                <button
                    type='button'
                    className={`chart-wrapper__toggle-btn ${view === 'tradingview' ? 'chart-wrapper__toggle-btn--active' : ''}`}
                    onClick={() => setView('tradingview')}
                >
                    📈 TradingView
                </button>
            </div>

            {view === 'deriv' ? (
                <Chart key={uniqueKey} show_digits_stats={show_digits_stats} />
            ) : (
                <TradingViewPanel />
            )}
        </div>
    );
});

export default ChartWrapper;
