import React from 'react';
import './trust-footer.scss';

const TrustFooter: React.FC = () => {
    return (
        <div className='trust-footer'>
            <div className='trust-footer__inner'>
                <span className='trust-footer__risk'>
                    ⚠️ <strong>Risk Warning:</strong> Trading derivatives carries substantial risk of loss.
                    Past performance is not indicative of future results. Only trade with money you can afford to lose.
                </span>
            </div>
        </div>
    );
};

export default TrustFooter;
