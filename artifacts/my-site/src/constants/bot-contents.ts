type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    DTRADER: 3,
    SPEED_BOTS: 4,
    TUTORIAL: 4,
    FREE_BOTS: 5,
    ANALYSIS_TOOL: 6,
    ENTRY_ZONE: 7,
    V2_PANEL: 8,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-dtrader',
    'id-tutorials',
    'id-free-bots',
    'id-analysis-tool',
    'id-entry-zone',
    'id-v2-panel',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
