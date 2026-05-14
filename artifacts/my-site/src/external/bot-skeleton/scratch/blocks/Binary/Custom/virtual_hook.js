import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.enable_virtual_hook = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('{{ action }} Virtual Hook', { action: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'ENABLE_VIRTUAL_HOOK',
                    options: [
                        ['Enable', 'enable'],
                        ['Disable', 'disable'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Enable or disable the Virtual Hook. When enabled, the bot simulates losses before committing to a real trade.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Enable/Disable Virtual Hook'),
            description: localize('Enables or disables the Virtual Hook feature which simulates losses before committing to real trades.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.enable_virtual_hook = block => {
    const mode = block.getFieldValue('ENABLE_VIRTUAL_HOOK') || 'disable';
    return `Bot.enableVirtualHook('${mode}');\n`;
};

window.Blockly.Blocks.vh_settings = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Virtual Hook Settings %1'),
            args0: [
                {
                    type: 'input_statement',
                    name: 'STATEMENT',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Configure Virtual Hook settings (max steps and min trades).'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook Settings'),
            description: localize('Configure the Virtual Hook max steps and minimum trades.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_settings = block => {
    const statement =
        window.Blockly.JavaScript.javascriptGenerator.statementToCode(block, 'STATEMENT') || '';
    return `${statement}\n`;
};

window.Blockly.Blocks.max_steps = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Max Steps %1'),
            args0: [
                {
                    type: 'input_value',
                    name: 'MAX_STEPS',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Set the maximum number of virtual losses before placing a real trade.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Max Steps'),
            description: localize('Set the maximum number of virtual hook steps.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.max_steps = block => {
    const steps =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'MAX_STEPS',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    return `Bot.setVhMaxSteps(${steps});\n`;
};

window.Blockly.Blocks.min_trades = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Min Trades %1'),
            args0: [
                {
                    type: 'input_value',
                    name: 'MIN_TRADES',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Set the minimum number of trades before Virtual Hook activates.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Min Trades'),
            description: localize('Set the minimum number of trades before Virtual Hook activates.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.min_trades = block => {
    const trades =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'MIN_TRADES',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    return `Bot.setVhMinTrades(${trades});\n`;
};

// log_digit_stats — logs even/odd percentages every tick (no purchase)
window.Blockly.Blocks.log_digit_stats = {
    init() { this.jsonInit(this.definition()); },
    definition() {
        return {
            message0: localize('Log Digit Stats (last 30 ticks)'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Logs Even/Odd percentages to the journal on every tick.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Log Digit Stats'),
            description: localize('Logs even/odd digit percentages over the last 30 ticks to the journal.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.log_digit_stats = () =>
    `Bot.logDigitStats();\n`;

// vh_purchase — replaces apollo_purchase2 inside visible recovery conditions
window.Blockly.Blocks.vh_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('VH Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [
                        ['Digit Even', 'DIGITEVEN'],
                        ['Digit Odd', 'DIGITODD'],
                    ],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Runs virtual hook tracking. Executes a real purchase only after 2 consecutive virtual losses.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('VH Purchase'),
            description: localize('Virtual hook purchase block — tracks virtual trades and executes real trade after 2 consecutive virtual losses.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_purchase = block => {
    const purchase_type = block.getFieldValue('PURCHASE_LIST') || 'DIGITEVEN';
    return `Bot.vhPurchase('${purchase_type}');\n`;
};

// vh_normal_purchase — used in normal mode (Recovery Mode = FALSE).
// Saves the base stake and Martingale multiplier, then buys DIGITOVER.
// VH filler trades will always use this base stake, keeping VH phase low-cost.
window.Blockly.Blocks.vh_normal_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Normal Buy Digit Over (Martingale: %1)'),
            args0: [
                {
                    type: 'input_value',
                    name: 'MARTINGALE',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Buys DIGITOVER in normal mode. Saves the base stake and Martingale so VH filler trades stay at base cost.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Normal Buy Over'),
            description: localize('Buys DIGITOVER in normal mode, saving base stake and Martingale multiplier for the virtual hook recovery system.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_normal_purchase = block => {
    const martingale =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'MARTINGALE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '2';
    return `Bot.vhNormalPurchase(${martingale});\n`;
};

// vh_reset_purchase — no-signal case in recovery: clears VH state and buys DIGITOVER
window.Blockly.Blocks.vh_reset_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('VH Reset & Buy Digit Over'),
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Resets virtual hook state and buys DIGITOVER when no recovery signal is found.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('VH Reset & Buy Over'),
            description: localize('Clears virtual hook state and buys DIGITOVER when no signal is found during recovery.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_reset_purchase = () =>
    `Bot.vhResetPurchase();\n`;

// recovery_execute — statement block that drives the full even/odd + virtual-hook logic
window.Blockly.Blocks.recovery_execute = {
    init() { this.jsonInit(this.definition()); },
    definition() {
        return {
            message0: localize('Recovery Execute {{ recovery_mode }}', { recovery_mode: '%1' }),
            args0: [{ type: 'input_value', name: 'RECOVERY_MODE', check: 'Boolean' }],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Logs digit stats every tick and manages the virtual hook recovery logic.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Recovery Execute'),
            description: localize('Drives even/odd analysis, virtual hook, and recovery purchase logic.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.recovery_execute = block => {
    const recovery_mode =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'RECOVERY_MODE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || 'false';
    return `Bot.recoveryExecute(${recovery_mode});\n`;
};

// vh_is_virtual_phase — boolean value block
window.Blockly.Blocks.vh_is_virtual_phase = {
    init() { this.jsonInit(this.definition()); },
    definition() {
        return {
            message0: localize('Is Virtual Phase'),
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_HEXAGONAL,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Returns true while the bot is running virtual trades.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Is Virtual Phase'),
            description: localize('Returns true when the virtual hook is actively running simulated trades.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_is_virtual_phase = () =>
    [`Bot.isInVirtualPhase()`, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];

// vh_is_repeat_mode — boolean value block: true when bot is in Phase 4b repeat mode
window.Blockly.Blocks.vh_is_repeat_mode = {
    init() { this.jsonInit(this.definition()); },
    definition() {
        return {
            message0: localize('Is Repeat Mode'),
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_HEXAGONAL,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Returns true when the bot is in repeat mode (retrying same EVEN/ODD direction after a real loss).'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Is Repeat Mode'),
            description: localize('Returns true when the bot is retrying the same EVEN/ODD direction after a real trade loss.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_is_repeat_mode = () =>
    [`Bot.vhIsRepeatMode()`, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];

// vh_repeat_purchase — statement block: buys same EVEN/ODD direction at compounding stake
window.Blockly.Blocks.vh_repeat_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('VH Repeat Purchase (same direction)'),
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Buys the same EVEN/ODD direction again at a compounding martingale stake. Used after a real recovery trade loss.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('VH Repeat Purchase'),
            description: localize('Retries the same EVEN/ODD direction at increasing martingale stake until a win resets the cycle.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_repeat_purchase = () =>
    `Bot.vhRepeatPurchase();\n`;

// vh_handle_real_loss — statement block: called on real EVEN/ODD loss to enter repeat mode
window.Blockly.Blocks.vh_handle_real_loss = {
    init() { this.jsonInit(this.definition()); },
    definition() {
        return {
            message0: localize('VH Handle Real Loss'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Activates repeat mode when a real EVEN/ODD recovery trade loses — bot will retry same direction without returning to virtual hook.'),
            category: window.Blockly.Categories.After_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('VH Handle Real Loss'),
            description: localize('Enters repeat mode after a real recovery trade loss, bypassing virtual hook on next cycle.'),
        };
    },
    customContextMenu(menu) { modifyContextMenu(menu); },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_handle_real_loss = () =>
    `Bot.vhHandleRealLoss();\n`;
