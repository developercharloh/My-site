import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { buildNewAuthUrl } from '@/utils/pkce';
import './login-gate.scss';

const LoginGate: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { client } = useStore();

    if (client?.is_logged_in) return <>{children}</>;

    const handleLogin = async () => {
        const url = await buildNewAuthUrl();
        window.location.href = url;
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
                        <button className='login-gate__btn login-gate__btn--primary' onClick={handleLogin}>
                            Login
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
    );
});

export default LoginGate;
