import React, { useEffect, useState } from 'react';
import './splash-loader.scss';

const SplashLoader: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

    useEffect(() => {
        const t1 = setTimeout(() => setPhase('hold'), 400);
        const t2 = setTimeout(() => setPhase('out'),  2600);
        const t3 = setTimeout(() => onDone(),         3200);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, [onDone]);

    return (
        <div className={`splash splash--${phase}`} aria-hidden='true'>
            {/* Background grid */}
            <div className='splash__grid' />

            {/* Animated candles */}
            <div className='splash__candles'>
                {[
                    { h: 52, b: 38, up: false, delay: 0    },
                    { h: 68, b: 50, up: true,  delay: 0.08 },
                    { h: 44, b: 30, up: false, delay: 0.16 },
                    { h: 76, b: 58, up: true,  delay: 0.24 },
                    { h: 60, b: 44, up: true,  delay: 0.32 },
                    { h: 48, b: 34, up: false, delay: 0.40 },
                    { h: 72, b: 54, up: true,  delay: 0.48 },
                ].map((c, i) => (
                    <div
                        key={i}
                        className={`splash__candle splash__candle--${c.up ? 'up' : 'down'}`}
                        style={{ '--delay': `${c.delay}s`, '--body-h': `${c.b}px`, '--wick-h': `${c.h}px` } as React.CSSProperties}
                    />
                ))}
            </div>

            {/* Brand text */}
            <div className='splash__brand'>
                <div className='splash__logo'>
                    <span className='splash__logo-mr'>Mr</span>
                    <span className='splash__logo-name'>CharlohFX</span>
                </div>
                <p className='splash__tagline'>Where precision meets opportunity</p>
            </div>

            {/* Progress bar */}
            <div className='splash__bar-track'>
                <div className='splash__bar-fill' />
            </div>
        </div>
    );
};

export default SplashLoader;
