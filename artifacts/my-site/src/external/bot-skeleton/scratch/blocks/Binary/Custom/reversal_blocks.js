import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

// ── variables_set_option ──────────────────────────────────────────────────────
// Sets a variable to a specific dropdown option (option values come from the
// mutation attribute so the workspace can populate the list at load time).
window.Blockly.Blocks.variables_set_option = {
    _options: [['Option', 'Option']],
    init() {
        this.appendDummyInput()
            .appendField(localize('set'))
            .appendField(new window.Blockly.FieldVariable(localize('item')), 'VAR')
            .appendField(localize('to'))
            .appendField(
                new window.Blockly.FieldDropdown(() => this._options && this._options.length ? this._options : [['Option', 'Option']]),
                'OPTION'
            );
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(window.Blockly.Colours.Special2.colour);
        this.setTooltip(localize('Sets a variable to a predefined option value.'));
        this.setHelpUrl('');
    },
    domToMutation(xmlElement) {
        const opts_str = xmlElement.getAttribute('options');
        if (opts_str) {
            try {
                const decoded = decodeURIComponent(opts_str);
                const parsed = JSON.parse(decoded);
                if (Array.isArray(parsed) && parsed.length) {
                    this._options = parsed;
                    const dropdown = this.getField('OPTION');
                    if (dropdown) {
                        dropdown.menuGenerator_ = () => this._options;
                    }
                }
            } catch (e) {
                // keep default
            }
        }
    },
    mutationToDom() {
        const mutation = document.createElement('mutation');
        if (this._options) {
            mutation.setAttribute('options', encodeURIComponent(JSON.stringify(this._options)));
        }
        return mutation;
    },
    meta() {
        return {
            display_name: localize('Set variable option'),
            description: localize('Sets a variable to a predefined option value.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.variables_set_option = block => {
    const varName = window.Blockly.JavaScript.variableDB_.getName(
        block.getFieldValue('VAR'),
        window.Blockly.Variables.CATEGORY_NAME
    );
    const option_value = block.getFieldValue('OPTION') || '';
    return `${varName} = ${JSON.stringify(option_value)};\n`;
};

// ── variables_is_option ───────────────────────────────────────────────────────
// Boolean block — returns true when the variable equals the selected option.
window.Blockly.Blocks.variables_is_option = {
    _options: [['Option', 'Option']],
    init() {
        this.appendDummyInput()
            .appendField(
                new window.Blockly.FieldVariable(localize('item')), 'VAR'
            )
            .appendField(localize('is'))
            .appendField(
                new window.Blockly.FieldDropdown(() => this._options && this._options.length ? this._options : [['Option', 'Option']]),
                'OPTION'
            );
        this.setOutput(true, 'Boolean');
        this.setOutputShape(window.Blockly.OUTPUT_SHAPE_HEXAGONAL);
        this.setColour(window.Blockly.Colours.Special2.colour);
        this.setTooltip(localize('Returns true if the variable equals the selected option.'));
        this.setHelpUrl('');
    },
    domToMutation(xmlElement) {
        const opts_str = xmlElement.getAttribute('options');
        if (opts_str) {
            try {
                const decoded = decodeURIComponent(opts_str);
                const parsed = JSON.parse(decoded);
                if (Array.isArray(parsed) && parsed.length) {
                    this._options = parsed;
                    const dropdown = this.getField('OPTION');
                    if (dropdown) {
                        dropdown.menuGenerator_ = () => this._options;
                    }
                }
            } catch (e) {
                // keep default
            }
        }
    },
    mutationToDom() {
        const mutation = document.createElement('mutation');
        if (this._options) {
            mutation.setAttribute('options', encodeURIComponent(JSON.stringify(this._options)));
        }
        return mutation;
    },
    meta() {
        return {
            display_name: localize('Variable is option'),
            description: localize('Returns true if the variable equals the selected option.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.variables_is_option = block => {
    const varName = window.Blockly.JavaScript.variableDB_.getName(
        block.getFieldValue('VAR'),
        window.Blockly.Variables.CATEGORY_NAME
    );
    const option_value = block.getFieldValue('OPTION') || '';
    const code = `(${varName} === ${JSON.stringify(option_value)})`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_EQUALITY];
};

// ── last_digits_condition ─────────────────────────────────────────────────────
// Boolean block — checks whether ALL of the last N price digits satisfy the
// given comparison condition against COMPARE_VALUE.
//   CONDITION : LESS_OR_EQUAL | GREATER_OR_EQUAL
//   N         : how many trailing digits to inspect
//   COMPARE_VALUE : the threshold digit (0-9)
window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('last %2 digits %1 %3'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'CONDITION',
                    options: [
                        [localize('≤'), 'LESS_OR_EQUAL'],
                        [localize('≥'), 'GREATER_OR_EQUAL'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'N',
                    check: 'Number',
                },
                {
                    type: 'input_value',
                    name: 'COMPARE_VALUE',
                    check: 'Number',
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_HEXAGONAL,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns true if the last N digits of the price all satisfy the condition against the compare value.'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Last digits condition'),
            description: localize('Checks if the last N price digits all satisfy the condition.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last_digits_condition = block => {
    const condition = block.getFieldValue('CONDITION') || 'LESS_OR_EQUAL';
    const n =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'N',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    const compare_value =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'COMPARE_VALUE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '5';
    const code = `Bot.lastDigitsCondition('${condition}', ${n}, ${compare_value})`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};

// ── tick_time ─────────────────────────────────────────────────────────────────
// Returns the current Unix epoch in seconds (last digit used for entry filter).
window.Blockly.Blocks.tick_time = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('tick epoch'),
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns the current tick epoch (Unix timestamp in seconds).'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Tick epoch'),
            description: localize('Returns the current tick epoch (Unix timestamp in seconds).'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.tick_time = () => {
    const code = 'Math.floor(Date.now() / 1000)';
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};

// ── viper_purchase ────────────────────────────────────────────────────────────
// Statement block for before_purchase. Calls Bot.viperTrade(baseStake, mf)
// which handles all Volatility Viper trading logic in the interpreter.
window.Blockly.Blocks.viper_purchase = {
    init() {
        this.appendValueInput('BASE_STAKE')
            .setCheck('Number')
            .appendField(localize('Viper Trade | Base Stake'));
        this.appendValueInput('MARTINGALE_FACTOR')
            .setCheck('Number')
            .appendField(localize('Martingale ×'));
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(window.Blockly.Colours.Special3.colour);
        this.setTooltip(localize('Executes the Volatility Viper strategy: digit-frequency condition check + 2-consecutive entry trigger + Martingale recovery.'));
        this.setHelpUrl('');
    },
    meta() {
        return {
            display_name: localize('Viper purchase'),
            description: localize('Volatility Viper before_purchase handler. Manages Over 2/Under 7 streak trading and Over 4/Under 5 recovery.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.viper_purchase = block => {
    const base =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'BASE_STAKE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0.35';
    const mf =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'MARTINGALE_FACTOR',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '2.1';
    return `Bot.viperTrade(${base}, ${mf});\n`;
};

// ── viper_on_result ───────────────────────────────────────────────────────────
// Statement block for after_purchase. Passes the contract profit to the Viper
// state machine so it can decide whether to continue streaking or start recovery.
window.Blockly.Blocks.viper_on_result = {
    init() {
        this.appendDummyInput()
            .appendField(localize('Viper — process result'));
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(window.Blockly.Colours.Special3.colour);
        this.setTooltip(localize('Updates the Volatility Viper state machine based on the last contract result.'));
        this.setHelpUrl('');
    },
    meta() {
        return {
            display_name: localize('Viper process result'),
            description: localize('Updates the Viper state machine (win/loss/recovery) based on last trade profit.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.viper_on_result = () =>
    `Bot.viperOnResult(Bot.readDetails(4));\n`;
