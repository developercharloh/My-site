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

        const dtrade_wallets = (wallet_list ?? []).filter(w => w.dtrade_loginid && !w.is_dtrader_account_disabled);
        const real_account = dtrade_wallets.find(w => !w.is_virtual && w.currency === 'USD')
            ?? dtrade_wallets.find(w => !w.is_virtual);
        const demo_account = dtrade_wallets.find(w => !!w.is_virtual);

        const closeDialog = () => toggle(false);

        const switchAccount = async (loginId: number, isVirtual: boolean, currency: string) => {
            const account_list = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
            const token = account_list[loginId];
            if (!token) return;

            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', loginId.toString());
            const account_type = loginId.toString().match(/[a-zA-Z]+/g)?.join('') || '';
            Analytics.setAttributes({ account_type });
            await api_base?.init(true);
            closeDialog();

            const search_params = new URLSearchParams(window.location.search);
            const account_param = isVirtual ? 'demo' : currency;
            search_params.set('account', account_param);
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
                            className={`simple-acct-option ${real_account.dtrade_loginid === active_loginid ? 'simple-acct-option--active' : ''}`}
                            onClick={() => switchAccount(real_account.dtrade_loginid, false, real_account.currency ?? 'USD')}
                            role='button'
                        >
                            <span className='simple-acct-option__badge simple-acct-option__badge--real'>Real</span>
                            <div className='simple-acct-option__info'>
                                <span className='simple-acct-option__label'>Real Account</span>
                                <span className='simple-acct-option__balance'>
                                    {formatMoney(real_account.currency ?? 'USD', real_account.dtrade_balance || 0, true)}{' '}
                                    {getCurrencyDisplayCode(real_account.currency)}
                                </span>
                            </div>
                            {real_account.dtrade_loginid === active_loginid && (
                                <span className='simple-acct-option__check'>✓</span>
                            )}
                        </div>
                    )}
                    {demo_account && (
                        <div
                            className={`simple-acct-option simple-acct-option--demo-row ${demo_account.dtrade_loginid === active_loginid ? 'simple-acct-option--active' : ''}`}
                            onClick={() => switchAccount(demo_account.dtrade_loginid, true, demo_account.currency ?? 'USD')}
                            role='button'
                        >
                            <span className='simple-acct-option__badge simple-acct-option__badge--demo'>Demo</span>
                            <div className='simple-acct-option__info'>
                                <span className='simple-acct-option__label'>Demo Account</span>
                                <span className='simple-acct-option__balance simple-acct-option__balance--demo'>
                                    {formatMoney(demo_account.currency ?? 'USD', demo_account.dtrade_balance || 0, true)}{' '}
                                    {getCurrencyDisplayCode(demo_account.currency)}
                                </span>
                            </div>
                            {demo_account.dtrade_loginid === active_loginid && (
                                <span className='simple-acct-option__check'>✓</span>
                            )}
                        </div>
                    )}
                </div>
            </MobileDialog>
        );
    }
);
