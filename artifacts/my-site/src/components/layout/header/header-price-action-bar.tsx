import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';

const HeaderPriceActionBar = observer(() => {
    const store = useStore();
    const display = store?.chart_store?.current_price_display;
    const price = store?.chart_store?.current_price;

    let pip: string;
    if (display) {
        pip = display;
    } else if (price != null) {
        // Fallback: format with at least 2 decimal places
        const parts = String(price).split('.');
        const decimals = parts[1]?.length ?? 0;
        pip = price.toFixed(Math.max(decimals, 2));
    } else {
        pip = '—';
    }

    return (
        <div className='pa-bar' style={{ margin: 0, borderRadius: 6 }}>
            <span className='pa-bar__price'>{pip}</span>
        </div>
    );
});

export default HeaderPriceActionBar;
