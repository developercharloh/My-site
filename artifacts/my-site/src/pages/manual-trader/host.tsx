import React from 'react';
import './host.scss';

const ManualTraderHost: React.FC<{ active?: boolean }> = () => {
    return (
        <div className='manual-trader-coming-soon'>
            <div className='manual-trader-coming-soon__card'>
                <div className='manual-trader-coming-soon__icon'>🚀</div>
                <h2 className='manual-trader-coming-soon__title'>Manual Trader</h2>
                <p className='manual-trader-coming-soon__subtitle'>Coming Soon</p>
                <p className='manual-trader-coming-soon__description'>
                    We&apos;re working on a brand-new manual trading experience. Stay tuned!
                </p>
                <div className='manual-trader-coming-soon__dots'>
                    <span />
                    <span />
                    <span />
                </div>
            </div>
        </div>
    );
};

export default ManualTraderHost;
