import React, { useEffect, useState } from 'react';
import './splash-loader.scss';

const SplashLoader: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

    useEffect(() => {
        const t1 = setTimeout(() => setPhase('hold'), 200);
        const t2 = setTimeout(() => setPhase('out'),  2800);
        const t3 = setTimeout(() => onDone(),         3400);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, [onDone]);

    return (
        <div className={`splash splash--${phase}`} aria-hidden='true'>
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
