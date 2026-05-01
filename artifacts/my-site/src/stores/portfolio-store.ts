import { action, makeObservable, observable, reaction } from 'mobx';
import { ProposalOpenContract } from '@deriv/api-types';
import { TPortfolioPosition, TStores } from '@/types/stores.types';
import RootStore from './root-store';

export default class PortfolioStore {
    root_store: RootStore;
    core: TStores;
    positions: TPortfolioPosition[] = [];
    disposeSwitchAccountListener?: () => void;

    constructor(root_store: RootStore, core: TStores) {
        this.root_store = root_store;
        this.core = core;

        makeObservable(this, {
            positions: observable,
            onBotContractEvent: action.bound,
            clear: action.bound,
        });

        this.disposeSwitchAccountListener = reaction(
            () => this.core?.client?.loginid,
            () => this.clear()
        );
    }

    onBotContractEvent(contract: ProposalOpenContract) {
        if (!contract?.contract_id) return;

        const next_position: TPortfolioPosition = {
            id: contract.contract_id,
            contract_info: contract,
        };

        const index = this.positions.findIndex(position => position.id === contract.contract_id);

        if (index === -1) {
            this.positions = [...this.positions, next_position];
        } else {
            const updated = this.positions.slice();
            updated[index] = {
                ...this.positions[index],
                ...next_position,
                contract_info: { ...this.positions[index].contract_info, ...contract },
            };
            this.positions = updated;
        }
    }

    clear() {
        this.positions = [];
    }
}
