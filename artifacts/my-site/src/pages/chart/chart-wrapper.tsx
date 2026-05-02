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

const TV_SYMBOLS: { value: string; label: string }[] = [
    { value: 'OANDA:XAUUSD',   label: 'Gold (XAU/USD)' },
    { value: 'OANDA:EURUSD',   label: 'EUR / USD' },
    { value: 'OANDA:GBPUSD',   label: 'GBP / USD' },
    { value: 'OANDA:USDJPY',   label: 'USD / JPY' },
    { value: 'BITSTAMP:BTCUSD', label: 'Bitcoin (BTC/USD)' },
    { value: 'BITSTAMP:ETHUSD', label: 'Ethereum (ETH/USD)' },
    { value: 'NASDAQ:AAPL',    label: 'Apple (AAPL)' },
    { value: 'NASDAQ:TSLA',    label: 'Tesla (TSLA)' },
    { value: 'TVC:US30',       label: 'Dow Jones 30' },
    { value: 'TVC:SPX',        label: 'S&P 500' },
];

function buildTvEmbedUrl(symbol: string, theme: 'dark' | 'light'): string {
    const params = new URLSearchParams({
        symbol,
        interval:        '5',
        theme,
        style:           '1',
        locale:          'en',
        toolbar_bg:      '#1e293b',
        enable_publishing: 'false',
        hide_top_toolbar:  'false',
        hide_legend:       'false',
        save_image:        'false',
        withdateranges:    'true',
        allow_symbol_change: 'true',
        details:           'true',
        hotlist:           'false',
        calendar:          'false',
        studies:           '[]',
    });
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

const ChartWrapper = observer(({ prefix = 'chart', show_digits_stats }: ChartWrapperProps) => {
    const { client, ui } = useStore();
    const [uuid] = useState(uuidv4());
    const [view, setView]     = useState<ChartView>('deriv');
    const [tvSymbol, setTvSymbol] = useState<string>(TV_SYMBOLS[0].value);

    const uniqueKey = client.loginid ? `${prefix}-${client.loginid}` : `${prefix}-${uuid}`;
    const tvTheme   = (ui as any)?.is_dark_mode_on ? 'dark' : 'light';
    const tvSrc     = buildTvEmbedUrl(tvSymbol, tvTheme);

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

                {view === 'tradingview' && (
                    <div className='chart-wrapper__tv-controls'>
                        <select
                            className='chart-wrapper__tv-symbol'
                            value={tvSymbol}
                            onChange={e => setTvSymbol(e.target.value)}
                        >
                            {TV_SYMBOLS.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {view === 'deriv' ? (
                <Chart key={uniqueKey} show_digits_stats={show_digits_stats} />
            ) : (
                <div className='chart-wrapper__tradingview'>
                    <iframe
                        key={`${tvSymbol}-${tvTheme}`}
                        title='TradingView Advanced Chart'
                        src={tvSrc}
                        className='chart-wrapper__tradingview-frame'
                        allow='fullscreen; clipboard-read; clipboard-write'
                        allowFullScreen
                        loading='lazy'
                    />
                </div>
            )}
        </div>
    );
});

export default ChartWrapper;
