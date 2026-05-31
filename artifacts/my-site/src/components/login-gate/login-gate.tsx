import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import TokenLoginModal from '@/components/layout/header/token-login-modal/TokenLoginModal';
import { buildLegacyAuthUrl } from '@/utils/pkce';
import './login-gate.scss';

const LoginGate: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { client } = useStore();
    const [showTokenModal, setShowTokenModal] = useState(false);

    if (client?.is_logged_in) return <>{children}</>;

    return (
        <>
            {showTokenModal && <TokenLoginModal onClose={() => setShowTokenModal(false)} />}
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

                    <div className='login-gate__gates login-gate__gates--single'>
                        <div className='login-gate__gate login-gate__gate--center'>
                            <div className='login-gate__gate-badge login-gate__gate-badge--live'>
                                <span className='login-gate__gate-badge-dot' />
                                Live
                            </div>
                            <div className='login-gate__gate-icon'>🔑</div>
                            <h2 className='login-gate__gate-title'>Welcome Back</h2>
                            <p className='login-gate__gate-desc'>
                                Sign in with your Deriv account to access the bot and start trading.
                            </p>
                            <button
                                className='login-gate__btn login-gate__btn--primary'
                                onClick={() => window.location.href = buildLegacyAuthUrl()}
                            >
                                Login with Deriv
                            </button>
                            <button
                                className='login-gate__btn'
                                style={{
                                    marginTop: '0.6rem',
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1.5px solid rgba(212,175,55,0.4)',
                                    color: '#d4af37',
                                    fontSize: '0.84rem',
                                    padding: '0.6rem 1.2rem',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    width: '100%',
                                    fontWeight: 600,
                                }}
                                onClick={() => setShowTokenModal(true)}
                            >
                                Token Login (Wallet / All accounts)
                            </button>
                            <p className='login-gate__gate-note'>Works with all Deriv accounts</p>
                        </div>
                    </div>

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
        </>
    );
});

export default LoginGate;
