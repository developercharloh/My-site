import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { generateOAuthURL } from '@/components/shared';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { handleOidcAuthFailure } from '@/utils/auth-utils';
import './login-gate.scss';

const LoginGate: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { client } = useStore();
    const { isOAuth2Enabled } = useOauth2();
    const [loading, setLoading] = React.useState(false);

    if (client?.is_logged_in) return <>{children}</>;

    const handleLogin = async () => {
        setLoading(true);
        try {
            if (!isOAuth2Enabled) {
                window.location.replace(generateOAuthURL());
            } else {
                await requestOidcAuthentication({
                    redirectCallbackUri: `${window.location.origin}/callback`,
                });
            }
        } catch (err) {
            handleOidcAuthFailure(err);
            setLoading(false);
        }
    };

    const handleSignup = () => {
        window.open('https://track.deriv.com/_ZpTaWpj8mZlZl7VyVw174GNd7ZgqdRLk/1', '_blank');
    };

    return (
        <div className='login-gate'>
            <div className='login-gate__bg'>
                <span className='login-gate__orb login-gate__orb--1' />
                <span className='login-gate__orb login-gate__orb--2' />
                <span className='login-gate__orb login-gate__orb--3' />
            </div>

            <div className='login-gate__card'>
                <img src='/logo.png' alt='Mr CharlohFX' className='login-gate__logo' />
                <h1 className='login-gate__title'>Mr CharlohFX</h1>
                <p className='login-gate__tagline'>Where Precision Meets Opportunity</p>

                <div className='login-gate__divider' />

                <p className='login-gate__message'>
                    Log in to access all trading features — bot builder, speed bots, charts, signals and more.
                </p>

                <div className='login-gate__actions'>
                    <button
                        className='login-gate__btn login-gate__btn--primary'
                        onClick={handleLogin}
                        disabled={loading}
                    >
                        {loading ? (
                            <span className='login-gate__spinner' />
                        ) : (
                            'Log in'
                        )}
                    </button>
                    <button
                        className='login-gate__btn login-gate__btn--outline'
                        onClick={handleSignup}
                    >
                        Create free account
                    </button>
                </div>

                <p className='login-gate__footer'>
                    Powered by Deriv — regulated &amp; trusted worldwide
                </p>
            </div>
        </div>
    );
});

export default LoginGate;
