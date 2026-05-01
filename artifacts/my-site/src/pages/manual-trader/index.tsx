import React from 'react';
import './manual-trader.scss';

/**
 * Manual Trader hosts the real Deriv DTrader (vendored from the
 * developercharloh/deriv-app fork) as a same-origin iframe pointing at
 * `/dtrader/`. Apollo's server serves the pre-built dist out of
 * `public/dtrader/`, with all asset paths rewritten to that sub-path.
 *
 * Same domain, no redirect to deriv.com, real DTrader code.
 */
const ManualTrader: React.FC = () => {
    return (
        <div className='manual-trader-frame'>
            <iframe
                src='/dtrader/'
                title='DTrader'
                className='manual-trader-frame__iframe'
                allow='clipboard-read; clipboard-write; fullscreen'
            />
        </div>
    );
};

export default ManualTrader;
