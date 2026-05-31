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
            // Match by dtrade loginid OR wallet loginid
            if (active_loginid === dtrade_loginid) return true;
            const wallet = (wallet_list ?? []).find(w => w.dtrade_loginid === dtrade_loginid);
            return wallet ? active_loginid === wallet.loginid : false;
        };

        const realIsActive = isActive(real_account?.dtrade_loginid);
        const demoIsActive = isActive(demo_account?.dtrade_loginid);

        const getBalance = (dtrade_loginid: string | undefined, dtrade_balance: number | undefined, currency: string | undefined) => {
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
            // Try dtrade loginid first, then fall back to current token
            const token = account_list[dtrade_loginid] ?? localStorage.getItem('authToken');
            if (!token) {
                closeDialog();
                return;
            }

            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', dtrade_loginid);
            const account_type = dtrade_loginid.match(/[a-zA-Z]+/g)?.join('') ?? '';
            Analytics.setAttributes({ account_type });
            await api_base?.init(true);
            closeDialog();

            const search_params = new URLSearchParams(window.location.search);
            search_params.set('account', isVirtual ? 'demo' : currency);
            window.history.pushState({}, '', `${window.location.pathname}?${search_params.toString()}`);
        };

        return (
            <MobileDialog
                portal_element_id='modal_root'
                visible={is_visible}
                onClose={closeDialog}
                has_close_icon
                title={<Localize i18n_default_text='Switch Account' />}
            >
                <div className='simple-acct-switcher'>
                    {real_account && (
                        <div
                            className={`simple-acct-option${realIsActive ? ' simple-acct-option--active' : ''}`}
                            onClick={() => switchAccount(real_account.dtrade_loginid ?? '', false, real_account.currency ?? 'USD')}
                            role='button'
                        >
                            <span className='simple-acct-option__badge simple-acct-option__badge--real'>🇺🇸</span>
                            <div className='simple-acct-option__info'>
                                <span className='simple-acct-option__label'>Real Account</span>
                                <span className='simple-acct-option__balance'>
                                    {formatMoney(real_account.currency ?? 'USD', getBalance(real_account.dtrade_loginid, real_account.dtrade_balance, real_account.currency), true)}{' '}
                                    {getCurrencyDisplayCode(real_account.currency)}
                                </span>
                            </div>
                            {realIsActive && <span className='simple-acct-option__check'>✓</span>}
                        </div>
                    )}
                    {demo_account && (
                        <div
                            className={`simple-acct-option simple-acct-option--demo-row${demoIsActive ? ' simple-acct-option--active' : ''}`}
                            onClick={() => switchAccount(demo_account.dtrade_loginid ?? '', true, demo_account.currency ?? 'USD')}
                            role='button'
                        >
                            <span className='simple-acct-option__badge simple-acct-option__badge--demo'>Demo</span>
                            <div className='simple-acct-option__info'>
                                <span className='simple-acct-option__label'>Demo Account</span>
                                <span className='simple-acct-option__balance simple-acct-option__balance--demo'>
                                    {formatMoney(demo_account.currency ?? 'USD', getBalance(demo_account.dtrade_loginid, demo_account.dtrade_balance, demo_account.currency), true)}{' '}
                                    {getCurrencyDisplayCode(demo_account.currency)}
                                </span>
                            </div>
                            {demoIsActive && <span className='simple-acct-option__check'>✓</span>}
                        </div>
                    )}
                </div>
            </MobileDialog>
        );
    }
);
