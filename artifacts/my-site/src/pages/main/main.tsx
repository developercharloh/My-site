import React, { lazy, Suspense, useEffect, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { useLocation, useNavigate } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import TabSkeleton from '@/components/loader/tab-skeleton';
import { v2EngineStore } from '@/utils/v2-engine-store';
import { initCustomBotV2Bridge } from '@/utils/custom-bot-v2-bridge';
import { generateOAuthURL } from '@/components/shared';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { handleOidcAuthFailure } from '@/utils/auth-utils';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import RunStrategy from '../dashboard/run-strategy';
import OnboardingTour from '@/components/onboarding-tour';
import PwaInstallPrompt from '@/components/pwa-install-prompt';
import TrustFooter from '@/components/trust-footer';
import './main.scss';

// Dashboard is the default tab so it loads on first paint, but at ~100KB+
// it still benefits from being a separate chunk so the initial JS bundle is
// smaller and other tabs can preload in parallel.
const Dashboard = lazy(() => import('../dashboard'));
const ChartWrapper = lazy(() => import('../chart/chart-wrapper'));
const FreeBots = lazy(() => import('../free-bots'));
const SignalEngine = lazy(() => import('../signal-engine'));
const EntryZone = lazy(() => import('../entry-zone'));
const SpeedBots = lazy(() => import('../speed-bots/speed-bots'));
const V2PanelTab = lazy(() => import('../v2-panel'));

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card } = useStore();
    const {
        active_tab,
        active_tour,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
        setWebSocketState,
        setActiveTour,
        setTourDialogVisibility,
    } = dashboard;
    const { dashboard_strategies } = load_modal;
    const {
        is_dialog_open,
        is_drawer_open,
        dialog_options,
        onCancelButtonClick,
        onCloseDialog,
        onOkButtonClick,
        stopBot,
    } = run_panel;
    const { is_open } = quick_strategy;
    const { cancel_button_text, ok_button_text, title, message, dismissable, is_closed_on_cancel } = dialog_options as {
        [key: string]: string;
    };
    const { clear } = summary_card;
    const { DASHBOARD, BOT_BUILDER } = DBOT_TABS;
    const init_render = React.useRef(true);
    const hash = ['dashboard', 'bot_builder', 'chart', 'tutorial', 'free_bots', 'analysis_tool', 'entry_zone', 'v2_panel'];
    const { isDesktop } = useDevice();
    const location = useLocation();
    const navigate = useNavigate();
    const [left_tab_shadow, setLeftTabShadow] = useState<boolean>(false);
    const [right_tab_shadow, setRightTabShadow] = useState<boolean>(false);

    // One-time init: subscribe the custom Speed Bot engines to the V2 store so
    // their stats and TP/SL alerts mirror into the V2 panel when V2 mode is on.
    useEffect(() => { initCustomBotV2Bridge(); }, []);

    let tab_value: number | string = active_tab;
    const GetHashedValue = (tab: number) => {
        tab_value = location.hash?.split('#')[1];
        if (!tab_value) return tab;
        return Number(hash.indexOf(String(tab_value)));
    };
    const active_hash_tab = GetHashedValue(active_tab);

    const { onRenderTMBCheck, isTmbEnabled } = useTMB();

    React.useEffect(() => {
        const el_dashboard = document.getElementById('id-dbot-dashboard');
        const el_tutorial = document.getElementById('id-tutorials');

        const observer_dashboard = new window.IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setLeftTabShadow(false);
                    return;
                }
                setLeftTabShadow(true);
            },
            {
                root: null,
                threshold: 0.5, // set offset 0.1 means trigger if atleast 10% of element in viewport
            }
        );

        const observer_tutorial = new window.IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setRightTabShadow(false);
                    return;
                }
                setRightTabShadow(true);
            },
            {
                root: null,
                threshold: 0.5, // set offset 0.1 means trigger if atleast 10% of element in viewport
            }
        );
        observer_dashboard.observe(el_dashboard);
        observer_tutorial.observe(el_tutorial);
    });

    React.useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
            if (is_bot_running) {
                clear();
                stopBot();
                api_base.setIsRunning(false);
                setWebSocketState(false);
            }
        }
    }, [clear, connectionStatus, setWebSocketState, stopBot]);

    // ── Global V2 autostart listener ──────────────────────────────────────────
    // Placed here (always mounted) so the Signal Engine tab can fire the event
    // even when RunPanel / TradeAnimation is hidden on mobile.
    const store = useStore();
    React.useEffect(() => {
        const handler = () => {
            setTimeout(() => {
                try {
                    const raw = localStorage.getItem('free_bots_v2_config');
                    if (!raw) return;
                    const cfg = JSON.parse(raw);
                    const currency = (store as any).client?.currency || 'USD';
                    const cfgWithCurrency = { ...cfg, currency };
                    v2EngineStore.start(cfgWithCurrency, {
                        run_panel:    run_panel as any,
                        transactions: (store as any).transactions,
                        journal:      (store as any).journal,
                        summary_card: summary_card as any,
                        setRunId:     (id: string) => runInAction(() => { (run_panel as any).run_id = id; }),
                    });
                    dashboard.setActiveTab(DBOT_TABS.V2_PANEL);
                } catch { /* ignore parse errors */ }
            }, 300);
        };
        window.addEventListener('deriv-v2-autostart', handler);
        return () => window.removeEventListener('deriv-v2-autostart', handler);
    }, [dashboard, run_panel, summary_card, store]);

    // Update tab shadows height to match bot builder height
    const updateTabShadowsHeight = () => {
        const botBuilderEl = document.getElementById('id-bot-builder');
        const leftShadow = document.querySelector('.tabs-shadow--left') as HTMLElement;
        const rightShadow = document.querySelector('.tabs-shadow--right') as HTMLElement;

        if (botBuilderEl && leftShadow && rightShadow) {
            const height = botBuilderEl.offsetHeight;
            leftShadow.style.height = `${height}px`;
            rightShadow.style.height = `${height}px`;
        }
    };

    React.useEffect(() => {
        // Run on mount and when active tab changes
        updateTabShadowsHeight();

        if (is_open) {
            setTourDialogVisibility(false);
        }

        if (init_render.current) {
            setActiveTab(Number(active_hash_tab));
            if (!isDesktop) handleTabChange(Number(active_hash_tab));
            init_render.current = false;
        } else {
            navigate(`#${hash[active_tab] || hash[0]}`);
        }
        if (active_tour !== '') {
            setActiveTour('');
        }

        // Prevent scrolling when tutorial tab is active (only on mobile)
        const mainElement = document.querySelector('.main__container');
        if (active_tab === DBOT_TABS.TUTORIAL && !isDesktop) {
            document.body.style.overflow = 'hidden';
            if (mainElement instanceof HTMLElement) {
                mainElement.classList.add('no-scroll');
            }
        } else {
            document.body.style.overflow = '';
            if (mainElement instanceof HTMLElement) {
                mainElement.classList.remove('no-scroll');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab]);

    React.useEffect(() => {
        const trashcan_init_id = setTimeout(() => {
            if (active_tab === BOT_BUILDER && Blockly?.derivWorkspace?.trashcan) {
                const trashcanY = window.innerHeight - 250;
                let trashcanX;
                if (is_drawer_open) {
                    trashcanX = isDbotRTL() ? 380 : window.innerWidth - 460;
                } else {
                    trashcanX = isDbotRTL() ? 20 : window.innerWidth - 100;
                }
                Blockly?.derivWorkspace?.trashcan?.setTrashcanPosition(trashcanX, trashcanY);
            }
        }, 100);

        return () => {
            clearTimeout(trashcan_init_id); // Clear the timeout on unmount
        };
        //eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab, is_drawer_open]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (dashboard_strategies.length > 0) {
            // Needed to pass this to the Callback Queue as on tab changes
            // document title getting override by 'Bot | Deriv' only
            timer = setTimeout(() => {
                updateWorkspaceName();
            });
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [dashboard_strategies, active_tab]);

    const handleTabChange = React.useCallback(
        (tab_index: number) => {
            setActiveTab(tab_index);
            const el_id = TAB_IDS[tab_index];
            if (el_id) {
                const el_tab = document.getElementById(el_id);
                setTimeout(() => {
                    el_tab?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                }, 10);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [active_tab]
    );

    const { isOAuth2Enabled } = useOauth2();
    const handleLoginGeneration = async () => {
        if (!isOAuth2Enabled) {
            window.location.replace(generateOAuthURL());
        } else {
            const getQueryParams = new URLSearchParams(window.location.search);
            const currency = getQueryParams.get('account') ?? '';
            const query_param_currency = currency || sessionStorage.getItem('query_param_currency') || 'USD';

            try {
                // First, explicitly wait for TMB status to be determined
                const tmbEnabled = await isTmbEnabled();
                // Now use the result of the explicit check
                if (tmbEnabled) {
                    await onRenderTMBCheck();
                } else {
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
                    }
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(error);
            }
        }
    };
    return (
        <React.Fragment>
            <div className='main'>
                <div
                    className={classNames('main__container', {
                        'main__container--active': active_tour && active_tab === DASHBOARD && !isDesktop,
                    })}
                >
                    <div>
                        {!isDesktop && left_tab_shadow && <span className='tabs-shadow tabs-shadow--left' />}{' '}
                        <Tabs active_index={active_tab} className='main__tabs' onTabItemClick={handleTabChange} top>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>🏠</span>
                                        <Localize i18n_default_text='Dashboard' />
                                    </>
                                }
                                id='id-dbot-dashboard'
                            >
                                <Suspense fallback={<TabSkeleton variant='dashboard' label={localize('Loading dashboard…')} />}>
                                    <Dashboard handleTabChange={handleTabChange} />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>⚙️🤖</span>
                                        <Localize i18n_default_text='Bot Builder' />
                                    </>
                                }
                                id='id-bot-builder'
                            />
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>📊</span>
                                        <Localize i18n_default_text='Charts / TradingView' />
                                    </>
                                }
                                id={
                                    is_chart_modal_visible || is_trading_view_modal_visible
                                        ? 'id-charts--disabled'
                                        : 'id-charts'
                                }
                            >
                                <Suspense
                                    fallback={<TabSkeleton variant='chart' label={localize('Please wait, loading chart...')} />}
                                >
                                    <ChartWrapper show_digits_stats={false} />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>⚡</span>
                                        <Localize i18n_default_text='Speed Bots' />
                                    </>
                                }
                                id='id-tutorials'
                            >
                                <Suspense
                                    fallback={<TabSkeleton variant='cards' label={localize('Loading Speed Bot...')} />}
                                >
                                    <SpeedBots />
                                </Suspense>
                            </div>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>🎁</span>
                                        <Localize i18n_default_text='Free Bots' />
                                    </>
                                }
                                id='id-free-bots'
                            >
                                <div className='free-bots-wrapper'>
                                    <Suspense
                                        fallback={
                                            <TabSkeleton variant='cards' label={localize('Please wait, loading free bots...')} />
                                        }
                                    >
                                        <FreeBots />
                                    </Suspense>
                                </div>
                            </div>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>🔍📊</span>
                                        <Localize i18n_default_text='Signal Engine' />
                                    </>
                                }
                                id='id-analysis-tool'
                            >
                                <div className='analysis-tool-wrapper'>
                                    <Suspense
                                        fallback={
                                            <TabSkeleton variant='chart' label={localize('Please wait, loading Signal Engine...')} />
                                        }
                                    >
                                        <SignalEngine />
                                    </Suspense>
                                </div>
                            </div>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>🎯</span>
                                        <Localize i18n_default_text='Entry Zone' />
                                    </>
                                }
                                id='id-entry-zone'
                            >
                                <div className='entry-zone-wrapper'>
                                    <Suspense
                                        fallback={
                                            <TabSkeleton variant='list' label={localize('Please wait, loading Entry Zone...')} />
                                        }
                                    >
                                        <EntryZone />
                                    </Suspense>
                                </div>
                            </div>
                            <div
                                label={
                                    <>
                                        <span className='tab-emoji' role='img' aria-hidden='true'>⚡</span>
                                        <Localize i18n_default_text='V2 Panel' />
                                    </>
                                }
                                id='id-v2-panel'
                            >
                                <Suspense
                                    fallback={
                                        <TabSkeleton variant='panel' label={localize('Loading V2 Panel...')} />
                                    }
                                >
                                    <V2PanelTab />
                                </Suspense>
                            </div>
                        </Tabs>
                        {!isDesktop && right_tab_shadow && <span className='tabs-shadow tabs-shadow--right' />}{' '}
                    </div>
                </div>
            </div>
            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    <RunPanel />
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>
            <MobileWrapper>
                {!is_open && active_tab !== DBOT_TABS.SPEED_BOTS && active_tab !== DBOT_TABS.ANALYSIS_TOOL && active_tab !== DBOT_TABS.V2_PANEL && <RunPanel />}
            </MobileWrapper>
            <Dialog
                cancel_button_text={cancel_button_text || localize('Cancel')}
                className='dc-dialog__wrapper--fixed'
                confirm_button_text={ok_button_text || localize('Ok')}
                has_close_icon
                is_mobile_full_width={false}
                is_visible={is_dialog_open}
                onCancel={onCancelButtonClick}
                onClose={onCloseDialog}
                onConfirm={onOkButtonClick || onCloseDialog}
                portal_element_id='modal_root'
                title={title}
                login={handleLoginGeneration}
                dismissable={dismissable} // Prevents closing on outside clicks
                is_closed_on_cancel={is_closed_on_cancel}
            >
                {message}
            </Dialog>
            <TrustFooter />
            <PwaInstallPrompt />
            <OnboardingTour />
        </React.Fragment>
    );
});

export default AppWrapper;
