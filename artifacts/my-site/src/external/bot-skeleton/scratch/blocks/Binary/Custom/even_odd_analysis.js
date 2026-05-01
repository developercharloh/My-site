import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.even_odd_analysis = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('{{ analysis_type }} of last %2 ticks', { analysis_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'ANALYSIS_TYPE',
                    options: [
                        ['Even %', 'EVEN_PERCENTAGE'],
                        ['Odd %', 'ODD_PERCENTAGE'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'N',
                    check: 'Number',
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns the percentage of even or odd last digits over the last N ticks.'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Even/Odd Analysis'),
            description: localize('Calculates the percentage of even or odd last digits over the last N ticks.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.even_odd_analysis = block => {
    const analysis_type = block.getFieldValue('ANALYSIS_TYPE') || 'EVEN_PERCENTAGE';
    const n =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'N',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '30';
    const code = `Bot.getEvenOddPercentage('${analysis_type}', ${n})`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};
