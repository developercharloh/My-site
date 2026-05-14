import type { Moment } from 'moment';
import type ClientStore from '@/stores/client-store';
import type CommonStore from '@/stores/common-store';
import type DashboardStore from '@/stores/dashboard-store';
import type FlyoutStore from '@/stores/flyout-store';
import type LoadModalStore from '@/stores/load-modal-store';
import type RunPanelStore from '@/stores/run-panel-store';
import type SaveModalStore from '@/stores/save-modal-store';
import type ToolbarStore from '@/stores/toolbar-store';
import type UiStore from '@/stores/ui-store';
import type { ProposalOpenContract } from '@deriv/api-types';
import type { TWebSocket } from './ws.types';

export type TPortfolioPosition = {
    id?: number;
    contract_info: ProposalOpenContract;
    details?: string;
    display_name?: string;
    indicative?: number;
    payout?: number;
    purchase?: number;
    reference?: number;
    type?: string;
    is_loading?: boolean;
    is_sell_requested?: boolean;
    profit_loss?: number;
    [key: string]: unknown;
};

type TCommonStore = Omit<CommonStore, 'server_time'> & {
    server_time: Moment;
};

export type TStores = {
    client: ClientStore;
    ui: UiStore;
    common: TCommonStore;
    portfolio?: {
        positions: TPortfolioPosition[];
    };
};

export type TNotificationMessage = {
    key: string;
    header: React.ReactNode;
    message?: React.ReactNode;
    type: 'warning' | 'info' | 'success' | 'danger' | 'contract_sold' | 'announce';
    action?: {
        text: string;
        onClick: () => void;
    };
    platform?: string;
    is_persistent?: boolean;
    is_disposable?: boolean;
    should_show_again?: boolean;
    timeout?: number;
    timeoutMessage?: (remaining: number | string) => string;
    img_src?: string;
    img_alt?: string;
    className?: string;
    size?: 'small';
    cta_btn?: {
        text: string;
        onClick: () => void;
    };
};

export type TDbotStore = {
    client: TStores['client'];
    flyout: FlyoutStore;
    toolbar: ToolbarStore;
    save_modal: SaveModalStore;
    dashboard: DashboardStore;
    load_modal: LoadModalStore;
    run_panel: RunPanelStore;
    setLoading: (is_loading: boolean) => void;
    setContractUpdateConfig: (contract_update_config: unknown) => void;
    handleFileChange: (
        event: React.MouseEvent<Element, MouseEvent> | React.FormEvent<HTMLFormElement> | DragEvent,
        is_body?: boolean
    ) => boolean;
    is_mobile: boolean;
};

export type TApiHelpersStore = {
    server_time: TStores['common']['server_time'];
    ws: TWebSocket;
};
