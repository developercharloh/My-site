import React, { lazy, Suspense, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/hooks/useStore';
import Chart from './chart';
import './chart.scss';

const DerivCandleChart = lazy(() => import('./deriv-candle-chart'));

interface ChartWrapperProps {
    prefix?:           string;
    show_digits_stats: boolean;
}

type ChartView = 'deriv' | 'candle';

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
                    📊 SmartCharts
                </button>
                <span className='chart-wrapper__toggle-sep'>/</span>
                <button
                    type='button'
                    className={`chart-wrapper__toggle-btn ${view === 'candle' ? 'chart-wrapper__toggle-btn--active' : ''}`}
                    onClick={() => setView('candle')}
                >
                    🕯 Candlestick
                </button>
            </div>

            {view === 'deriv' ? (
                <Chart key={uniqueKey} show_digits_stats={show_digits_stats} />
            ) : (
                <div className='chart-wrapper__candle'>
                    <Suspense fallback={
                        <div className='chart-wrapper__candle-loading'>
                            <span>Loading chart…</span>
                        </div>
                    }>
                        <DerivCandleChart />
                    </Suspense>
                </div>
            )}
        </div>
    );
});

export default ChartWrapper;
