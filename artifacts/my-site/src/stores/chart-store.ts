import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { LocalStore } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import RootStore from './root-store';

type TSubscription = {
    id: string | null;
    subscriber: null | { unsubscribe: () => void };
};

export default class ChartStore {
    root_store: RootStore;
    constructor(root_store: RootStore) {
        makeObservable(this, {
            symbol: observable,
            is_chart_loading: observable,
            chart_type: observable,
            granularity: observable,
            current_price: observable,
            current_price_display: observable,
            is_contract_ended: computed,
            updateSymbol: action,
            onSymbolChange: action,
            updateGranularity: action,
            updateChartType: action,
            setChartStatus: action,
            restoreFromStorage: action,
            chart_subscription_id: observable,
            setChartSubscriptionId: action,
            setCurrentPrice: action,
            setCurrentPriceDisplay: action,
        });

        this.root_store = root_store;
        const { run_panel } = root_store;

        reaction(
            () => run_panel.is_running,
            () => (run_panel.is_running ? this.onStartBot() : this.onStopBot())
        );

        this.restoreFromStorage();
    }

    subscription: TSubscription = {
        id: null,
        subscriber: null,
    };
    chart_subscription_id = '';

    symbol: string | undefined;
    is_chart_loading: boolean | undefined;
    chart_type: string | undefined;
    granularity: number | undefined;
    current_price: number | undefined;
    current_price_display: string | undefined;

    private _tick_sub_id: string | null = null;
    private _tick_msg_sub: { unsubscribe: () => void } | null = null;
    private _tick_retry_timer: ReturnType<typeof setTimeout> | null = null;
    private _tick_target_symbol: string | null = null;

    setCurrentPrice = (price: number) => {
        this.current_price = price;
    };

    setCurrentPriceDisplay = (display: string) => {
        this.current_price_display = display;
    };

    private _startTickSubscription = async (symbol: string) => {
        if (this._tick_retry_timer) {
            clearTimeout(this._tick_retry_timer);
            this._tick_retry_timer = null;
        }
        this._tick_target_symbol = symbol;

        // Prefer api_base (persistent connection) over chart_api (pauses when chart unmounts)
        const api = (api_base as any)?.api ?? chart_api.api;

        try {
            if (this._tick_sub_id) {
                try { api.forget(this._tick_sub_id); } catch { /* ignore */ }
            }
            this._tick_msg_sub?.unsubscribe();
            this._tick_sub_id = null;
            this._tick_msg_sub = null;

            const res = await api.send({ ticks: symbol, subscribe: 1 });
            if (this._tick_target_symbol !== symbol) return;

            const tick = res?.tick;
            if (tick?.quote != null) this.setCurrentPrice(tick.quote);
            if (tick?.quote_display) {
                this.setCurrentPriceDisplay(tick.quote_display);
            } else if (tick?.quote != null) {
                this.setCurrentPriceDisplay(String(tick.quote));
            }

            this._tick_sub_id = res?.subscription?.id ?? null;

            this._tick_msg_sub = api.onMessage()?.subscribe(({ data }: any) => {
                const t = data?.tick;
                if (t?.symbol === symbol) {
                    if (t?.quote != null) this.setCurrentPrice(t.quote);
                    if (t?.quote_display) {
                        this.setCurrentPriceDisplay(t.quote_display);
                    } else if (t?.quote != null) {
                        this.setCurrentPriceDisplay(String(t.quote));
                    }
                }
            });
        } catch {
            if (this._tick_target_symbol === symbol) {
                this._tick_retry_timer = setTimeout(() => this._startTickSubscription(symbol), 3000);
            }
        }
    };

    get is_contract_ended() {
        const { transactions } = this.root_store;
        return transactions.contracts.length > 0 && transactions.contracts[0].is_ended;
    }

    onStartBot = () => {
        this.updateSymbol();
    };

    onStopBot = () => {};

    updateSymbol = () => {
        const workspace = window.Blockly.derivWorkspace;
        const market_block = workspace?.getAllBlocks().find((block: window.Blockly.Block) => {
            return block.type === 'trade_definition_market';
        });

        const symbol = market_block?.getFieldValue('SYMBOL_LIST') ?? api_base?.active_symbols[0]?.symbol;
        this.symbol = symbol;
    };

    onSymbolChange = (symbol: string) => {
        this.symbol = symbol;
        this.current_price = undefined;
        this.current_price_display = undefined;
        this.saveToLocalStorage();
        try {
            localStorage.setItem('chart_active_symbol', symbol);
            window.dispatchEvent(new StorageEvent('storage', { key: 'chart_active_symbol', newValue: symbol }));
        } catch { /* ignore */ }
        this._startTickSubscription(symbol);
    };

    updateGranularity = (granularity: number) => {
        this.granularity = granularity;
        this.saveToLocalStorage();
    };

    updateChartType = (chart_type: string) => {
        this.chart_type = chart_type;
        this.saveToLocalStorage();
    };

    setChartStatus = (status: boolean) => {
        this.is_chart_loading = status;
        // Re-subscribe on chart load/reload to ensure price keeps updating
        if (status === false && this.symbol && !this._tick_msg_sub) {
            this._startTickSubscription(this.symbol);
        }
    };

    saveToLocalStorage = () => {
        LocalStore.set(
            'bot.chart_props',
            JSON.stringify({
                symbol: this.symbol,
                granularity: this.granularity,
                chart_type: this.chart_type,
            })
        );
    };

    restoreFromStorage = () => {
        try {
            const props = LocalStore.get('bot.chart_props');

            if (props) {
                const { symbol, granularity, chart_type } = JSON.parse(props);
                this.symbol = symbol;
                this.granularity = granularity;
                this.chart_type = chart_type;
                if (symbol) this._startTickSubscription(symbol);
            } else {
                this.granularity = 0;
                this.chart_type = 'line';
            }
        } catch {
            LocalStore.remove('bot.chart_props');
        }
    };

    getMarketsOrder = (active_symbols: { market: string; display_name: string }[]) => {
        const synthetic_index = 'synthetic_index';

        const has_synthetic_index = !!active_symbols.find(s => s.market === synthetic_index);
        return active_symbols
            .slice()
            .sort((a, b) => (a.display_name < b.display_name ? -1 : 1))
            .map(s => s.market)
            .reduce(
                (arr, market) => {
                    if (arr.indexOf(market) === -1) arr.push(market);
                    return arr;
                },
                has_synthetic_index ? [synthetic_index] : []
            );
    };
    setChartSubscriptionId = (chartSubscriptionId: string) => {
        this.chart_subscription_id = chartSubscriptionId;
    };
}
