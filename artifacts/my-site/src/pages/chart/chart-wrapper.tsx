import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/hooks/useStore';
import Chart from './chart';
import './chart.scss';

interface ChartWrapperProps {
    prefix?: string;
    show_digits_stats: boolean;
}

type ChartView = 'deriv' | 'tradingview';

const TRADINGVIEW_URL = 'https://charts.deriv.com';

const ChartWrapper = observer(({ prefix = 'chart', show_digits_stats }: ChartWrapperProps) => {
    const { client } = useStore();
    const [uuid] = useState(uuidv4());
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
                <div className='chart-wrapper__tradingview'>
                    <iframe
                        title='Deriv TradingView Charts'
                        src={TRADINGVIEW_URL}
                        className='chart-wrapper__tradingview-frame'
                        allow='fullscreen; clipboard-read; clipboard-write'
                        loading='lazy'
                    />
                </div>
            )}
        </div>
    );
});

export default ChartWrapper;
