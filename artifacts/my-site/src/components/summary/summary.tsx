import classnames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import ThemedScrollbars from '../shared_ui/themed-scrollbars';
import SummaryCard from './summary-card';

type TSummary = {
    is_drawer_open: boolean;
};

const Summary = observer(({ is_drawer_open }: TSummary) => {
    const { dashboard, summary_card, run_panel } = useStore();
    const { is_contract_loading, contract_info, is_bot_running } = summary_card;
    const { active_tour } = dashboard;
    const { is_running, virtual_phase } = run_panel;
    const { isDesktop } = useDevice();
    const show_phase_badge = virtual_phase !== 'idle';
    return (
        <div
            className={classnames({
                'run-panel-tab__content': isDesktop,
                'run-panel-tab__content--mobile': !isDesktop && is_drawer_open,
                'run-panel-tab__content--summary-tab': (isDesktop && is_drawer_open) || active_tour,
            })}
            data-testid='mock-summary'
        >
            {show_phase_badge && (
                <div
                    className={classnames('summary__virtual-phase-badge', {
                        'summary__virtual-phase-badge--virtual': virtual_phase === 'virtual',
                        'summary__virtual-phase-badge--real': virtual_phase === 'real_recovery',
                    })}
                    data-testid='dt_virtual_phase_badge'
                >
                    <span className='summary__virtual-phase-badge-dot' />
                    <span className='summary__virtual-phase-badge-label'>
                        {virtual_phase === 'virtual' ? localize('Virtual Phase') : localize('Real Trade')}
                    </span>
                </div>
            )}
            <ThemedScrollbars
                className={classnames({
                    summary: (!is_contract_loading && !contract_info) || is_bot_running,
                    'summary--loading':
                        (!isDesktop && is_contract_loading) || (!isDesktop && !is_contract_loading && contract_info),
                })}
            >
                <SummaryCard
                    is_contract_loading={is_contract_loading}
                    contract_info={contract_info}
                    is_bot_running={is_bot_running}
                />
            </ThemedScrollbars>
        </div>
    );
});

export default Summary;
