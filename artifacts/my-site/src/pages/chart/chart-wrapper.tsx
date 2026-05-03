import React, { useState, useEffect, useRef } from 'react';
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

const TradingViewPanel: React.FC = () => {
    const container_ref = useRef<HTMLDivElement>(null);
    const widget_id = useRef(`tv_widget_${Math.random().toString(36).slice(2)}`);

    useEffect(() => {
        const container = container_ref.current;
        if (!container) return;

        // Clear previous widget if any
        container.innerHTML = '';

        const inner = document.createElement('div');
        inner.id = widget_id.current;
        inner.style.cssText = 'width:100%;height:100%;';
        container.appendChild(inner);

        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        script.onload = () => {
            if (!(window as any).TradingView) return;
            new (window as any).TradingView.widget({
                autosize: true,
                symbol: 'EURUSD',
                interval: '1',
                timezone: 'Etc/UTC',
                theme: 'dark',
                style: '1',
                locale: 'en',
                toolbar_bg: '#131722',
                enable_publishing: false,
                hide_side_toolbar: false,
                allow_symbol_change: true,
                details: true,
                hotlist: false,
                calendar: false,
                container_id: widget_id.current,
            });
        };
        container.appendChild(script);

        return () => {
            if (container) container.innerHTML = '';
        };
    }, []);

    return (
        <div className='chart-wrapper__tradingview'>
            <div className='tv-bar'>
                <span className='tv-bar__title'>
                    <span aria-hidden='true'>📈</span> TradingView Advanced Chart
                </span>
            </div>
            <div className='tv-frame' ref={container_ref} />
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
