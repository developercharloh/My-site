import React from 'react';
import { observer } from 'mobx-react-lite';
import { formatMoney, getCurrencyDisplayCode } from '@/components/shared';
import MobileDialog from '@/components/shared_ui/mobile-dialog';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import useStoreWalletAccountsList from '@/hooks/useStoreWalletAccountsList';
import { Analytics } from '@deriv-com/analytics';
import { Localize } from '@deriv-com/translations';
import './account-switcher-wallet-mobile.scss';

type TAccountSwitcherWalletMobile = {
    loginid: string;
    is_visible: boolean;
    toggle: (value: boolean) => void;
    residence?: string;
    is_virtual?: boolean;
    currency?: string;
};

// Currency icon: rendered from the wallet's icon URL or falls back to a styled badge
const WalletCurrencyIcon = ({
    icons,
    currency,
    is_virtual,
}: {
    icons?: Record<string, string>;
    currency?: string;
    is_virtual?: boolean;
}) => {
    const icon_url = icons?.light || icons?.dark || '';
    if (icon_url) {
        return (
            <img
                src={icon_url}
                alt={currency ?? ''}
                className='wallet-acct-row__wallet-icon-img'
                onError={e => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
            />
        );
    }
    // Fallback: emoji or short text
    const fallback = is_virtual ? '🔵' : (currency === 'USD' ? '🇺🇸' : currency?.slice(0, 3) ?? '?');
    return (
        <span style={{ fontSize: is_virtual ? '2rem' : '2.4rem', lineHeight: 1 }}>
            {fallback}
        </span>
    );
};

export const AccountSwitcherWalletMobile = observer(
    ({ is_visible, toggle }: TAccountSwitcherWalletMobile) => {
        const { data: wallet_list } = useStoreWalletAccountsList() || {};
        const { client } = useStore();
        const active_loginid = client?.loginid;
        const active_balance = client?.balance ?? '0';

        const closeDialog = () => toggle(false);

        // All dtrade-linked wallets (includes all currencies + demo)
        const allWallets = (wallet_list ?? []).filter(w => w.dtrade_loginid);

        const isActive = (w: (typeof allWallets)[number]) => {
            if (!w.dtrade_loginid) return false;
            return active_loginid === w.dtrade_loginid || active_loginid === w.loginid;
        };

        const getBalance = (w: (typeof allWallets)[number]) => {
            if (isActive(w)) return parseFloat(active_balance) || 0;
            return (w as unknown as { dtrade_balance?: number }).dtrade_balance ?? w.balance ?? 0;
        };

        const switchAccount = async (w: (typeof allWallets)[number]) => {
            if (isActive(w)) { closeDialog(); return; }

            const dtrade_id = w.dtrade_loginid ?? '';
            const account_list = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
            const token = account_list[dtrade_id] ?? localStorage.getItem('authToken');
            if (!token) { closeDialog(); return; }

            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', dtrade_id);
            Analytics.setAttributes({ account_type: dtrade_id.match(/[a-zA-Z]+/g)?.join('') ?? '' });
            await api_base?.init(true);
            closeDialog();

            const sp = new URLSearchParams(window.location.search);
            sp.set('account', w.is_virtual ? 'demo' : (w.currency ?? 'USD'));
            window.history.pushState({}, '', `${window.location.pathname}?${sp.toString()}`);
        };

        const handleManageFunds = () => {
            closeDialog();
            window.open('https://app.deriv.com/wallets', '_blank');
        };

        return (
            <MobileDialog
                portal_element_id='modal_root'
                visible={is_visible}
                onClose={closeDialog}
                has_close_icon
                title={<Localize i18n_default_text='Options accounts' />}
            >
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className='wallet-acct-list'>
                        {allWallets.map(w => {
                            const active = isActive(w);
                            const bal = getBalance(w);
                            const currency = w.currency ?? 'USD';
                            const display_code = getCurrencyDisplayCode(currency);
                            const wallet_name = w.is_virtual ? 'Demo Wallet' : `${currency} Wallet`;

                            return (
                                <button
                                    key={w.dtrade_loginid ?? w.loginid}
                                    className={`wallet-acct-row${active ? ' wallet-acct-row--active' : ''}`}
                                    onClick={() => switchAccount(w)}
                                >
                                    <div className='wallet-acct-row__icons'>
                                        {/* App icon (grid/options) in bottom-left */}
                                        <div className='wallet-acct-row__app-icon'>
                                            <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
                                                <rect x='0' y='0' width='5' height='5' rx='1' fill='#666' />
                                                <rect x='7' y='0' width='5' height='5' rx='1' fill='#666' />
                                                <rect x='0' y='7' width='5' height='5' rx='1' fill='#666' />
                                                <rect x='7' y='7' width='5' height='5' rx='1' fill='#666' />
                                            </svg>
                                        </div>
                                        {/* Wallet currency icon in top-right */}
                                        <div className='wallet-acct-row__wallet-icon'>
                                            <WalletCurrencyIcon
                                                icons={(w as unknown as { icons?: Record<string, string> }).icons}
                                                currency={currency}
                                                is_virtual={!!w.is_virtual}
                                            />
                                        </div>
                                    </div>

                                    <div className='wallet-acct-row__info'>
                                        <span className='wallet-acct-row__platform'>Options</span>
                                        <span className='wallet-acct-row__name'>{wallet_name}</span>
                                        <span className='wallet-acct-row__balance'>
                                            {formatMoney(currency, bal, true)} {display_code}
                                        </span>
                                    </div>

                                    {w.is_virtual && (
                                        <span className='wallet-acct-row__badge'>Demo</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div className='wallet-switcher-footer'>
                        <button className='wallet-switcher-footer__manage-btn' onClick={handleManageFunds}>
                            <Localize i18n_default_text='Manage funds' />
                        </button>
                        <p className='wallet-switcher-footer__cfd-link'>
                            <Localize i18n_default_text="Looking for CFDs? Go to Trader's Hub" />
                        </p>
                    </div>
                </div>
            </MobileDialog>
        );
    }
);
