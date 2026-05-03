import React, { useEffect, useState } from 'react';
import './splash-loader.scss';

const SplashLoader: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    // Start already visible — the HTML shell handled the fade-in before JS loaded.
    // We just hold, then fade out when we're done.
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        // Give the app a moment to settle after React mounts, then fade out
        const t1 = setTimeout(() => setVisible(false), 2600);
        const t2 = setTimeout(() => onDone(),          3200);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [onDone]);

    return (
        <div className={`splash ${visible ? 'splash--visible' : 'splash--out'}`} aria-hidden='true'>
            <div className='splash__grid' />
            <div className='splash__glow' />
            <div className='splash__content'>
                <div className='splash__logo-wrap'>
                    <img
                        className='splash__logo-img'
                        src='/logo.png'
                        alt='Trader CharlohFX'
                        draggable={false}
                    />
                </div>
            </div>
            <div className='splash__bar-track'>
                <div className='splash__bar-fill' />
            </div>
        </div>
    );
};

export default SplashLoader;
