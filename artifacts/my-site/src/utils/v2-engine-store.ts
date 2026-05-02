// ─── V2 Engine shared MobX store ──────────────────────────────────────────────
// Holds live V2 engine state so any component in the tree can observe it,
// particularly the dedicated "V2 Panel" tab page.

import { makeAutoObservable } from 'mobx';
import type { EngineLog, EngineStatus } from './deriv-v2-engine';

export interface V2Stats {
    profit: number;
    wins:   number;
    losses: number;
    stake:  number;
}

class V2EngineStore {
    status:  EngineStatus = 'idle';
    logs:    EngineLog[]  = [];
    stats:   V2Stats      = { profit: 0, wins: 0, losses: 0, stake: 0 };
    running: boolean      = false;

    private stopFn:  (() => void) | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    setStatus(s: EngineStatus): void {
        this.status  = s;
        this.running = s === 'connecting' || s === 'scanning' || s === 'trading';
    }

    pushLog(log: EngineLog): void {
        this.logs = [log, ...this.logs].slice(0, 200);
    }

    setStats(profit: number, wins: number, losses: number, stake: number): void {
        this.stats = { profit, wins, losses, stake };
    }

    clearLogs(): void {
        this.logs = [];
    }

    reset(initialStake = 0): void {
        this.status  = 'idle';
        this.logs    = [];
        this.stats   = { profit: 0, wins: 0, losses: 0, stake: initialStake };
        this.running = false;
    }

    bindStop(fn: () => void): void {
        this.stopFn = fn;
    }

    stop(): void {
        this.stopFn?.();
    }
}

export const v2EngineStore = new V2EngineStore();
