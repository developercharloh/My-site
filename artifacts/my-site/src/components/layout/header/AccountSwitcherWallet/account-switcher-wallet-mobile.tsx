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

export const AccountSwitcherWalletMobile = observer(
    ({ is_visible, toggle }: TAccountSwitcherWalletMobile) => {
        const { data: wallet_list } = useStoreWalletAccountsList() || {};
        const { client } = useStore();
        const active_loginid = client?.loginid;
        const active_balance = client?.balance ?? '0';
        const active_currency = client?.currency ?? 'USD';

        const dtrade_wallets = (wallet_list ?? []).filter(w => w.dtrade_loginid && !w.is_dtrader_account_disabled);
        const real_account = dtrade_wallets.find(w => !w.is_virtual && w.currency === 'USD')
            ?? dtrade_wallets.find(w => !w.is_virtual);
        const demo_account = dtrade_wallets.find(w => !!w.is_virtual);

        const closeDialog = () => toggle(false);

        const isActive = (dtrade_loginid: string | undefined) => {
            if (!dtrade_loginid) return false;
            if (active_loginid === dtrade_loginid) return true;
            const wallet = (wallet_list ?? []).find(w => w.dtrade_loginid === dtrade_loginid);
            return wallet ? active_loginid === wallet.loginid : false;
        };

        const realIsActive = isActive(real_account?.dtrade_loginid);
        const demoIsActive = isActive(demo_account?.dtrade_loginid);

        const getDisplayBalance = (dtrade_loginid: string | undefined, dtrade_balance: number | undefined, currency: string | undefined) => {
            if (!dtrade_loginid) return 0;
            if (isActive(dtrade_loginid)) return parseFloat(active_balance) || 0;
            return dtrade_balance ?? 0;
        };

        const switchAccount = async (dtrade_loginid: string, isVirtual: boolean, currency: string) => {
            if (isActive(dtrade_loginid)) {
                closeDialog();
                return;
            }
            const account_list = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
            const token = account_list[dtrade_loginid] ?? localStorage.getItem('authToken');
            if (!token) { closeDialog(); return; }

            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', dtrade_loginid);
            Analytics.setAttributes({ account_type: dtrade_loginid.match(/[a-zA-Z]+/g)?.join('') ?? '' });
            await api_base?.init(true);
            closeDialog();

            const sp = new URLSearchParams(window.location.search);
            sp.set('account', isVirtual ? 'demo' : currency);
            window.history.pushState({}, '', `${window.location.pathname}?${sp.toString()}`);
        };

        return (
            <MobileDialog
                portal_element_id='modal_root'
                visible={is_visible}
                onClose={closeDialog}
                has_close_icon
                title={<Localize i18n_default_text='Switch Account' />}
            >
                <div className='wallet-switcher-list'>
                    {real_account && (
                        <div
                            className={`wallet-card${realIsActive ? ' wallet-card--active' : ''}`}
                            onClick={() => switchAccount(real_account.dtrade_loginid ?? '', false, real_account.currency ?? 'USD')}
                            role='button'
                        >
                            <div className='wallet-card__flag'>🇺🇸</div>
                            <div className='wallet-card__info'>
                                <div className='wallet-card__type'>Real Account</div>
                                <div className='wallet-card__balance'>
                                    {formatMoney(real_account.currency ?? 'USD', getDisplayBalance(real_account.dtrade_loginid, real_account.dtrade_balance, real_account.currency), true)}{' '}
                                    {getCurrencyDisplayCode(real_account.currency)}
                                </div>
                            </div>
                            <div className='wallet-card__right'>
                                {realIsActive && <span className='wallet-card__check'>✓</span>}
                                <div className='wallet-card__currency-badge wallet-card__currency-badge--real'>USD</div>
                            </div>
                        </div>
                    )}
                    {demo_account && (
                        <div
                            className={`wallet-card wallet-card--demo${demoIsActive ? ' wallet-card--active' : ''}`}
                            onClick={() => switchAccount(demo_account.dtrade_loginid ?? '', true, demo_account.currency ?? 'USD')}
                            role='button'
                        >
                            <div className='wallet-card__flag wallet-card__flag--demo'>🔵</div>
                            <div className='wallet-card__info'>
                                <div className='wallet-card__type'>Demo Account</div>
                                <div className='wallet-card__balance wallet-card__balance--demo'>
                                    {formatMoney(demo_account.currency ?? 'USD', getDisplayBalance(demo_account.dtrade_loginid, demo_account.dtrade_balance, demo_account.currency), true)}{' '}
                                    {getCurrencyDisplayCode(demo_account.currency)}
                                </div>
                            </div>
                            <div className='wallet-card__right'>
                                {demoIsActive && <span className='wallet-card__check'>✓</span>}
                                <div className='wallet-card__currency-badge wallet-card__currency-badge--demo'>Demo</div>
                            </div>
                        </div>
                    )}
                </div>
            </MobileDialog>
        );
    }
);
