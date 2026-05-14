import React from 'react';
import useStoreWalletAccountsList from '@/hooks/useStoreWalletAccountsList';
import { AccountSwitcherWalletItem } from './account-switcher-wallet-item';
import './account-switcher-wallet-list.scss';

type TAccountSwitcherWalletListProps = {
    wallets: Exclude<ReturnType<typeof useStoreWalletAccountsList>['data'], undefined>;
    closeAccountsDialog: () => void;
};

export const AccountSwitcherWalletList = ({ wallets, closeAccountsDialog }: TAccountSwitcherWalletListProps) => {
    const sortedWallets = [...wallets].sort((a, b) => {
        // Remove commas from balance strings before converting to numbers
        const balanceA = Number((a.dtrade_balance ?? 0).toString().replace(/,/g, ''));
        const balanceB = Number((b.dtrade_balance ?? 0).toString().replace(/,/g, ''));
        return balanceB - balanceA;
    });
    return (
        <div className='account-switcher-wallet-list'>
            {sortedWallets?.map(account => {
                if (account.is_dtrader_account_disabled) return null;
                return (
                    <AccountSwitcherWalletItem
                        key={account.dtrade_loginid}
                        account={account}
                        closeAccountsDialog={closeAccountsDialog}
                        show_badge={account?.is_virtual}
                    />
                );
            })}
        </div>
    );
};
