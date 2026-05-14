import React from 'react';
import './cashier.scss';

const DEPOSIT_URL    = 'https://app.deriv.com/cashier/deposit';
const WITHDRAW_URL   = 'https://app.deriv.com/cashier/withdrawal';
const TRANSFER_URL   = 'https://app.deriv.com/cashier/account-transfer';
const PAYMENT_URL    = 'https://app.deriv.com/cashier/payment-agent';
const STATEMENT_URL  = 'https://app.deriv.com/reports/statement';

type Action = {
    id:        string;
    icon:      string;
    title:     string;
    blurb:     string;
    href:      string;
    accent:    string;        // gradient stop
    accent2:   string;        // gradient stop
};

const ACTIONS: Action[] = [
    {
        id:      'deposit',
        icon:    '💰',
        title:   'Deposit',
        blurb:   'Add funds to your account using cards, e-wallets, bank transfer or crypto.',
        href:    DEPOSIT_URL,
        accent:  '#10b981',
        accent2: '#059669',
    },
    {
        id:      'withdraw',
        icon:    '🏧',
        title:   'Withdraw',
        blurb:   'Cash out your profits to the same payment method you deposited with.',
        href:    WITHDRAW_URL,
        accent:  '#6366f1',
        accent2: '#4338ca',
    },
    {
        id:      'transfer',
        icon:    '🔄',
        title:   'Transfer between accounts',
        blurb:   'Move funds between your your wallets, MT5 and Deriv X accounts instantly.',
        href:    TRANSFER_URL,
        accent:  '#0ea5e9',
        accent2: '#0369a1',
    },
    {
        id:      'agents',
        icon:    '🤝',
        title:   'Payment agents',
        blurb:   'Deposit or withdraw through a local payment agent in your country.',
        href:    PAYMENT_URL,
        accent:  '#f59e0b',
        accent2: '#d97706',
    },
    {
        id:      'statement',
        icon:    '🧾',
        title:   'Statement',
        blurb:   'Review every transaction, contract result and balance change on your account.',
        href:    STATEMENT_URL,
        accent:  '#8b5cf6',
        accent2: '#6d28d9',
    },
];

const Cashier: React.FC = () => {
    const open = (href: string) => {
        window.open(href, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className='cashier'>
            <header className='cashier__head'>
                <span className='cashier__brand-emoji' aria-hidden='true'>💳</span>
                <div>
                    <h1 className='cashier__title'>Cashier</h1>
                    <p className='cashier__sub'>
                        Manage funds on your account — deposit, withdraw, transfer between accounts
                        and view your statement. All actions open in the cashier in a new tab.
                    </p>
                </div>
            </header>

            <div className='cashier__grid'>
                {ACTIONS.map(a => (
                    <button
                        key={a.id}
                        type='button'
                        className='cashier-card'
                        onClick={() => open(a.href)}
                        style={{
                            background: `linear-gradient(135deg, ${a.accent} 0%, ${a.accent2} 100%)`,
                        }}
                        aria-label={`${a.title} — opens in a new tab`}
                    >
                        <span className='cashier-card__icon' aria-hidden='true'>{a.icon}</span>
                        <span className='cashier-card__title'>{a.title}</span>
                        <span className='cashier-card__blurb'>{a.blurb}</span>
                        <span className='cashier-card__cta'>
                            Open <span aria-hidden='true'>↗</span>
                        </span>
                    </button>
                ))}
            </div>

            <section className='cashier__notice'>
                <span className='cashier__notice-icon' aria-hidden='true'>🔒</span>
                <p>
                    For your safety, all deposits and withdrawals are processed on Deriv's own
                    secure cashier (<strong>app.deriv.com</strong>). You may be asked to log in
                    again — that's normal. This site never sees your payment details.
                </p>
            </section>
        </div>
    );
};

export default Cashier;
