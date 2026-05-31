import React, { useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import './TokenLoginModal.scss';

type Step = 'choose' | 'input' | 'authorizing';
type AccountType = 'v1' | 'v2';

const LS = {
    AUTH_TOKEN: 'authToken',
    ACTIVE_LOGINID: 'active_loginid',
    CLIENT_ACCOUNTS: 'clientAccounts',
    ACCOUNTS_LIST: 'accountsList',
} as const;

const setLoggedStateCookie = () => {
    try {
        const domain = window.location.hostname.split('.').slice(-2).join('.');
        Cookies.set('logged_state', 'true', {
            domain,
            expires: 30,
            path: '/',
            secure: window.location.protocol === 'https:',
        });
    } catch { /* ignore */ }
};

type Props = {
    onClose: () => void;
};

const TokenLoginModal: React.FC<Props> = ({ onClose }) => {
    const [step, setStep] = useState<Step>('choose');
    const [accountType, setAccountType] = useState<AccountType>('v1');
    const [token, setToken] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (step === 'input') {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [step]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === overlayRef.current) onClose();
    };

    const handleChoose = (type: AccountType) => {
        setAccountType(type);
        setStep('input');
    };

    const handleLogin = async () => {
        const trimmed = token.trim();
        if (!trimmed) {
            setError('Please enter your API token.');
            return;
        }
        setError('');
        setStep('authorizing');

        let api: ReturnType<typeof generateDerivApiInstance> | null = null;
        try {
            api = await generateDerivApiInstance();
            if (!api) throw new Error('Could not connect to Deriv. Try again.');

            const result = await (api as any).authorize(trimmed);
            const { authorize, error: apiError } = result ?? {};

            if (apiError) {
                throw new Error(
                    apiError.code === 'InvalidToken'
                        ? 'Invalid token. Please check and try again.'
                        : apiError.message || 'Authorization failed.'
                );
            }
            if (!authorize) throw new Error('No response from Deriv. Try again.');

            const loginid: string = authorize.loginid ?? authorize.account_list?.[0]?.loginid ?? '';
            const currency: string = authorize.currency ?? 'USD';

            const accountsList: Record<string, string> = {};
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

            (authorize.account_list ?? []).forEach((acc: any) => {
                accountsList[acc.loginid] = trimmed;
                clientAccounts[acc.loginid] = {
                    loginid: acc.loginid,
                    token: trimmed,
                    currency: acc.currency ?? '',
                };
            });

            if (!accountsList[loginid]) {
                accountsList[loginid] = trimmed;
                clientAccounts[loginid] = { loginid, token: trimmed, currency };
            }

            localStorage.setItem(LS.ACCOUNTS_LIST, JSON.stringify(accountsList));
            localStorage.setItem(LS.CLIENT_ACCOUNTS, JSON.stringify(clientAccounts));
            localStorage.setItem('callback_token', JSON.stringify(authorize));
            localStorage.setItem(LS.AUTH_TOKEN, trimmed);
            localStorage.setItem(LS.ACTIVE_LOGINID, loginid);
            setLoggedStateCookie();

            window.location.replace(`/?account=${currency}`);
        } catch (err: any) {
            setError(err?.message || 'Connection failed. Try again.');
            setStep('input');
        } finally {
            try { (api as any)?.disconnect(); } catch { /* ignore */ }
        }
    };

    const tokenSettingsUrl =
        accountType === 'v2'
            ? 'https://app.deriv.com/account/api-token'
            : 'https://app.deriv.com/account/api-token';

    return (
        <div className='tlm-overlay' ref={overlayRef} onClick={handleOverlayClick}>
            <div className='tlm-modal' role='dialog' aria-modal='true'>
                {/* ── STEP: choose account type ── */}
                {step === 'choose' && (
                    <>
                        <div className='tlm-modal__header'>
                            <h2 className='tlm-modal__title'>Choose Account Type</h2>
                            <button className='tlm-modal__close' onClick={onClose} aria-label='Close'>✕</button>
                        </div>
                        <p className='tlm-modal__subtitle'>
                            Select the version that matches your Deriv account.
                        </p>
                        <div className='tlm-modal__options'>
                            <button className='tlm-option' onClick={() => handleChoose('v1')}>
                                <span className='tlm-option__badge tlm-option__badge--v1'>v1</span>
                                <div className='tlm-option__text'>
                                    <strong>Legacy Account</strong>
                                    <span>For existing Deriv accounts (CR/VR/VRTC) — login with API token</span>
                                </div>
                            </button>
                            <button className='tlm-option' onClick={() => handleChoose('v2')}>
                                <span className='tlm-option__badge tlm-option__badge--v2'>v2</span>
                                <div className='tlm-option__text'>
                                    <strong>New Account (v2)</strong>
                                    <span>For new Deriv accounts (DOT prefix) — login with Personal Access Token (PAT)</span>
                                </div>
                            </button>
                        </div>
                        <p className='tlm-modal__hint'>
                            Not sure? Check your account ID — legacy accounts start with CR/VR, new accounts start with DOT.
                        </p>
                        <div className='tlm-modal__footer'>
                            <button className='tlm-btn tlm-btn--ghost' onClick={onClose}>Cancel</button>
                        </div>
                    </>
                )}

                {/* ── STEP: enter token ── */}
                {step === 'input' && (
                    <>
                        <div className='tlm-modal__header'>
                            <h2 className='tlm-modal__title'>Login with API Token</h2>
                            <button className='tlm-modal__close' onClick={onClose} aria-label='Close'>✕</button>
                        </div>
                        <p className='tlm-modal__subtitle'>
                            Enter your Deriv {accountType === 'v2' ? 'Personal Access Token (PAT)' : 'API token'} to login.
                            You can create one from your Deriv account settings.
                        </p>
                        <input
                            ref={inputRef}
                            className={`tlm-input${error ? ' tlm-input--error' : ''}`}
                            type='text'
                            placeholder='API Token'
                            value={token}
                            onChange={e => { setToken(e.target.value); setError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                            autoComplete='off'
                        />
                        {error && <p className='tlm-error'>{error}</p>}
                        <p className='tlm-modal__link-row'>
                            Get your API token from{' '}
                            <a href={tokenSettingsUrl} target='_blank' rel='noreferrer' className='tlm-link'>
                                Deriv API Token Settings
                            </a>
                        </p>
                        <div className='tlm-modal__footer'>
                            <button className='tlm-btn tlm-btn--ghost' onClick={() => { setStep('choose'); setError(''); }}>Back</button>
                            <button className='tlm-btn tlm-btn--primary' onClick={handleLogin}>Login</button>
                        </div>
                    </>
                )}

                {/* ── STEP: authorizing ── */}
                {step === 'authorizing' && (
                    <>
                        <div className='tlm-modal__header'>
                            <h2 className='tlm-modal__title'>Login with API Token</h2>
                        </div>
                        <div className='tlm-modal__authorizing'>
                            <p className='tlm-modal__auth-text'>Authorizing...</p>
                            <span className='tlm-spinner' />
                        </div>
                        <div className='tlm-modal__footer'>
                            <button className='tlm-btn tlm-btn--ghost' disabled>Back</button>
                            <button className='tlm-btn tlm-btn--primary' disabled>· · · · ·</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default TokenLoginModal;
