import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.apollo_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [
                        ['Digit Over', 'DIGITOVER'],
                        ['Digit Under', 'DIGITUNDER'],
                        ['Digit Even', 'DIGITEVEN'],
                        ['Digit Odd', 'DIGITODD'],
                        ['Digit Match', 'DIGITMATCH'],
                        ['Digit Diff', 'DIGITDIFF'],
                        ['Rise', 'CALL'],
                        ['Fall', 'PUT'],
                    ],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Purchase a contract of the specified type.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Apollo Purchase'),
            description: localize('Purchases a contract of the specified type.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase = block => {
    const purchase_type = block.getFieldValue('PURCHASE_LIST') || 'DIGITOVER';
    return `Bot.purchase('${purchase_type}');\n`;
};

window.Blockly.Blocks.apollo_purchase2 = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [
                        ['Digit Even', 'DIGITEVEN'],
                        ['Digit Odd', 'DIGITODD'],
                        ['Digit Over', 'DIGITOVER'],
                        ['Digit Under', 'DIGITUNDER'],
                        ['Digit Match', 'DIGITMATCH'],
                        ['Digit Diff', 'DIGITDIFF'],
                        ['Rise', 'CALL'],
                        ['Fall', 'PUT'],
                    ],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Purchase a recovery contract of the specified type.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Apollo Purchase 2'),
            description: localize('Purchases a recovery contract of the specified type.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase2 = block => {
    const purchase_type = block.getFieldValue('PURCHASE_LIST') || 'DIGITEVEN';
    return `Bot.vhPurchase('${purchase_type}');\n`;
};
