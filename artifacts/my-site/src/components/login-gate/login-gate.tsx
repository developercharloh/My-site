import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { generateOAuthURL } from '@/components/shared/utils/config/config';
import './login-gate.scss';

const POPUP_W = 520;
const POPUP_H = 680;

const openPopup = (url: string): Window | null => {
    const left = Math.round(window.screenX + (window.outerWidth - POPUP_W) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - POPUP_H) / 2);
    return window.open(
        url,
        'deriv-legacy-oauth',
        `width=${POPUP_W},height=${POPUP_H},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
};

const LoginGate: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { client } = useStore();
    const [popupOpen, setPopupOpen] = React.useState(false);
    const [stuck, setStuck] = React.useState(false);
    const popupRef = React.useRef<Window | null>(null);
    const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    React.useEffect(() => {
        const msgHandler = (ev: MessageEvent) => {
            if (ev.origin !== window.location.origin) return;
            if (ev.data?.type !== 'deriv-oauth-tokens') return;
            stopPolling();
            popupRef.current?.close();
            popupRef.current = null;
            setPopupOpen(false);
            window.location.replace(`/?account=${ev.data.currency || 'USD'}`);
        };
        window.addEventListener('message', msgHandler);
        let bc: BroadcastChannel | null = null;
        try {
            bc = new BroadcastChannel('deriv-oauth');
            bc.onmessage = (ev) => {
                if (ev.data?.type !== 'deriv-oauth-tokens') return;
                stopPolling();
                popupRef.current?.close();
                popupRef.current = null;
                setPopupOpen(false);
                window.location.replace(`/?account=${ev.data.currency || 'USD'}`);
            };
        } catch { /* BroadcastChannel not supported */ }
        return () => {
            window.removeEventListener('message', msgHandler);
            try { bc?.close(); } catch { /* ignore */ }
            stopPolling();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (client?.is_logged_in) return <>{children}</>;

    const handleLegacyLogin = () => {
        localStorage.setItem('login_gate', 'legacy');
        const url = generateOAuthURL();
        const popup = openPopup(url);
        if (!popup) { window.location.replace(url); return; }
        popupRef.current = popup;
        setPopupOpen(true);
        setStuck(false);
        pollRef.current = setInterval(() => {
            if (!popup || popup.closed) {
                stopPolling();
                popupRef.current = null;
                setPopupOpen(false);
                setStuck(true);
            }
        }, 600);
    };

    const handleNewAccount = () => {
        window.location.href = 'https://elitestrategylab.site/';
    };

    return (
        <div className='login-gate'>
            <div className='login-gate__bg'>
                <span className='login-gate__orb login-gate__orb--1' />
                <span className='login-gate__orb login-gate__orb--2' />
                <span className='login-gate__orb login-gate__orb--3' />
            </div>

            <div className='login-gate__wrapper'>
                <div className='login-gate__header'>
                    <img src='/logo.png' alt='Mr CharlohFX' className='login-gate__logo' />
                    <h1 className='login-gate__title'>Mr CharlohFX</h1>
                    <p className='login-gate__tagline'>Where Precision Meets Opportunity</p>
                </div>

                {/* Popup states */}
                {popupOpen && (
                    <div className='login-gate__overlay-msg'>
                        <span className='login-gate__spinner login-gate__spinner--gold' />
                        <p>Login window is open — complete sign-in in the popup.</p>
                        <button
                            className='login-gate__btn login-gate__btn--outline login-gate__btn--sm'
                            onClick={() => { stopPolling(); popupRef.current?.close(); setPopupOpen(false); }}
                        >
                            Cancel
                        </button>
                    </div>
                )}

                {stuck && (
                    <div className='login-gate__overlay-msg'>
                        <p className='login-gate__stuck-title'>Window closed before finishing.</p>
                        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '1.3rem', margin: 0 }}>
                            Please complete sign-in without closing the popup early.
                        </p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className='login-gate__btn login-gate__btn--legacy login-gate__btn--sm' onClick={() => { setStuck(false); handleLegacyLogin(); }}>Try Again</button>
                            <button className='login-gate__btn login-gate__btn--outline login-gate__btn--sm' onClick={() => setStuck(false)}>Back</button>
                        </div>
                    </div>
                )}

                {!popupOpen && !stuck && (
                    <div className='login-gate__gates'>
                        {/* Gate 1 — Existing accounts */}
                        <div className='login-gate__gate'>
                            <div className='login-gate__gate-badge login-gate__gate-badge--live'>
                                <span className='login-gate__gate-badge-dot' />
                                Live
                            </div>
                            <div className='login-gate__gate-icon'>🔑</div>
                            <h2 className='login-gate__gate-title'>Existing Accounts</h2>
                            <p className='login-gate__gate-desc'>
                                Log in with your current Deriv account and start trading instantly.
                            </p>
                            <button className='login-gate__btn login-gate__btn--primary' onClick={handleLegacyLogin}>
                                Log in with Deriv
                            </button>
                            <p className='login-gate__gate-note'>Works with all existing Deriv accounts</p>
                        </div>

                        {/* Gate 2 — New accounts → elitestrategylab.site */}
                        <div className='login-gate__gate'>
                            <div className='login-gate__gate-badge login-gate__gate-badge--live'>
                                <span className='login-gate__gate-badge-dot' />
                                Live
                            </div>
                            <div className='login-gate__gate-icon'>⚡</div>
                            <h2 className='login-gate__gate-title'>New Deriv Accounts</h2>
                            <p className='login-gate__gate-desc'>
                                For accounts created on Deriv's new platform (api.deriv.com).
                            </p>
                            <button className='login-gate__btn login-gate__btn--new' onClick={handleNewAccount}>
                                Continue
                            </button>
                            <p className='login-gate__gate-note'>You'll be redirected to elitestrategylab.site</p>
                        </div>
                    </div>
                )}

                <div className='login-gate__footer-row'>
                    <button
                        className='login-gate__link-btn'
                        onClick={() => window.open('https://track.deriv.com/_ZpTaWpj8mZlZl7VyVw174GNd7ZgqdRLk/1', '_blank')}
                    >
                        Don't have an account? Create one free
                    </button>
                    <p className='login-gate__footer'>Powered by Deriv — regulated &amp; trusted worldwide</p>
                </div>
            </div>
        </div>
    );
});

export default LoginGate;
