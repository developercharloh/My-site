import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/hooks/useStore';
import Chart from './chart';
import {
    DERIV_CONTINUOUS_VOLATILITIES,
    DERIV_STANDARD_VOLATILITIES,
} from '@/utils/deriv-volatilities';
import './chart.scss';

interface ChartWrapperProps {
    prefix?:           string;
    show_digits_stats: boolean;
}

type ChartView = 'deriv' | 'tradingview';

const TV_SYMBOL_GROUPS = [
    { label: 'Continuous (1s) Indices', items: DERIV_CONTINUOUS_VOLATILITIES },
    { label: 'Standard (2s) Indices',   items: DERIV_STANDARD_VOLATILITIES   },
];

const TradingViewPanel: React.FC = () => {
    const [tvSymbol, setTvSymbol] = useState('DERIV:R_50');
    const container_ref  = useRef<HTMLDivElement>(null);
    const widget_ref     = useRef<any>(null);
    const script_loaded  = useRef(false);
    const widget_id      = useRef(`tv_widget_${Math.random().toString(36).slice(2)}`);

    const createWidget = (sym: string) => {
        const container = container_ref.current;
        if (!container || !(window as any).TradingView) return;
        container.innerHTML = '';
        const inner = document.createElement('div');
        inner.id = widget_id.current;
        inner.style.cssText = 'width:100%;height:100%;';
        container.appendChild(inner);
        widget_ref.current = new (window as any).TradingView.widget({
            autosize:            true,
            symbol:              sym,
            interval:            '1',
            timezone:            'Etc/UTC',
            theme:               'dark',
            style:               '1',
            locale:              'en',
            toolbar_bg:          '#131722',
            enable_publishing:   false,
            hide_side_toolbar:   false,
            allow_symbol_change: false,
            details:             false,
            hotlist:             false,
            calendar:            false,
            container_id:        widget_id.current,
        });
    };

    useEffect(() => {
        if (script_loaded.current) {
            createWidget(tvSymbol);
            return;
        }
        const container = container_ref.current;
        if (!container) return;
        const script = document.createElement('script');
        script.src   = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        script.onload = () => {
            script_loaded.current = true;
            createWidget(tvSymbol);
        };
        container.appendChild(script);
        return () => { if (container) container.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tvSymbol]);

    return (
        <div className='chart-wrapper__tradingview'>
            <div className='tv-bar'>
                <span className='tv-bar__title'>
                    <span aria-hidden='true'>📊</span> Deriv Volatility Chart
                </span>
                <div className='tv-bar__sym-wrap'>
                    <select
                        className='tv-bar__sym-select'
                        value={tvSymbol}
                        onChange={e => setTvSymbol(e.target.value)}
                    >
                        {TV_SYMBOL_GROUPS.map(g => (
                            <optgroup key={g.label} label={g.label}>
                                {g.items.map(v => (
                                    <option key={v.code} value={`DERIV:${v.code}`}>
                                        {v.label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    <span className='tv-bar__sym-chev' aria-hidden='true'>▾</span>
                </div>
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
