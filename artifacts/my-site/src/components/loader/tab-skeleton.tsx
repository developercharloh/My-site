import React from 'react';
import './tab-skeleton.scss';

// Lightweight content-shaped placeholder shown while a lazy-loaded tab is
// fetching its JS chunk. Each variant approximates the real layout so the
// switch from skeleton → real UI feels seamless instead of janky.
type Variant = 'dashboard' | 'chart' | 'cards' | 'panel' | 'list';

interface Props {
    variant?: Variant;
    /** Optional sub-text shown under the skeleton (e.g. "Loading chart…"). */
    label?:   string;
}

const Bar: React.FC<{ w?: string; h?: string; r?: string; mt?: string }> = ({
    w = '100%', h = '12px', r = '6px', mt = '0',
}) => (
    <span className='tab-skel__bar' style={{ width: w, height: h, borderRadius: r, marginTop: mt }} />
);

const Card: React.FC<{ h?: string }> = ({ h = '120px' }) => (
    <div className='tab-skel__card' style={{ height: h }}>
        <Bar w='40%' h='14px' />
        <Bar w='80%' h='10px' mt='12px' />
        <Bar w='65%' h='10px' mt='8px' />
        <Bar w='30%' h='28px' r='14px' mt='auto' />
    </div>
);

const TabSkeleton: React.FC<Props> = ({ variant = 'dashboard', label }) => {
    return (
        <div className={`tab-skel tab-skel--${variant}`} role='status' aria-label={label || 'Loading'}>
            {variant === 'dashboard' && (
                <>
                    <div className='tab-skel__row'>
                        <Bar w='180px' h='28px' />
                        <Bar w='110px' h='28px' r='14px' />
                    </div>
                    <div className='tab-skel__grid'>
                        {Array.from({ length: 6 }).map((_, i) => <Card key={i} />)}
                    </div>
                </>
            )}

            {variant === 'chart' && (
                <>
                    <div className='tab-skel__row'>
                        <Bar w='140px' h='22px' />
                        <Bar w='90px'  h='22px' r='11px' />
                    </div>
                    <div className='tab-skel__chart' />
                    <div className='tab-skel__row tab-skel__row--center' style={{ marginTop: '10px' }}>
                        <Bar w='30%' h='10px' />
                        <Bar w='20%' h='10px' />
                        <Bar w='25%' h='10px' />
                    </div>
                </>
            )}

            {variant === 'cards' && (
                <>
                    <div className='tab-skel__row'>
                        <Bar w='200px' h='24px' />
                    </div>
                    <div className='tab-skel__grid tab-skel__grid--tight'>
                        {Array.from({ length: 8 }).map((_, i) => <Card key={i} h='150px' />)}
                    </div>
                </>
            )}

            {variant === 'panel' && (
                <div className='tab-skel__panel'>
                    <Bar w='60%' h='22px' />
                    <Bar w='100%' h='10px' mt='14px' />
                    <Bar w='90%'  h='10px' mt='8px' />
                    <Bar w='75%'  h='10px' mt='8px' />
                    <Bar w='100%' h='44px' r='10px' mt='20px' />
                    <Bar w='100%' h='44px' r='10px' mt='10px' />
                    <Bar w='40%'  h='38px' r='19px' mt='20px' />
                </div>
            )}

            {variant === 'list' && (
                <div className='tab-skel__list'>
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className='tab-skel__list-row'>
                            <span className='tab-skel__avatar' />
                            <div className='tab-skel__list-text'>
                                <Bar w='45%' h='12px' />
                                <Bar w='80%' h='10px' mt='8px' />
                            </div>
                            <Bar w='60px' h='28px' r='14px' />
                        </div>
                    ))}
                </div>
            )}

            {label && <span className='tab-skel__label'>{label}</span>}
        </div>
    );
};

export default TabSkeleton;
