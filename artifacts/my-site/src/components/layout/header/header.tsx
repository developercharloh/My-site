import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import PWAInstallButton from '@/components/pwa-install-button';
import { generateOAuthURL, standalone_routes } from '@/components/shared';
import { isThirdPartyAppDomain } from '@/components/shared/utils/config/config';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useFirebaseCountriesConfig } from '@/hooks/firebase/useFirebaseCountriesConfig';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { clearAuthData, handleOidcAuthFailure } from '@/utils/auth-utils';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import PlatformSwitcher from './platform-switcher';
import './header.scss';

// ─── Engine selector ──────────────────────────────────────────────────────────

const ENGINE_KEY = 'free_bots_engine_mode';

const HeaderEngineSelector = () => {
    const [mode, setMode]   = useState<'v1' | 'v2'>(() => {
        try { return (localStorage.getItem(ENGINE_KEY) as 'v1' | 'v2') || 'v1'; } catch { return 'v1'; }
    });
    const [open, setOpen]   = useState(false);
    const ref               = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const select = (m: 'v1' | 'v2') => {
        setMode(m);
        try { localStorage.setItem(ENGINE_KEY, m); } catch { /* ignore */ }
        // Dispatch storage event so free-bots page reacts instantly
        window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_KEY, newValue: m }));
        setOpen(false);
    };

    return (
        <div className='hdr-engine' ref={ref}>
            <button
                className={`hdr-engine__btn hdr-engine__btn--${mode}`}
                onClick={() => setOpen(p => !p)}
                title='Switch trading engine'
            >
                {mode === 'v1' ? '⚙️ V1' : '⚡ V2'}
                <span className='hdr-engine__arrow'>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className='hdr-engine__dropdown'>
                    <button
                        className={`hdr-engine__option ${mode === 'v1' ? 'hdr-engine__option--active' : ''}`}
                        onClick={() => select('v1')}
                    >
                        <span className='hdr-engine__opt-icon'>⚙️</span>
                        <span>
                            <strong>Classic V1</strong>
                            <span className='hdr-engine__opt-sub'>Deriv DBot engine</span>
                        </span>
                    </button>
                    <button
                        className={`hdr-engine__option ${mode === 'v2' ? 'hdr-engine__option--active' : ''}`}
                        onClick={() => select('v2')}
                    >
                        <span className='hdr-engine__opt-icon'>⚡</span>
                        <span>
                            <strong>Advanced V2</strong>
                            <span className='hdr-engine__opt-sub'>Direct API · Zero overhead</span>
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
};

// ─── App header ───────────────────────────────────────────────────────────────

type TAppHeaderProps = {
    isAuthenticating?: boolean;
};

const AppHeader = observer(({ isAuthenticating }: TAppHeaderProps) => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts, getCurrency, is_virtual } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const currency = getCurrency?.();
    const { localize } = useTranslations();

    const { isSingleLoggingIn } = useOauth2();

    const { hubEnabledCountryList } = useFirebaseCountriesConfig();
    const { onRenderTMBCheck, isTmbEnabled } = useTMB();
    const is_tmb_enabled = isTmbEnabled() || window.is_tmb_enabled === true;
    // No need for additional state management here since we're handling it in the layout component

    const renderAccountSection = useCallback(() => {
        // Show loader during authentication processes
        if (isAuthenticating || isAuthorizing || (isSingleLoggingIn && !is_tmb_enabled)) {
            return <AccountsInfoLoader isLoggedIn isMobile={!isDesktop} speed={3} />;
        } else if (activeLoginid) {
            return (
                <>
                    {/* <CustomNotifications /> */}

                    {isDesktop &&
                        (has_wallet ? (
                            <Button
                                className='manage-funds-button'
                                has_effect
                                text={localize('Manage funds')}
                                onClick={() => {
                                    let redirect_url = new URL(standalone_routes.wallets_transfer);
                                    const is_hub_enabled_country = hubEnabledCountryList.includes(
                                        client?.residence || ''
                                    );
                                    if (is_hub_enabled_country) {
                                        redirect_url = new URL(standalone_routes.recent_transactions);
                                    }
                                    if (is_virtual) {
                                        redirect_url.searchParams.set('account', 'demo');
                                    } else if (currency) {
                                        redirect_url.searchParams.set('account', currency);
                                    }
                                    window.location.assign(redirect_url.toString());
                                }}
                                primary
                            />
                        ) : (
                            <Button
                                primary
                                onClick={() => {
                                    const redirect_url = new URL(standalone_routes.cashier_deposit);
                                    if (currency) {
                                        redirect_url.searchParams.set('account', currency);
                                    }
                                    window.location.assign(redirect_url.toString());
                                }}
                                className='deposit-button'
                            >
                                {localize('Deposit')}
                            </Button>
                        ))}

                    <AccountSwitcher activeAccount={activeAccount} />

                    {isDesktop &&
                        (() => {
                            let redirect_url = new URL(standalone_routes.personal_details);
                            const is_hub_enabled_country = hubEnabledCountryList.includes(client?.residence || '');

                            if (has_wallet && is_hub_enabled_country) {
                                redirect_url = new URL(standalone_routes.account_settings);
                            }
                            // Check if the account is a demo account
                            // Use the URL parameter to determine if it's a demo account, as this will update when the account changes
                            const urlParams = new URLSearchParams(window.location.search);
                            const account_param = urlParams.get('account');
                            const is_virtual = client?.is_virtual || account_param === 'demo';

                            if (is_virtual) {
                                // For demo accounts, set the account parameter to 'demo'
                                redirect_url.searchParams.set('account', 'demo');
                            } else if (currency) {
                                // For real accounts, set the account parameter to the currency
                                redirect_url.searchParams.set('account', currency);
                            }
                            return (
                                <Tooltip
                                    as='a'
                                    href={redirect_url.toString()}
                                    tooltipContent={localize('Manage account settings')}
                                    tooltipPosition='bottom'
                                    className='app-header__account-settings'
                                >
                                    <StandaloneCircleUserRegularIcon className='app-header__profile_icon' />
                                </Tooltip>
                            );
                        })()}
                </>
            );
        } else {
            return (
                <div className='auth-actions'>
                    <Button
                        tertiary
                        onClick={async () => {
                            clearAuthData(false);
                            const getQueryParams = new URLSearchParams(window.location.search);
                            const currency = getQueryParams.get('account') ?? '';
                            const query_param_currency =
                                currency || sessionStorage.getItem('query_param_currency') || 'USD';

                            // Third-party domains (charloz.replit.app, *.onrender.com) must use
                            // the legacy OAuth flow — Deriv's OIDC / Hub flow is only for
                            // first-party Deriv apps and would redirect to hub.deriv.com instead
                            // of coming back to our callback URL.
                            if (isThirdPartyAppDomain()) {
                                window.location.replace(generateOAuthURL());
                                return;
                            }

                            try {
                                // First, explicitly wait for TMB status to be determined
                                const tmbEnabled = await isTmbEnabled();
                                // Now use the result of the explicit check
                                if (tmbEnabled) {
                                    await onRenderTMBCheck(true); // Pass true to indicate it's from login button
                                } else {
                                    // Always use OIDC if TMB is not enabled
                                    try {
                                        await requestOidcAuthentication({
                                            redirectCallbackUri: `${window.location.origin}/callback`,
                                            ...(query_param_currency
                                                ? {
                                                      state: {
                                                          account: query_param_currency,
                                                      },
                                                  }
                                                : {}),
                                        });
                                    } catch (err) {
                                        handleOidcAuthFailure(err);
                                        window.location.replace(generateOAuthURL());
                                    }
                                }
                            } catch (error) {
                                // eslint-disable-next-line no-console
                                console.error(error);
                            }
                        }}
                    >
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button
                        primary
                        onClick={() => {
                            window.open(standalone_routes.signup);
                        }}
                    >
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
    }, [
        isAuthenticating,
        isAuthorizing,
        isSingleLoggingIn,
        isDesktop,
        activeLoginid,
        standalone_routes,
        client,
        has_wallet,
        currency,
        localize,
        activeAccount,
        is_virtual,
        onRenderTMBCheck,
        is_tmb_enabled,
    ]);

    if (client?.should_hide_header) return null;
    return (
        <Header
            className={clsx('app-header', {
                'app-header--desktop': isDesktop,
                'app-header--mobile': !isDesktop,
            })}
        >
            <Wrapper variant='left'>
                <AppLogo />
                <MobileMenu />
                {isDesktop && <MenuItems />}
            </Wrapper>
            <Wrapper variant='right'>
                <button
                    onClick={() => window.location.reload()}
                    title='Refresh'
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '6px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--text-general)',
                        fontSize: '18px',
                        lineHeight: 1,
                    }}
                    aria-label='Refresh page'
                >
                    ↺
                </button>
                <HeaderEngineSelector />
                {!isDesktop && <PWAInstallButton variant='primary' size='medium' />}
                {renderAccountSection()}
            </Wrapper>
            {/* <PWAInstallModalTest /> */}
        </Header>
    );
});

export default AppHeader;
