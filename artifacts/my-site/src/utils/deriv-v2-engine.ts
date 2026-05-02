// ─── Deriv V2 Direct Engine ───────────────────────────────────────────────────
// Connects directly to Deriv's WebSocket API and executes trades with
// near-zero overhead. Bypasses DBot's XML/Blockly processing pipeline.

export type EngineLogType = 'scan' | 'info' | 'win' | 'loss' | 'error' | 'system';

export interface EngineLog {
    time:    string;
    message: string;
    type:    EngineLogType;
}

export type EngineStatus =
    | 'idle'
    | 'connecting'
    | 'scanning'
    | 'trading'
    | 'stopped'
    | 'error';

export type ContractKind =
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITOVER'
    | 'DIGITUNDER';

export type TradeDirection = 'EVEN' | 'ODD' | 'OVER' | 'UNDER';

export interface V2BotConfig {
    symbol:          string;        // e.g. '1HZ75V', 'R_100'
    contractKind:    ContractKind;  // base contract type (direction may override)
    direction?:      TradeDirection;// for EVEN/ODD and OVER/UNDER bots
    prediction?:     number;        // for DIGITMATCH / DIGITDIFF
    barrier?:        number;        // for DIGITOVER / DIGITUNDER
    entryPoint:      number;        // digit 0-9 to scan for before entering
    initialStake:    number;        // starting stake in USD
    martingale:      number;        // multiplier on loss (e.g. 2.0)
    martingaleLevel: number;        // max consecutive losses before stopping
    takeProfit:      number;        // cumulative $ profit to stop at
    stopLoss:        number;        // cumulative $ loss to stop at
}

const APP_ID = 1089;
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

export class DerivV2Engine {
    private ws:                  WebSocket | null = null;
    private token:               string;
    private config:              V2BotConfig;
    private reqId:               number = 1;
    private isRunning:           boolean = false;
    private waitingForContract:  boolean = false;
    private tradingMode:         0 | 1 = 0;   // 0 = scan, 1 = trade immediately
    private currentStake:        number;
    private lossCount:           number = 1;
    private totalProfit:         number = 0;
    private wins:                number = 0;
    private losses:              number = 0;

    public onLog:    (log: EngineLog)                                     => void = () => {};
    public onProfit: (profit: number, wins: number, losses: number)       => void = () => {};
    public onStatus: (status: EngineStatus)                               => void = () => {};

    constructor(token: string, config: V2BotConfig) {
        this.token        = token;
        this.config       = config;
        this.currentStake = config.initialStake;
    }

    // ── Public ────────────────────────────────────────────────────────────────

    start(): void {
        if (this.isRunning) return;
        this.isRunning         = true;
        this.tradingMode       = 0;
        this.currentStake      = this.config.initialStake;
        this.lossCount         = 1;
        this.totalProfit       = 0;
        this.wins              = 0;
        this.losses            = 0;
        this.waitingForContract = false;
        this.connect();
    }

    stop(): void {
        this.isRunning = false;
        this.disconnect();
        this.onStatus('stopped');
        this.addLog('Engine stopped.', 'system');
    }

    // ── Private — networking ──────────────────────────────────────────────────

    private connect(): void {
        this.onStatus('connecting');
        this.addLog('Connecting to Deriv API…', 'system');
        const ws = new WebSocket(WS_URL);
        this.ws  = ws;

        ws.onopen = () => {
            this.addLog('Connected — authenticating…', 'system');
            this.send({ authorize: this.token });
        };

        ws.onmessage = (evt: MessageEvent) => {
            try { this.handle(JSON.parse(evt.data as string)); } catch { /* ignore */ }
        };

        ws.onerror = () => {
            this.addLog('WebSocket error', 'error');
            this.onStatus('error');
        };

        ws.onclose = () => {
            if (this.isRunning) {
                this.addLog('Connection lost — reconnecting in 3 s…', 'system');
                setTimeout(() => { if (this.isRunning) this.connect(); }, 3000);
            }
        };
    }

    private disconnect(): void {
        if (!this.ws) return;
        const ws     = this.ws;
        this.ws      = null;
        ws.onopen    = null;
        ws.onmessage = null;
        ws.onerror   = null;
        ws.onclose   = null;
        try { ws.close(); } catch { /* ignore */ }
    }

    private send(payload: Record<string, unknown>): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ req_id: this.reqId++, ...payload }));
        }
    }

    // ── Private — message routing ─────────────────────────────────────────────

    private handle(msg: Record<string, any>): void {
        if (msg.error) {
            this.addLog(`API error: ${msg.error.message}`, 'error');
            if (msg.msg_type === 'authorize') {
                this.isRunning = false;
                this.onStatus('error');
            }
            // On failed buy — release lock so engine can retry on next tick
            if (msg.msg_type === 'buy') {
                this.waitingForContract = false;
            }
            return;
        }

        switch (msg.msg_type) {
            case 'authorize':
                this.handleAuthorize(msg.authorize);
                break;
            case 'tick':
                if (this.isRunning && !this.waitingForContract) {
                    this.handleTick(msg.tick);
                }
                break;
            case 'buy':
                this.handleBuyAck(msg.buy);
                break;
            case 'proposal_open_contract':
                this.handleContract(msg.proposal_open_contract);
                break;
        }
    }

    private handleAuthorize(auth: Record<string, any>): void {
        this.addLog(
            `Authorized ✓  ${auth.loginid}  |  Balance: ${auth.currency} ${parseFloat(auth.balance).toFixed(2)}`,
            'system',
        );
        this.onStatus('scanning');
        this.send({ ticks: this.config.symbol, subscribe: 1 });
    }

    private handleTick(tick: { quote: number }): void {
        const digit = this.lastDigit(tick.quote);

        if (this.tradingMode === 0) {
            // Scanning mode — show journal on every tick
            this.addLog(
                `Last digit: ${digit}  |  Entry: ${this.config.entryPoint}`,
                'scan',
            );
            if (digit === this.config.entryPoint) {
                this.tradingMode = 1;
                this.addLog('Entry point hit — buying contract immediately', 'info');
                this.buy();
            }
        }
        // In trading mode, buys are triggered by contract settlement, not ticks
    }

    private handleBuyAck(buy: Record<string, any>): void {
        if (!buy) {
            this.addLog('Buy acknowledgement missing — retrying on next tick', 'error');
            this.waitingForContract = false;
            return;
        }
        this.addLog(
            `Contract #${buy.contract_id} purchased  stake $${this.currentStake.toFixed(2)}`,
            'info',
        );
        // Subscribe for settlement
        this.send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
    }

    private handleContract(poc: Record<string, any>): void {
        if (!poc?.is_sold) return;   // not settled yet

        // Forget this subscription
        if (poc.id) this.send({ forget: poc.id });

        this.waitingForContract = false;

        const profit = parseFloat(poc.profit ?? '0');
        const isWin  = poc.status === 'won';
        this.totalProfit += profit;

        if (isWin) {
            this.wins++;
            this.addLog(
                `WIN  +$${Math.abs(profit).toFixed(2)}  |  P&L: ${this.pnlStr()}`,
                'win',
            );
            this.currentStake = this.config.initialStake;
            this.lossCount    = 1;

            if (this.totalProfit >= this.config.takeProfit) {
                this.addLog(`Take Profit $${this.config.takeProfit.toFixed(2)} reached — stopping`, 'system');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop();
                return;
            }
        } else {
            this.losses++;
            this.addLog(
                `LOSS -$${Math.abs(profit).toFixed(2)}  |  P&L: ${this.pnlStr()}`,
                'loss',
            );

            if (this.totalProfit <= -this.config.stopLoss) {
                this.addLog(`Stop Loss $${this.config.stopLoss.toFixed(2)} reached — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop();
                return;
            }
            if (this.lossCount >= this.config.martingaleLevel) {
                this.addLog(`Max ${this.config.martingaleLevel} consecutive losses — stopping`, 'error');
                this.onProfit(this.totalProfit, this.wins, this.losses);
                this.stop();
                return;
            }

            this.currentStake = parseFloat((this.currentStake * this.config.martingale).toFixed(2));
            this.lossCount++;
        }

        this.onProfit(this.totalProfit, this.wins, this.losses);
        this.onStatus('trading');

        // Re-buy IMMEDIATELY — no waiting for next tick
        if (this.isRunning) this.buy();
    }

    // ── Private — trading ─────────────────────────────────────────────────────

    private buy(): void {
        if (!this.isRunning) return;
        this.waitingForContract = true;

        const ct = this.resolveContractType();

        const params: Record<string, unknown> = {
            amount:        this.currentStake,
            basis:         'stake',
            contract_type: ct,
            currency:      'USD',
            duration:      1,
            duration_unit: 't',
            symbol:        this.config.symbol,
        };

        if (ct === 'DIGITMATCH' || ct === 'DIGITDIFF') {
            params.prediction = this.config.prediction ?? this.config.entryPoint;
        }
        if (ct === 'DIGITOVER' || ct === 'DIGITUNDER') {
            params.barrier = String(this.config.barrier ?? this.config.entryPoint);
        }

        this.send({ buy: 1, price: this.currentStake, parameters: params });
    }

    private resolveContractType(): string {
        const { contractKind, direction } = this.config;
        if (contractKind === 'DIGITEVEN' || contractKind === 'DIGITODD') {
            return direction === 'ODD' ? 'DIGITODD' : 'DIGITEVEN';
        }
        if (contractKind === 'DIGITOVER' || contractKind === 'DIGITUNDER') {
            return direction === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
        }
        return contractKind;
    }

    // ── Private — helpers ─────────────────────────────────────────────────────

    private lastDigit(quote: number): number {
        // Parse from string to avoid floating-point rounding errors
        const s = quote.toString().replace(/^.*\./, ''); // decimal part only
        return parseInt(s[s.length - 1] ?? '0', 10);
    }

    private pnlStr(): string {
        const sign = this.totalProfit >= 0 ? '+' : '';
        return `${sign}$${this.totalProfit.toFixed(2)}`;
    }

    private addLog(message: string, type: EngineLogType): void {
        const now  = new Date();
        const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => n.toString().padStart(2, '0'))
            .join(':');
        this.onLog({ time, message, type });
    }
}
