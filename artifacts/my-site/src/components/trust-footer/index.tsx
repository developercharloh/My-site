import React, { useEffect, useRef, useState } from 'react';
import './trust-footer.scss';

const TrustFooter: React.FC = () => {
    const [open, setOpen]   = useState(false);
    const popRef            = useRef<HTMLDivElement | null>(null);
    const btnRef            = useRef<HTMLButtonElement | null>(null);

    // Close the popover when the user taps anywhere outside the icon
    // or its bubble. Also close on Escape key for keyboard users.
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            const t = e.target as Node;
            if (popRef.current?.contains(t)) return;
            if (btnRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('pointerdown', onPointer);
        window.addEventListener('keydown',     onKey);
        return () => {
            window.removeEventListener('pointerdown', onPointer);
            window.removeEventListener('keydown',     onKey);
        };
    }, [open]);

    return (
        <div className='trust-footer'>
            <button
                ref={btnRef}
                type='button'
                className={`trust-footer__icon-btn ${open ? 'trust-footer__icon-btn--open' : ''}`}
                aria-label='Risk warning — tap to read'
                aria-expanded={open}
                title='Risk warning'
                onClick={() => setOpen(o => !o)}
            >
                <span className='trust-footer__icon-glyph' aria-hidden='true'>⚠️</span>
            </button>

            {open && (
                <div
                    ref={popRef}
                    className='trust-footer__popover'
                    role='dialog'
                    aria-label='Risk warning'
                >
                    <div className='trust-footer__popover-arrow' />
                    <div className='trust-footer__popover-head'>
                        <span className='trust-footer__popover-title'>
                            <span aria-hidden='true'>⚠️</span> Risk Warning
                        </span>
                        <button
                            type='button'
                            className='trust-footer__popover-close'
                            aria-label='Close'
                            onClick={() => setOpen(false)}
                        >
                            ×
                        </button>
                    </div>
                    <p className='trust-footer__popover-body'>
                        Trading derivatives carries substantial risk of loss.
                        Past performance is not indicative of future results.
                        Only trade with money you can afford to lose.
                    </p>
                </div>
            )}
        </div>
    );
};

export default TrustFooter;
