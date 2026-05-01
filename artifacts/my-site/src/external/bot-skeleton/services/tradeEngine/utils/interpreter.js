import { isMultiplierContract } from '@/components/shared';
import cloneThorough from '@/utils/clone';
import JSInterpreter from '@deriv/js-interpreter';
import { unrecoverable_errors } from '../../../constants/messages';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import Interface from '../Interface';
import { createScope } from './cliTools';

JSInterpreter.prototype.takeStateSnapshot = function () {
    const newStateStack = cloneThorough(this.stateStack, undefined, undefined, undefined, true);
    return newStateStack;
};

JSInterpreter.prototype.restoreStateSnapshot = function (snapshot) {
    this.stateStack = cloneThorough(snapshot, undefined, undefined, undefined, true);
    this.global = this.stateStack[0].scope.object || this.stateStack[0].scope;
    this.initFunc_(this, this.global);
};

const botInitialized = bot => bot && bot.tradeEngine.options;
const botStarted = bot => botInitialized(bot) && bot.tradeEngine.tradeOptions;
const shouldRestartOnError = (bot, errorName = '') =>
    !unrecoverable_errors.includes(errorName) && botInitialized(bot) && bot.tradeEngine.options.shouldRestartOnError;

const shouldStopOnError = (bot, errorName = '') => {
    const stopErrors = ['SellNotAvailableCustom', 'ContractCreationFailure', 'InvalidtoBuy'];
    if (stopErrors.includes(errorName) && botInitialized(bot)) {
        return true;
    }
    return false;
};

const timeMachineEnabled = bot => botInitialized(bot) && bot.tradeEngine.options.timeMachineEnabled;

// TODO chek beforState & duringState & startState
const Interpreter = () => {
    let $scope = createScope();
    let bot = Interface($scope);
    let interpreter = {};
    let onFinish;

    $scope.observer.register('REVERT', watchName =>
        revert(watchName === 'before' ? $scope.beforeState : $scope.duringState)
    );

    function init() {
        $scope = createScope();
        bot = Interface($scope);
        interpreter = {};
        onFinish = () => {};
    }

    function revert(state) {
        interpreter.restoreStateSnapshot(state);
        interpreter.paused_ = false;
        loop();
    }

    function loop() {
        if ($scope.stopped || !interpreter.run()) {
            onFinish(interpreter.pseudoToNative(interpreter.value));
        }
    }

    function createAsync(js_interpreter, func) {
        const asyncFunc = (...args) => {
            const callback = args.pop();

            // Workaround for unknown number of args
            const reversed_args = args.slice().reverse();
            const first_defined_arg_idx = reversed_args.findIndex(arg => arg !== undefined);

            // Remove extra undefined args from end of the args
            const function_args = first_defined_arg_idx < 0 ? [] : reversed_args.slice(first_defined_arg_idx).reverse();
            // End of workaround

            func(...function_args.map(arg => js_interpreter.pseudoToNative(arg)))
                .then(rv => {
                    callback(js_interpreter.nativeToPseudo(rv));
                    loop();
                })
                .catch(e => {
                    // e.error for errors get from API, e for code errors
                    $scope.observer.emit('Error', e.error || e);
                });
        };

        // TODO: This is a workaround, create issue on original repo, once fixed
        // remove this. We don't know how many args are going to be passed, so we
        // assume a max of 100.
        const MAX_ACCEPTABLE_FUNC_ARGS = 100;
        Object.defineProperty(asyncFunc, 'length', { value: MAX_ACCEPTABLE_FUNC_ARGS + 1 });
        return js_interpreter.createAsyncFunction(asyncFunc);
    }

    function initFunc(js_interpreter, scope) {
        const bot_interface = bot.getInterface();
        const { getTicksInterface, alert, prompt, sleep, console: custom_console } = bot_interface;
        const ticks_interface = getTicksInterface;

        js_interpreter.setProperty(scope, 'console', js_interpreter.nativeToPseudo(custom_console));
        js_interpreter.setProperty(scope, 'alert', js_interpreter.nativeToPseudo(alert));
        js_interpreter.setProperty(scope, 'prompt', js_interpreter.nativeToPseudo(prompt));
        js_interpreter.setProperty(
            scope,
            'getPurchaseReference',
            js_interpreter.nativeToPseudo(bot_interface.getPurchaseReference)
        );

        const pseudo_bot_interface = js_interpreter.nativeToPseudo(bot_interface);

        Object.entries(ticks_interface).forEach(([name, f]) =>
            js_interpreter.setProperty(pseudo_bot_interface, name, createAsync(js_interpreter, f))
        );

        js_interpreter.setProperty(
            pseudo_bot_interface,
            'start',
            js_interpreter.nativeToPseudo((...args) => {
                const { start } = bot_interface;
                if (shouldRestartOnError(bot)) {
                    $scope.startState = js_interpreter.takeStateSnapshot();
                }
                start(...args);
            })
        );

        js_interpreter.setProperty(
            pseudo_bot_interface,
            'purchase',
            createAsync(js_interpreter, contractType => {
                // Normal (non-VH) purchase — reset to idle so the badge clears
                // and inVirtualPhase is definitively false for after_purchase guard.
                setVirtualPhase('idle');
                return bot_interface.purchase(contractType);
            })
        );
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'sellAtMarket',
            createAsync(js_interpreter, bot_interface.sellAtMarket)
        );

        // Virtual Hook state — shared across all blocks in a single bot run
        const vhState = {
            enabled: false, maxSteps: 2, minTrades: 1,
            inVirtualPhase: false,
            _phase: 'idle',          // tracks the 3-state UI phase for setVirtualPhase helper
            lockedSignal: null,      // Direction locked on VH activation (DIGITEVEN or DIGITODD)
            lastSignal: null,        // Last signal evaluated (DIGITEVEN or DIGITODD)
            consecutiveLosses: 0,    // Consecutive virtual losses on the same signal
            virtualTradeCount: 0,
            // Stake management — keeps VH filler trades at base cost
            martingale: 2,       // Martingale multiplier (updated by vhNormalPurchase)
            baseAmount: 0,       // Stake used for normal DIGITOVER trades (saved on first real trade)
            recoveryStake: 0,    // Accumulating recovery stake; multiplied each time real trade fires
            // Phase 4b — repeat mode: keep buying same EVEN/ODD direction after real loss
            repeatMode: false,
            repeatContractType: null,
            lastRealContractType: null,
            repeatCount: 0,         // tracks how many Phase 4b retries have occurred
        };

        // Helper: update vhState.inVirtualPhase and notify the UI with an explicit
        // 3-state phase value: 'idle' | 'virtual' | 'real_recovery'
        //   'idle'          — normal trading, recovery mode is off
        //   'virtual'       — filler / monitoring trades (inVirtualPhase=true)
        //   'real_recovery' — firing an actual recovery or Phase 4b trade
        const setVirtualPhase = phase => {
            const newInVirtual = phase === 'virtual';
            if (vhState._phase === phase) return;
            vhState._phase = phase;
            vhState.inVirtualPhase = newInVirtual;
            globalObserver.emit('bot.virtual_phase', { phase });
        };

        // isResult override — returns false during virtual phase so filler trades
        // never trigger win/loss logic in after_purchase
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'isResult',
            js_interpreter.nativeToPseudo(result => {
                if (vhState.inVirtualPhase) return false;
                return bot_interface.isResult(result);
            })
        );

        // Kept for backward-compat with XML Fixed Variables procedure
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'enableVirtualHook',
            js_interpreter.nativeToPseudo(mode => {
                vhState.enabled = mode === 'enable';
            })
        );
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'setVhMaxSteps',
            js_interpreter.nativeToPseudo(steps => { vhState.maxSteps = Number(steps) || 1; })
        );
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'setVhMinTrades',
            js_interpreter.nativeToPseudo(trades => { vhState.minTrades = Number(trades) || 1; })
        );

        // Returns true when the bot is running virtual trades (before real recovery trade)
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'isInVirtualPhase',
            js_interpreter.nativeToPseudo(() => vhState.inVirtualPhase)
        );

        // Even/Odd analysis — kept for backward-compat
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'getEvenOddPercentage',
            createAsync(js_interpreter, async (analysisType, n) => {
                const digits = await ticks_interface.getLastDigitList();
                const count = Math.max(1, Math.abs(Number(n) || 30));
                const lastN = Array.isArray(digits) ? digits.slice(-count) : [];
                if (!lastN.length) return 50;
                const evenCount = lastN.filter(d => Number(d) % 2 === 0).length;
                if (analysisType === 'EVEN_PERCENTAGE') return (evenCount / lastN.length) * 100;
                return ((lastN.length - evenCount) / lastN.length) * 100;
            })
        );

        // ── lastDigitsCondition ───────────────────────────────────────────────
        // Used by last_digits_condition block. Checks if ALL of the last N
        // price digits satisfy the condition (LESS_OR_EQUAL / GREATER_OR_EQUAL)
        // against compareValue. Returns a boolean.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'lastDigitsCondition',
            createAsync(js_interpreter, async (condition, n, compareValue) => {
                const digits = await ticks_interface.getLastDigitList();
                const count = Math.max(1, Math.abs(Number(n) || 1));
                const lastN = Array.isArray(digits) ? digits.slice(-count) : [];
                if (!lastN.length) return false;
                const cv = Number(compareValue);
                if (condition === 'LESS_OR_EQUAL') {
                    return lastN.every(d => Number(d) <= cv);
                }
                if (condition === 'GREATER_OR_EQUAL') {
                    return lastN.every(d => Number(d) >= cv);
                }
                return false;
            })
        );

        // ── Volatility Viper ──────────────────────────────────────────────────
        // Shared state for the Volatility Viper bot. Resets each time viperTrade
        // is called with baseStake for the first time in a bot run.
        const viperState = {
            mode: 'IDLE',               // IDLE | OVER2 | UNDER7 | RECOVERY_OVER4 | RECOVERY_UNDER5
            baseStake: 0,               // Set from first viperTrade call
            currentStake: 0,
            martingaleFactor: 2.1,
            recoveryCount: 0,
            lastMainMode: 'OVER2',      // Which direction triggered before recovery
        };

        // Bot.viperTrade(baseStake, martingaleFactor) — before_purchase handler.
        // Checks digit frequency over last 1000 ticks for Over 2 / Under 7 conditions,
        // waits for 2-consecutive-digit entry trigger, trades in streak until a loss,
        // then enters Martingale recovery with Over 4 / Under 5.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'viperTrade',
            createAsync(js_interpreter, async (baseStake, martingaleFactor) => {
                const bs = +(Number(baseStake) || 0.35).toFixed(2);
                const mf = Number(martingaleFactor) || 2.1;

                // Initialize stake on first call
                if (viperState.baseStake === 0) {
                    viperState.baseStake = bs;
                    viperState.currentStake = bs;
                }
                viperState.martingaleFactor = mf;
                if (viperState.currentStake === 0) viperState.currentStake = viperState.baseStake;

                const setStake = amount => {
                    if (bot.tradeEngine.tradeOptions) {
                        bot.tradeEngine.tradeOptions = {
                            ...bot.tradeEngine.tradeOptions,
                            amount: +(Number(amount).toFixed(2)),
                        };
                    }
                };
                const setPred = prediction => {
                    if (bot.tradeEngine.tradeOptions) {
                        bot.tradeEngine.tradeOptions = {
                            ...bot.tradeEngine.tradeOptions,
                            prediction,
                        };
                    }
                };

                // ── Active recovery: keep Martingaling until win ──────────────────
                if (viperState.mode === 'RECOVERY_OVER4') {
                    setStake(viperState.currentStake);
                    setPred(4);
                    setVirtualPhase('real_recovery');
                    globalObserver.emit('ui.log.warn',
                        `🐍 Viper RECOVERY Over 4 @ $${viperState.currentStake.toFixed(2)}`);
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }
                if (viperState.mode === 'RECOVERY_UNDER5') {
                    setStake(viperState.currentStake);
                    setPred(5);
                    setVirtualPhase('real_recovery');
                    globalObserver.emit('ui.log.warn',
                        `🐍 Viper RECOVERY Under 5 @ $${viperState.currentStake.toFixed(2)}`);
                    await bot_interface.purchase('DIGITUNDER');
                    return;
                }

                // ── Active streak: keep trading same direction until loss ─────────
                if (viperState.mode === 'OVER2') {
                    setStake(viperState.baseStake);
                    setPred(2);
                    setVirtualPhase('idle');
                    globalObserver.emit('ui.log.inform',
                        `🐍 Viper STREAK Over 2 @ $${viperState.baseStake.toFixed(2)}`);
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }
                if (viperState.mode === 'UNDER7') {
                    setStake(viperState.baseStake);
                    setPred(7);
                    setVirtualPhase('idle');
                    globalObserver.emit('ui.log.inform',
                        `🐍 Viper STREAK Under 7 @ $${viperState.baseStake.toFixed(2)}`);
                    await bot_interface.purchase('DIGITUNDER');
                    return;
                }

                // ── IDLE: evaluate conditions & entry trigger ────────────────────
                const digits = await ticks_interface.getLastDigitList();
                const all = Array.isArray(digits) ? digits : [];
                const last1k = all.slice(-1000);
                const total = last1k.length || 1;
                const freq = d => (last1k.filter(x => Number(x) === d).length / total) * 100;

                const over2Ok = freq(0) < 10 && freq(1) < 10 && freq(2) < 10;
                const under7Ok = freq(7) < 10 && freq(8) < 10 && freq(9) < 10;

                if (!over2Ok && !under7Ok) {
                    setStake(viperState.baseStake);
                    setPred(4);
                    setVirtualPhase('virtual');
                    globalObserver.emit('ui.log.inform',
                        `🐍 Viper IDLE — conditions not met ` +
                        `[0:${freq(0).toFixed(1)}% 1:${freq(1).toFixed(1)}% 2:${freq(2).toFixed(1)}%] ` +
                        `[7:${freq(7).toFixed(1)}% 8:${freq(8).toFixed(1)}% 9:${freq(9).toFixed(1)}%]`);
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }

                // Entry trigger: 2 consecutive digits ≤1 for Over 2; ≥8 for Under 7
                const last2 = all.slice(-2);
                const over2Entry = over2Ok && last2.length >= 2 && last2.every(d => Number(d) <= 1);
                const under7Entry = under7Ok && last2.length >= 2 && last2.every(d => Number(d) >= 8);

                if (over2Entry) {
                    viperState.mode = 'OVER2';
                    viperState.lastMainMode = 'OVER2';
                    viperState.currentStake = viperState.baseStake;
                    setStake(viperState.baseStake);
                    setPred(2);
                    setVirtualPhase('idle');
                    globalObserver.emit('ui.log.success',
                        `🐍 Viper ENTRY → Over 2! (last 2 digits: ${last2.join(',')}) @ $${viperState.baseStake.toFixed(2)}`);
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }
                if (under7Entry) {
                    viperState.mode = 'UNDER7';
                    viperState.lastMainMode = 'UNDER7';
                    viperState.currentStake = viperState.baseStake;
                    setStake(viperState.baseStake);
                    setPred(7);
                    setVirtualPhase('idle');
                    globalObserver.emit('ui.log.success',
                        `🐍 Viper ENTRY → Under 7! (last 2 digits: ${last2.join(',')}) @ $${viperState.baseStake.toFixed(2)}`);
                    await bot_interface.purchase('DIGITUNDER');
                    return;
                }

                // Conditions met but entry not triggered — filler trade
                const fp = over2Ok ? 4 : 5;
                const ft = over2Ok ? 'DIGITOVER' : 'DIGITUNDER';
                setStake(viperState.baseStake);
                setPred(fp);
                setVirtualPhase('virtual');
                globalObserver.emit('ui.log.inform',
                    `🐍 Viper WATCHING — conditions met, awaiting entry (last 2: ${last2.join(',')})`);
                await bot_interface.purchase(ft);
            })
        );

        // Bot.viperOnResult(profit) — after_purchase handler.
        // Updates viperState based on win/loss outcome.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'viperOnResult',
            createAsync(js_interpreter, async profit => {
                const isWin = Number(profit) > 0;
                const mode = viperState.mode;

                if (mode === 'IDLE') return; // Filler trade — no state change

                if (mode === 'OVER2' || mode === 'UNDER7') {
                    if (isWin) {
                        // Stay in streak — each streak trade uses base stake
                        viperState.currentStake = viperState.baseStake;
                        globalObserver.emit('ui.log.success',
                            `🐍 Viper WIN (${mode}) — streak continues @ $${viperState.baseStake.toFixed(2)}`);
                    } else {
                        // Loss — enter Martingale recovery
                        viperState.recoveryCount = 0;
                        viperState.currentStake = +(viperState.baseStake * viperState.martingaleFactor).toFixed(2);
                        viperState.mode = mode === 'OVER2' ? 'RECOVERY_OVER4' : 'RECOVERY_UNDER5';
                        globalObserver.emit('ui.log.warn',
                            `🐍 Viper LOSS (${mode}) → ${viperState.mode} @ $${viperState.currentStake.toFixed(2)}`);
                    }
                } else if (mode === 'RECOVERY_OVER4' || mode === 'RECOVERY_UNDER5') {
                    if (isWin) {
                        // Recovery succeeded — reset to IDLE
                        viperState.mode = 'IDLE';
                        viperState.currentStake = viperState.baseStake;
                        viperState.recoveryCount = 0;
                        setVirtualPhase('idle');
                        globalObserver.emit('ui.log.success',
                            `🐍 Viper RECOVERY WIN — back to IDLE @ $${viperState.baseStake.toFixed(2)}`);
                    } else {
                        // Recovery lost — Martingale again
                        viperState.recoveryCount++;
                        viperState.currentStake = +(viperState.currentStake * viperState.martingaleFactor).toFixed(2);
                        globalObserver.emit('ui.log.warn',
                            `🐍 Viper RECOVERY LOSS #${viperState.recoveryCount} — Martingale to $${viperState.currentStake.toFixed(2)}`);
                    }
                }
            })
        );

        // ── logDigitStats ──────────────────────────────────────────────────────
        // Logs even/odd percentages every tick. Called at the top of before_purchase.
        // Also resets inVirtualPhase to false here so normal-mode (Recovery Mode = FALSE)
        // DIGITOVER trades are always evaluated by after_purchase win/loss logic.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'logDigitStats',
            createAsync(js_interpreter, async () => {
                const digits = await ticks_interface.getLastDigitList();
                const last30 = Array.isArray(digits) ? digits.slice(-30) : [];
                const n = last30.length || 1;
                const evenCount = last30.filter(d => Number(d) % 2 === 0).length;
                const evenPct = Math.round((evenCount / n) * 100);
                const oddPct = 100 - evenPct;
                globalObserver.emit('ui.log.inform', `Last 30 Ticks → Even: ${evenPct}% | Odd: ${oddPct}%`);
                globalObserver.emit('bot.digit_stats', { even_pct: evenPct, odd_pct: oddPct, n: last30.length });
            })
        );

        // ── vhNormalPurchase ───────────────────────────────────────────────────
        // Used in normal mode (Recovery Mode = FALSE).
        // Saves the current stake as baseAmount and the Martingale multiplier so that:
        //   • VH filler DIGITOVER trades always run at baseAmount (not the doubled stake)
        //   • Real EVEN/ODD recovery trades use recoveryStake = baseAmount × martingale^n
        // This makes the virtual hook phase truly low-cost and non-compounding.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'vhNormalPurchase',
            createAsync(js_interpreter, async martingaleValue => {
                // Capture base stake from the current contract parameters
                const currentAmount = bot.tradeEngine.tradeOptions
                    ? bot.tradeEngine.tradeOptions.amount
                    : 0;
                vhState.baseAmount    = currentAmount > 0 ? currentAmount : 0.35;
                vhState.martingale    = Number(martingaleValue) > 0 ? Number(martingaleValue) : 2;

                // Capture recovery state BEFORE resetting so we can log correctly
                const wasInRecovery = vhState.repeatMode ||
                    vhState.lastSignal !== null ||
                    vhState.consecutiveLosses > 0 ||
                    vhState.inVirtualPhase;

                vhState.recoveryStake        = vhState.baseAmount;   // reset recovery ladder
                setVirtualPhase('idle');
                vhState.lockedSignal         = null;
                vhState.lastSignal           = null;
                vhState.consecutiveLosses    = 0;
                vhState.virtualTradeCount    = 0;
                vhState.repeatMode           = false;
                vhState.repeatContractType   = null;
                vhState.lastRealContractType = null;
                vhState.repeatCount          = 0;
                if (wasInRecovery) {
                    globalObserver.emit('ui.log.warn',
                        `Recovery COMPLETE — back to normal DIGITOVER at ${vhState.baseAmount.toFixed(2)}`);
                } else {
                    globalObserver.emit('ui.log.inform',
                        `Normal trade → stake: ${vhState.baseAmount} | martingale: ×${vhState.martingale}`);
                }
                // Purchase at current (base) stake — no override needed here
                await bot_interface.purchase('DIGITOVER');
            })
        );

        // ── applyRecoveryStake (private helper) ──────────────────────────────────
        // Computes the Martingale recovery stake and writes it to tradeOptions.
        // Used by all real-recovery paths (vhPurchase, recoveryExecute,
        // vhHandleRealLoss) so the logic lives in exactly one place.
        //
        // Modes:
        //   applyRecoveryStake()              — compute baseStake × mult from
        //                                       tradeOptions.amount (fallback:
        //                                       baseAmount or 0.35).
        //   applyRecoveryStake(fallback)       — same but explicit fallback.
        //   applyRecoveryStake(undefined, n)  — precomputed mode: skip the
        //                                       multiplication and write n
        //                                       directly to vhState.recoveryStake
        //                                       and tradeOptions. Use when the
        //                                       stake is already known (e.g.
        //                                       Phase 4b compounding in
        //                                       vhHandleRealLoss).
        const applyRecoveryStake = (fallback = vhState.baseAmount > 0 ? vhState.baseAmount : 0.35, precomputed = undefined) => {
            const mult = vhState.martingale > 0 ? vhState.martingale : 2;
            let baseStake;
            if (precomputed !== undefined) {
                vhState.recoveryStake = precomputed;
                baseStake = precomputed / mult;
            } else {
                baseStake = bot.tradeEngine.tradeOptions?.amount > 0
                    ? bot.tradeEngine.tradeOptions.amount
                    : fallback;
                vhState.recoveryStake = baseStake * mult;
            }
            if (bot.tradeEngine.tradeOptions) {
                bot.tradeEngine.tradeOptions = {
                    ...bot.tradeEngine.tradeOptions,
                    amount: vhState.recoveryStake,
                };
            }
            return { baseStake, mult };
        };

        // ── vhPurchase ─────────────────────────────────────────────────────────
        // Called every tick while Recovery Mode = TRUE and repeat mode is OFF.
        //
        // KEY RULE: the direction (EVEN or ODD) is LOCKED the moment VH activates
        // and never changes until the cycle completes. This prevents the percentage
        // comparison from flipping the signal tick-to-tick and resetting the
        // consecutive loss counter before it reaches maxSteps.
        //
        // Flow:
        //   Tick 1 (first call after loss): lock direction, set inVirtualPhase=true,
        //                                   track lastSignal, buy DIGITOVER filler.
        //   Tick 2+: evaluate locked direction against the last digit.
        //            − virtual win  → reset consecutive counter, buy filler.
        //            − virtual loss → increment counter; if counter ≥ maxSteps fire real trade.
        //
        // No stake overrides — the XML's Stake variable controls all trade amounts.
        // inVirtualPhase=true on filler trades gates after_purchase via isResult override.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'vhPurchase',
            createAsync(js_interpreter, async contractType => {
                const digits = await ticks_interface.getLastDigitList();
                const last30 = Array.isArray(digits) ? digits.slice(-30) : [];
                const lastDigit = last30.length > 0 ? Number(last30[last30.length - 1]) : 0;
                const isEvenDigit = lastDigit % 2 === 0;

                // Track last signal from XML before_purchase logic
                vhState.lastSignal = contractType;

                // ── First call (or re-entry after vhResetPurchase): activate VH and lock direction ──
                // Check both inVirtualPhase AND lockedSignal: vhResetPurchase sets inVirtualPhase=true
                // but leaves lockedSignal=null, which would send us to "subsequent ticks" with no
                // locked direction — causing the streak to count garbage results.
                if (!vhState.inVirtualPhase || !vhState.lockedSignal) {
                    setVirtualPhase('virtual');
                    vhState.lockedSignal      = contractType;   // LOCK — never overwritten until reset
                    vhState.consecutiveLosses = 0;
                    vhState.virtualTradeCount = 0;

                    const n = last30.length || 1;
                    const evenCount = last30.filter(d => Number(d) % 2 === 0).length;
                    const evenPct = Math.round((evenCount / n) * 100);
                    const oddPct  = 100 - evenPct;
                    const sigLabel = contractType === 'DIGITEVEN' ? 'EVEN' : 'ODD';

                    // Evaluate tick 1 immediately — digit is already here, count it
                    const virtualWin1 =
                        (contractType === 'DIGITEVEN' && isEvenDigit) ||
                        (contractType === 'DIGITODD'  && !isEvenDigit);
                    vhState.virtualTradeCount++;
                    globalObserver.emit('bot.virtual_transaction', {
                        is_won: virtualWin1,
                        contract_type: contractType,
                        trade_number: vhState.virtualTradeCount,
                        spot: lastDigit,
                        timestamp: Date.now(),
                    });
                    if (!virtualWin1) {
                        vhState.consecutiveLosses++;
                    }

                    globalObserver.emit('ui.log.warn',
                        `Virtual Hook ACTIVATED — Even: ${evenPct}% | Odd: ${oddPct}% (last ${last30.length} ticks) — Locked on ${sigLabel}`);
                    globalObserver.emit('ui.log.inform',
                        `VH Tick 1 — ${sigLabel} virtual ${virtualWin1 ? 'WON' : 'LOST'} (streak: ${vhState.consecutiveLosses})`);

                    // Check if we already hit the threshold on tick 1
                    const threshold1 = vhState.maxSteps > 0 ? vhState.maxSteps : 2;
                    if (vhState.consecutiveLosses >= threshold1) {
                        applyRecoveryStake(0.35);
                        globalObserver.emit('ui.log.warn',
                            `VH: threshold reached on activation — firing REAL ${sigLabel} at ${vhState.recoveryStake.toFixed(2)}`);
                        vhState.consecutiveLosses    = 0;
                        vhState.lastSignal           = null;
                        vhState.lockedSignal         = null;
                        vhState.inVirtualPhase       = false;
                        vhState.virtualTradeCount    = 0;
                        vhState.lastRealContractType = contractType;
                        await bot_interface.purchase(contractType);
                        return;
                    }

                    await bot_interface.purchase('DIGITOVER');
                    return;
                }

                // ── Subsequent ticks: always evaluate the LOCKED signal ──
                const locked     = vhState.lockedSignal;
                const tradeLabel = locked === 'DIGITEVEN' ? 'EVEN' : 'ODD';

                const virtualWin =
                    (locked === 'DIGITEVEN' && isEvenDigit) ||
                    (locked === 'DIGITODD'  && !isEvenDigit);

                vhState.virtualTradeCount++;

                // Push virtual result into Transactions tab
                globalObserver.emit('bot.virtual_transaction', {
                    is_won: virtualWin,
                    contract_type: locked,
                    trade_number: vhState.virtualTradeCount,
                    spot: lastDigit,
                    timestamp: Date.now(),
                });

                if (virtualWin) {
                    vhState.consecutiveLosses = 0;
                    globalObserver.emit('ui.log.inform',
                        `VH #${vhState.virtualTradeCount} ${tradeLabel} — virtual WON (streak reset, keep watching)`);
                } else {
                    vhState.consecutiveLosses++;
                    globalObserver.emit('ui.log.inform',
                        `VH #${vhState.virtualTradeCount} ${tradeLabel} — virtual LOST (${vhState.consecutiveLosses} consecutive)`);
                }

                // ── maxSteps consecutive virtual losses → fire real recovery trade ──
                const threshold = vhState.maxSteps > 0 ? vhState.maxSteps : 2;
                if (vhState.consecutiveLosses >= threshold) {
                    const { baseStake, mult } = applyRecoveryStake();
                    globalObserver.emit('ui.log.warn',
                        `VH: ${vhState.consecutiveLosses} consecutive virtual losses — firing REAL ${tradeLabel} at ${vhState.recoveryStake.toFixed(2)} (${baseStake.toFixed(2)} × ${mult})`);

                    vhState.consecutiveLosses    = 0;
                    vhState.lastSignal           = null;
                    vhState.lockedSignal         = null;
                    setVirtualPhase('real_recovery');
                    vhState.virtualTradeCount    = 0;
                    vhState.lastRealContractType = locked;
                    await bot_interface.purchase(locked);
                    return;
                }

                // ── Still accumulating losses — buy filler (no stake override) ──
                globalObserver.emit('ui.log.inform',
                    `VH watching ${tradeLabel} — filler DIGITOVER`);
                await bot_interface.purchase('DIGITOVER');
            })
        );

        // ── vhResetPurchase ────────────────────────────────────────────────────
        // Called when no Even/Odd signal is found during recovery mode.
        // Buys DIGITOVER at BASE stake so the balance impact is minimal.
        // inVirtualPhase = true so after_purchase skips win/loss logic —
        // these neutral filler trades must not reset Recovery Mode or Stake.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'vhResetPurchase',
            createAsync(js_interpreter, async () => {
                vhState.lastSignal     = null;
                setVirtualPhase('virtual');   // guard stays active — neutral trade

                // IMPORTANT: do NOT reset consecutiveLosses here.
                // If VH is already tracking a locked direction, the streak must
                // survive ticks where the signal condition temporarily drops out.
                // Only reset if VH was never activated (lockedSignal still null).
                if (!vhState.lockedSignal) {
                    vhState.consecutiveLosses = 0;
                }

                globalObserver.emit('ui.log.inform',
                    `No signal — holding recovery, DIGITOVER filler${vhState.lockedSignal ? ` (streak preserved: ${vhState.consecutiveLosses})` : ''}`);
                await bot_interface.purchase('DIGITOVER');
            })
        );

        // ── vhIsRepeatMode ─────────────────────────────────────────────────────
        // Returns true when the bot is in Phase 4b repeat mode (keep buying same
        // EVEN/ODD direction after a real loss without returning to virtual hook).
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'vhIsRepeatMode',
            js_interpreter.nativeToPseudo(() => vhState.repeatMode)
        );

        // ── vhHandleRealLoss ───────────────────────────────────────────────────
        // Called from after_purchase when Recovery Mode is TRUE and a real
        // DIGITEVEN/DIGITODD recovery trade lost. Enters Phase 4b (repeat mode):
        // keep buying the same direction at compounding stake until it wins.
        //
        // Stake override is done HERE (not in vhRepeatPurchase) so vhRepeatPurchase
        // stays consistent with the vhPurchase inVirtualPhase=false/true pattern —
        // no in-function stake manipulation, just set phase and call purchase.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'vhHandleRealLoss',
            js_interpreter.nativeToPseudo(() => {
                const mult = vhState.martingale > 0 ? vhState.martingale : 2;
                if (!vhState.repeatMode) {
                    vhState.repeatMode = true;
                    vhState.repeatContractType = vhState.lastRealContractType;
                    vhState.repeatCount = 0;
                    // vhState.recoveryStake was set by the initial recovery trade (base × mult).
                    // Compound once more for the first Phase 4b retry.
                    const base = vhState.recoveryStake > 0
                        ? vhState.recoveryStake
                        : (vhState.baseAmount > 0 ? vhState.baseAmount : 0.35) * mult;
                    applyRecoveryStake(undefined, base * mult);
                    globalObserver.emit('ui.log.warn',
                        `Recovery trade LOST — Phase 4b activated: retrying ${vhState.repeatContractType} at ${vhState.recoveryStake.toFixed(2)}`);
                } else {
                    // Subsequent Phase 4b loss — compound again.
                    applyRecoveryStake(undefined, vhState.recoveryStake * mult);
                    vhState.repeatCount++;
                    globalObserver.emit('ui.log.warn',
                        `Phase 4b: ${vhState.repeatContractType} lost again — stake now ${vhState.recoveryStake.toFixed(2)} (attempt ${vhState.repeatCount + 1})`);
                }
            })
        );

        // ── vhRepeatPurchase ───────────────────────────────────────────────────
        // Phase 4b: buys the same EVEN/ODD contract using the compounding stake
        // that was already computed and applied to tradeOptions by vhHandleRealLoss
        // (called in after_purchase). This function no longer overrides
        // tradeOptions.amount — consistent with the vhPurchase inVirtualPhase pattern
        // where the purchase function only sets the phase and calls purchase.
        //
        // maxSteps acts as a Phase 4b retry cap: if repeatCount reaches maxSteps
        // without a win, the cycle is aborted and VH state is fully reset.
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'vhRepeatPurchase',
            createAsync(js_interpreter, async () => {
                const maxRepeats = vhState.maxSteps > 0 ? vhState.maxSteps : 2;
                if (vhState.repeatCount >= maxRepeats) {
                    globalObserver.emit('ui.log.warn',
                        `Phase 4b: maxSteps (${maxRepeats}) reached without win — aborting and resetting VH state`);
                    vhState.repeatMode         = false;
                    vhState.repeatContractType = null;
                    vhState.repeatCount        = 0;
                    vhState.recoveryStake      = 0;
                    setVirtualPhase('idle');
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }

                setVirtualPhase('real_recovery');
                const ct = vhState.repeatContractType || 'DIGITEVEN';
                globalObserver.emit('ui.log.inform',
                    `Phase 4b repeat: buying ${ct} at ${vhState.recoveryStake.toFixed(2)} (attempt ${vhState.repeatCount + 1}/${maxRepeats})`);
                await bot_interface.purchase(ct);
            })
        );

        // ── recoveryExecute ────────────────────────────────────────────────────
        // All-in-one convenience block: logs digit stats then drives the full VH
        // purchase-decision tree each tick.
        //
        //   recoveryMode = false  → normal DIGITOVER trade (reset all VH state)
        //   recoveryMode = true
        //     + repeat mode active   → Phase 4b: buy same direction at compounding stake
        //     + recovery, signal     → vhPurchase (virtual or real depending on streak)
        //     + recovery, no signal  → neutral DIGITOVER filler (vhResetPurchase)
        js_interpreter.setProperty(
            pseudo_bot_interface,
            'recoveryExecute',
            createAsync(js_interpreter, async recoveryMode => {
                // ── Step 1: log digit stats ──
                const digits = await ticks_interface.getLastDigitList();
                const last30 = Array.isArray(digits) ? digits.slice(-30) : [];
                const n = last30.length || 1;
                const evenCount = last30.filter(d => Number(d) % 2 === 0).length;
                const evenPct = Math.round((evenCount / n) * 100);
                const oddPct  = 100 - evenPct;
                globalObserver.emit('ui.log.inform',
                    `Last 30 Ticks → Even: ${evenPct}% | Odd: ${oddPct}%`);

                // ── Step 2: Phase 4b (repeat mode) takes precedence over everything ──
                // Stake was already compounded and applied to tradeOptions by
                // vhHandleRealLoss (called in after_purchase of the previous cycle),
                // so no stake override is needed here.
                if (vhState.repeatMode) {
                    const maxRepeats = vhState.maxSteps > 0 ? vhState.maxSteps : 2;
                    if (vhState.repeatCount >= maxRepeats) {
                        globalObserver.emit('ui.log.warn',
                            `Phase 4b: maxSteps (${maxRepeats}) reached without win — aborting and resetting VH state`);
                        vhState.repeatMode         = false;
                        vhState.repeatContractType = null;
                        vhState.repeatCount        = 0;
                        vhState.recoveryStake      = 0;
                        setVirtualPhase('idle');
                        await bot_interface.purchase('DIGITOVER');
                        return;
                    }
                    setVirtualPhase('real_recovery');
                    const ct = vhState.repeatContractType || 'DIGITEVEN';
                    globalObserver.emit('ui.log.inform',
                        `Phase 4b repeat: buying ${ct} at ${vhState.recoveryStake.toFixed(2)} (attempt ${vhState.repeatCount + 1}/${maxRepeats})`);
                    await bot_interface.purchase(ct);
                    return;
                }

                // ── Step 3: Normal mode (Recovery Mode = false) ──
                if (!recoveryMode) {
                    const currentAmount = bot.tradeEngine.tradeOptions
                        ? bot.tradeEngine.tradeOptions.amount
                        : 0;
                    vhState.baseAmount    = currentAmount > 0 ? currentAmount : 0.35;
                    const wasInRecovery = vhState.lastSignal !== null ||
                        vhState.consecutiveLosses > 0 ||
                        vhState.inVirtualPhase;
                    vhState.recoveryStake        = vhState.baseAmount;
                    setVirtualPhase('idle');
                    vhState.lastSignal           = null;
                    vhState.consecutiveLosses    = 0;
                    vhState.virtualTradeCount    = 0;
                    vhState.repeatMode           = false;
                    vhState.repeatContractType   = null;
                    vhState.lastRealContractType = null;
                    vhState.repeatCount          = 0;
                    if (wasInRecovery) {
                        globalObserver.emit('ui.log.warn',
                            `Recovery COMPLETE — back to normal DIGITOVER at ${vhState.baseAmount.toFixed(2)}`);
                    } else {
                        globalObserver.emit('ui.log.inform',
                            `Normal trade → stake: ${vhState.baseAmount} | martingale: ×${vhState.martingale}`);
                    }
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }

                // ── Step 4: Recovery mode — even/odd signal detection ──
                const lastDigit   = last30.length > 0 ? Number(last30[last30.length - 1]) : 0;
                const isEvenDigit = lastDigit % 2 === 0;

                let signalType = null;
                if (evenPct > oddPct && !isEvenDigit) {
                    signalType = 'DIGITEVEN';   // Even dominant, last digit was odd → expect EVEN
                } else if (oddPct > evenPct && isEvenDigit) {
                    signalType = 'DIGITODD';    // Odd dominant, last digit was even → expect ODD
                }

                if (!signalType) {
                    // No clear signal — neutral filler (mirrors vhResetPurchase)
                    vhState.lastSignal        = null;
                    vhState.consecutiveLosses = 0;
                    setVirtualPhase('virtual');
                    if (vhState.baseAmount > 0 && bot.tradeEngine.tradeOptions) {
                        bot.tradeEngine.tradeOptions = {
                            ...bot.tradeEngine.tradeOptions,
                            amount: vhState.baseAmount,
                        };
                    }
                    globalObserver.emit('ui.log.inform',
                        `No signal — holding recovery, DIGITOVER filler at ${(vhState.baseAmount || 0.35).toFixed(2)}`);
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }

                // ── Signal found — run VH virtual/real purchase logic (mirrors vhPurchase) ──
                if (!vhState.inVirtualPhase) {
                    setVirtualPhase('virtual');
                    vhState.lockedSignal      = signalType;
                    vhState.lastSignal        = null;
                    vhState.consecutiveLosses = 0;
                    const sigLabel = signalType === 'DIGITEVEN' ? 'EVEN' : 'ODD';
                    globalObserver.emit('ui.log.warn',
                        `Virtual Hook ACTIVATED — Even: ${evenPct}% | Odd: ${oddPct}% (last ${last30.length} ticks) — Locked on ${sigLabel}`);
                    if (vhState.baseAmount > 0 && bot.tradeEngine.tradeOptions) {
                        bot.tradeEngine.tradeOptions = {
                            ...bot.tradeEngine.tradeOptions,
                            amount: vhState.baseAmount,
                        };
                    }
                    globalObserver.emit('ui.log.inform',
                        `VH Tick 1 — watching ${sigLabel}, filler DIGITOVER at ${(vhState.baseAmount || 0.35).toFixed(2)}`);
                    vhState.lastSignal = vhState.lockedSignal;
                    await bot_interface.purchase('DIGITOVER');
                    return;
                }

                // Subsequent ticks: evaluate locked signal
                const locked     = vhState.lockedSignal;
                const tradeLabel = locked === 'DIGITEVEN' ? 'EVEN' : 'ODD';
                const virtualWin =
                    (locked === 'DIGITEVEN' && isEvenDigit) ||
                    (locked === 'DIGITODD'  && !isEvenDigit);
                vhState.virtualTradeCount++;
                globalObserver.emit('bot.virtual_transaction', {
                    is_won: virtualWin,
                    contract_type: locked,
                    trade_number: vhState.virtualTradeCount,
                    spot: lastDigit,
                    timestamp: Date.now(),
                });
                if (virtualWin) {
                    vhState.consecutiveLosses = 0;
                    globalObserver.emit('ui.log.inform',
                        `VH #${vhState.virtualTradeCount} ${tradeLabel} — virtual WON (streak reset, keep watching)`);
                } else {
                    vhState.consecutiveLosses++;
                    globalObserver.emit('ui.log.inform',
                        `VH #${vhState.virtualTradeCount} ${tradeLabel} — virtual LOST (${vhState.consecutiveLosses} consecutive)`);
                }
                if (vhState.consecutiveLosses >= vhState.maxSteps) {
                    const { baseStake, mult } = applyRecoveryStake();
                    globalObserver.emit('ui.log.warn',
                        `VH: ${vhState.maxSteps} consecutive virtual losses — firing REAL ${tradeLabel} at ${vhState.recoveryStake.toFixed(2)} (${baseStake.toFixed(2)} × ${mult})`);
                    vhState.consecutiveLosses    = 0;
                    vhState.lastSignal           = null;
                    setVirtualPhase('real_recovery');
                    vhState.virtualTradeCount    = 0;
                    vhState.lastRealContractType = locked;
                    await bot_interface.purchase(locked);
                    return;
                }
                // Still waiting — filler
                globalObserver.emit('ui.log.inform',
                    `VH watching ${tradeLabel} — filler DIGITOVER`);
                await bot_interface.purchase('DIGITOVER');
            })
        );

        js_interpreter.setProperty(scope, 'Bot', pseudo_bot_interface);
        js_interpreter.setProperty(
            scope,
            'watch',
            createAsync(js_interpreter, watchName => {
                const { watch } = bot.getInterface();

                if (timeMachineEnabled(bot)) {
                    const snapshot = interpreter.takeStateSnapshot();
                    if (watchName === 'before') {
                        $scope.beforeState = snapshot;
                    } else {
                        $scope.duringState = snapshot;
                    }
                }

                return watch(watchName);
            })
        );

        js_interpreter.setProperty(scope, 'sleep', createAsync(js_interpreter, sleep));
    }

    async function stop() {
        return new Promise((resolve, reject) => {
            try {
                const global_timeouts = globalObserver.getState('global_timeouts') ?? [];
                const is_timeouts_cancellable = Object.keys(global_timeouts).every(
                    timeout => global_timeouts[timeout].is_cancellable
                );

                if (!bot.tradeEngine.contractId && is_timeouts_cancellable) {
                    api_base.is_stopping = true;
                    // When user is rate limited, allow them to stop the bot immediately
                    // granted there is no active contract.
                    global_timeouts.forEach(timeout => clearTimeout(global_timeouts[timeout]));
                    terminateSession().then(() => {
                        api_base.is_stopping = false;
                        resolve();
                    });
                } else if (
                    bot.tradeEngine.isSold === false &&
                    !$scope.is_error_triggered &&
                    isMultiplierContract(bot?.tradeEngine?.data?.contract?.contract_type ?? '')
                ) {
                    globalObserver.register('contract.status', async contractStatus => {
                        if (contractStatus.id === 'contract.sold') {
                            terminateSession().then(() => resolve());
                        }
                    });
                } else {
                    api_base.is_stopping = true;
                    terminateSession().then(() => {
                        api_base.is_stopping = false;
                        resolve();
                    });
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    async function terminateSession() {
        return new Promise((resolve, reject) => {
            try {
                $scope.stopped = true;
                $scope.is_error_triggered = false;
                globalObserver.emit('bot.stop');
                const { ticksService } = $scope;
                // Unsubscribe previous ticks_history subscription
                // Unsubscribe the subscriptions from Proposal, Balance and OpenContract
                api_base.clearSubscriptions();

                ticksService.unsubscribeFromTicksService().then(() => {
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async function unsubscribeFromTicksService() {
        const { ticksService } = $scope;
        return new Promise((resolve, reject) => {
            try {
                ticksService.unsubscribeFromTicksService().then(() => {
                    resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function run(code) {
        return new Promise((resolve, reject) => {
            const onError = e => {
                if ($scope.stopped) {
                    return;
                }
                // DBot handles 'InvalidToken' internally
                if (e.code === 'InvalidToken') {
                    globalObserver.emit('client.invalid_token');
                    return;
                }
                if (shouldStopOnError(bot, e?.code)) {
                    globalObserver.emit('ui.log.error', e.message);
                    globalObserver.emit('bot.click_stop');
                    return;
                }

                $scope.is_error_triggered = true;
                if (!shouldRestartOnError(bot, e.code) || !botStarted(bot)) {
                    reject(e);
                    return;
                }

                globalObserver.emit('Error', e);
                const { initArgs, tradeOptions } = bot.tradeEngine;
                terminateSession();
                init();
                $scope.observer.register('Error', onError);
                bot.tradeEngine.init(...initArgs);
                bot.tradeEngine.start(tradeOptions);
                const canRestoreState = $scope.startState && interpreter?.restoreStateSnapshot instanceof Function;
                if (canRestoreState) {
                    revert($scope.startState);
                }
            };

            $scope.observer.register('Error', onError);

            interpreter = new JSInterpreter(code, initFunc);
            onFinish = resolve;

            loop();
        });
    }

    return { stop, run, terminateSession, bot, unsubscribeFromTicksService };
};
export default Interpreter;

export const createInterpreter = () => new Interpreter();
