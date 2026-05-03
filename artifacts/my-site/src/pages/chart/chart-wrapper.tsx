import React, { useEffect, useRef, useState } from 'react';
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

// TradingView doesn't carry Deriv synthetic Volatility indices, so we offer the
// most-traded FX, crypto, gold and index proxies instead. Users who need real
// Deriv volatility ticks should use the built-in "Charts" view (SmartCharts).
const TV_SYMBOLS: { label: string; value: string }[] = [
    { label: 'EUR / USD',      value: 'FX:EURUSD'           },
    { label: 'GBP / USD',      value: 'FX:GBPUSD'           },
    { label: 'USD / JPY',      value: 'FX:USDJPY'           },
    { label: 'AUD / USD',      value: 'FX:AUDUSD'           },
    { label: 'XAU / USD (Gold)', value: 'OANDA:XAUUSD'      },
    { label: 'BTC / USD',      value: 'BITSTAMP:BTCUSD'     },
    { label: 'ETH / USD',      value: 'BITSTAMP:ETHUSD'     },
    { label: 'US 500 (S&P)',   value: 'OANDA:SPX500USD'     },
    { label: 'US Tech 100',    value: 'OANDA:NAS100USD'     },
    { label: 'Germany 40',     value: 'OANDA:DE30EUR'       },
];

const TV_INTERVALS: { label: string; value: string }[] = [
    { label: '1m',  value: '1'   },
    { label: '5m',  value: '5'   },
    { label: '15m', value: '15'  },
    { label: '1h',  value: '60'  },
    { label: '4h',  value: '240' },
    { label: '1D',  value: 'D'   },
];

declare global {
    interface Window {
        TradingView?: {
            widget: new (config: Record<string, unknown>) => unknown;
        };
    }
}

const TV_SCRIPT_SRC = 'https://s3.tradingview.com/tv.js';

const loadTradingViewScript = (): Promise<void> =>
    new Promise((resolve, reject) => {
        if (typeof window === 'undefined') return reject(new Error('SSR'));
        if (window.TradingView) return resolve();

        const existing = document.querySelector<HTMLScriptElement>(`script[src="${TV_SCRIPT_SRC}"]`);
        if (existing) {
            existing.addEventListener('load',  () => resolve());
            existing.addEventListener('error', () => reject(new Error('TradingView script failed to load')));
            return;
        }

        const script = document.createElement('script');
        script.src   = TV_SCRIPT_SRC;
        script.async = true;
        script.onload  = () => resolve();
        script.onerror = () => reject(new Error('TradingView script failed to load'));
        document.head.appendChild(script);
    });

const TradingViewPanel: React.FC = () => {
    const container_ref           = useRef<HTMLDivElement | null>(null);
    const [symbol,   setSymbol]   = useState<string>(TV_SYMBOLS[0].value);
    const [interval, setInterval] = useState<string>('5');
    const [theme,    setTheme]    = useState<'dark' | 'light'>('dark');
    const [error,    setError]    = useState<string | null>(null);
    const [container_id]          = useState<string>(() => `tv_chart_${Math.random().toString(36).slice(2, 10)}`);

    useEffect(() => {
        let cancelled = false;
        setError(null);

        loadTradingViewScript()
            .then(() => {
                if (cancelled || !container_ref.current || !window.TradingView) return;
                container_ref.current.innerHTML = `<div id="${container_id}" style="height:100%;width:100%;"></div>`;
                /* eslint-disable no-new */
                new window.TradingView.widget({
                    autosize:            true,
                    symbol,
                    interval,
                    timezone:            'Etc/UTC',
                    theme,
                    style:               '1',
                    locale:              'en',
                    enable_publishing:   false,
                    hide_top_toolbar:    false,
                    hide_legend:         false,
                    save_image:          true,
                    container_id,
                    studies:             ['RSI@tv-basicstudies', 'MASimple@tv-basicstudies'],
                    backgroundColor:     theme === 'dark' ? 'rgba(15,23,42,1)' : 'rgba(255,255,255,1)',
                });
            })
            .catch(err => {
                if (!cancelled) setError(err.message || 'Failed to load TradingView');
            });

        return () => { cancelled = true; };
    }, [symbol, interval, theme, container_id]);

    return (
        <div className='chart-wrapper__tradingview'>
            <div className='tv-toolbar'>
                <label className='tv-toolbar__field'>
                    <span>Symbol</span>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {TV_SYMBOLS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                </label>

                <label className='tv-toolbar__field'>
                    <span>Interval</span>
                    <select value={interval} onChange={e => setInterval(e.target.value)}>
                        {TV_INTERVALS.map(i => (
                            <option key={i.value} value={i.value}>{i.label}</option>
                        ))}
                    </select>
                </label>

                <button
                    type='button'
                    className='tv-toolbar__theme'
                    onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
                    title='Toggle theme'
                >
                    {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
                </button>
            </div>

            <div className='tv-note'>
                <span aria-hidden='true'>ℹ️</span>
                TradingView doesn't list Deriv synthetic indices (Volatility 10/25/50/75/100, etc).
                For those, switch back to <strong>📊 Charts</strong>. Use TradingView for Forex, gold,
                crypto and global indices with full drawing tools and indicators.
            </div>

            <div className='tv-frame' ref={container_ref}>
                {error && (
                    <div className='tv-error'>
                        <strong>Couldn't load TradingView.</strong>
                        <span>{error}. Check your internet connection or any ad-blocker that may be blocking
                              <code> s3.tradingview.com</code>.</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const ChartWrapper = observer(({ prefix = 'chart', show_digits_stats }: ChartWrapperProps) => {
    const { client }   = useStore();
    const [uuid]       = useState(uuidv4());
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
