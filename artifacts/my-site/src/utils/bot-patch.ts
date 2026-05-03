// ─── Shared bot XML patching utilities ────────────────────────────────────────
// Used by both Free Bots and Signal Engine pages so both always load and patch
// the same real XML files.

export interface BotSignal {
    symbol:      string;
    symbolLabel: string;
    direction:   string;   // e.g. "MATCHES 4", "DIFFERS 9", "EVEN", "ODD"
    entryPoint:  string;   // e.g. "Digit 4", "Digit 0"
    confidence:  number;
    market:      string;   // 'matches_differs' | 'even_odd' | 'over_under'
    savedAt:     number;
}

export interface BlockPatch {
    blockId:    string;
    numValue?:  number;   // patches math_number → field[NUM]
    textValue?: string;   // patches text        → field[TEXT]
}

// ─── Bot ID → XML path mapping ────────────────────────────────────────────────

export const BOT_XML_PATHS: Record<string, string> = {
    'matches-signal':     '/bots/Matches_Signal_Bot.xml',
    'differ-v2':          '/bots/BINARYTOOL@_DIFFER_V2.0_(1)_(1)_1765711647662.xml',
    'even-odd-scanner':   '/bots/BINARYTOOL@EVEN_ODD_THUNDER_AI_PRO_BOT_1765711647662.xml',
    'over-under-signal':  '/bots/OverUnder_Signal_Bot.xml',
};

// Resolve which bot to use from a signal's market + direction
export function botIdFromSignal(signal: Pick<BotSignal, 'market' | 'direction'>): string {
    if (signal.market === 'over_under')      return 'over-under-signal';
    if (signal.market === 'matches_differs') {
        return signal.direction.toUpperCase().startsWith('DIFFERS')
            ? 'differ-v2'
            : 'matches-signal';
    }
    return 'even-odd-scanner';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseDigitFrom(str: string): number {
    const m = str.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
}

// ─── DOM patcher ──────────────────────────────────────────────────────────────
// Walks the bot XML by block ID and updates math_number/text values in-place.

export function patchBotXml(
    xmlText: string,
    symbol:  string,
    patches: BlockPatch[],
    duration?: number,
): Document {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

    // 1. Patch SYMBOL_LIST (first match = market block)
    const allFields = doc.getElementsByTagName('field');
    for (let i = 0; i < allFields.length; i++) {
        if (allFields[i].getAttribute('name') === 'SYMBOL_LIST') {
            allFields[i].textContent = symbol;
            break;
        }
    }

    // 1b. Patch DURATION values across the whole bot. Walks every
    // <value name="DURATION"> and updates any nested math_number /
    // math_number_positive NUM field to the chosen tick count. This is
    // generic across all four bot XMLs because each one uses the standard
    // Blockly DURATION value slot, regardless of the bot's specific block IDs.
    if (typeof duration === 'number' && duration >= 1) {
        const ticks    = Math.max(1, Math.min(10, Math.round(duration)));
        const allValues = doc.getElementsByTagName('value');
        for (let i = 0; i < allValues.length; i++) {
            if (allValues[i].getAttribute('name') !== 'DURATION') continue;
            // Look for shadow + nested block math_number(_positive) NUM
            const numHosts = allValues[i].querySelectorAll('shadow, block');
            for (let j = 0; j < numHosts.length; j++) {
                const host = numHosts[j];
                const t    = host.getAttribute('type') ?? '';
                if (t !== 'math_number' && t !== 'math_number_positive') continue;
                const numFields = host.getElementsByTagName('field');
                for (let k = 0; k < numFields.length; k++) {
                    if (numFields[k].getAttribute('name') === 'NUM') {
                        numFields[k].textContent = String(ticks);
                    }
                }
            }
        }
        // Also patch any variables_set block whose VAR is named "duration"
        // (case-insensitive). Some bot XMLs initialise a duration variable
        // separately from the DURATION value slot.
        const allBlocks2 = doc.getElementsByTagName('block');
        for (let i = 0; i < allBlocks2.length; i++) {
            if (allBlocks2[i].getAttribute('type') !== 'variables_set') continue;
            const vfields = allBlocks2[i].getElementsByTagName('field');
            let isDur    = false;
            for (let f = 0; f < vfields.length; f++) {
                if (vfields[f].getAttribute('name') !== 'VAR') continue;
                if ((vfields[f].textContent ?? '').trim().toLowerCase() === 'duration') {
                    isDur = true; break;
                }
            }
            if (!isDur) continue;
            const inner = allBlocks2[i].getElementsByTagName('block');
            for (let b = 0; b < inner.length; b++) {
                if (inner[b].getAttribute('type') !== 'math_number') continue;
                const nf = inner[b].getElementsByTagName('field');
                for (let k = 0; k < nf.length; k++) {
                    if (nf[k].getAttribute('name') === 'NUM') {
                        nf[k].textContent = String(ticks);
                    }
                }
                break;
            }
        }
    }

    // 2. Patch initialisation blocks by variables_set block ID
    const allBlocks = doc.getElementsByTagName('block');
    for (let i = 0; i < allBlocks.length; i++) {
        const block = allBlocks[i];
        const bid   = block.getAttribute('id') ?? '';
        const patch = patches.find(p => p.blockId === bid);
        if (!patch) continue;

        const children = block.childNodes;
        for (let j = 0; j < children.length; j++) {
            const node = children[j] as Element;
            if (node.nodeType !== 1) continue;
            if (node.getAttribute('name') !== 'VALUE') continue;

            const innerBlocks = node.getElementsByTagName('block');
            for (let k = 0; k < innerBlocks.length; k++) {
                const btype = innerBlocks[k].getAttribute('type');

                if (btype === 'math_number' && patch.numValue !== undefined) {
                    const numFields = innerBlocks[k].getElementsByTagName('field');
                    for (let m = 0; m < numFields.length; m++) {
                        if (numFields[m].getAttribute('name') === 'NUM') {
                            numFields[m].textContent = String(patch.numValue);
                        }
                    }
                    break;
                }

                if (btype === 'text' && patch.textValue !== undefined) {
                    const txtFields = innerBlocks[k].getElementsByTagName('field');
                    for (let m = 0; m < txtFields.length; m++) {
                        if (txtFields[m].getAttribute('name') === 'TEXT') {
                            txtFields[m].textContent = patch.textValue;
                        }
                    }
                    break;
                }
            }
            break;
        }
    }

    return doc;
}

// ─── Per-bot patch maps ───────────────────────────────────────────────────────
// Block IDs sourced directly from each bot's INITIALIZATION chain.

export function getBotPatches(
    botId:      string,
    signal:     BotSignal,
    stake:      number,
    takeProfit: number,
    stopLoss:   number,
    martingale: number,
): BlockPatch[] {
    const digit = parseDigitFrom(signal.direction);   // prediction / entry for matches & differs
    const entry = parseDigitFrom(signal.entryPoint);  // entry point digit (Even Odd uses entryPoint)
    const martingaleLevel = Math.max(3, Math.min(10, Math.round(stopLoss / stake)));

    switch (botId) {
        case 'matches-signal':
            return [
                { blockId: '!BDtc{tIb5~vb#O@Ogky', numValue: digit },           // Prediction
                { blockId: 'Dww98I}prRuVxr_mn~}k',  numValue: stake },           // Stake
                { blockId: 'P@g)b:jeg|/F)mD8%X,w',  numValue: stake },           // InitialStake
                { blockId: 't0b1vxY9xaXc@*IwT7C{',  numValue: takeProfit },      // TakeProfit
                { blockId: 'tuMdgDH=EiDY~j.b%n;]',  numValue: martingaleLevel }, // MartingaleLevel
                { blockId: 'zHWiC2`O-~qH2R`7]FaG',  numValue: martingale },      // Martingale
                { blockId: 'ep_matches_init',         numValue: digit },           // entry point
            ];

        case 'differ-v2':
            return [
                { blockId: '%,Z?it?u3w,4)WTx2Hq:',  numValue: stake },      // stake
                { blockId: '/a.5Q3QDR2c)VR/XZvD-',  numValue: digit },      // entry point
                { blockId: 'ij(6Iu2cn[H}M;H3Y%9[',  numValue: digit },      // prediction
                { blockId: 's;EQ~zMi)cPYPc-kzha`',  numValue: martingale }, // martingale
                { blockId: ';N@3iS.2#]xK[5,E{gCO',  numValue: takeProfit }, // take profit
                { blockId: 'h~GA!H78SVi}._e5N:ur',   numValue: stopLoss },  // stop loss
            ];

        case 'even-odd-scanner':
            return [
                { blockId: 'eo_dir_init',            textValue: signal.direction.trim().toUpperCase() }, // Direction: EVEN or ODD
                { blockId: 'Wa]y_n3s-T4*h(bmYz+k',  numValue: stake },      // Stake
                { blockId: 'Z:R@MLC*=N3%meT)IuPt',   numValue: stopLoss },  // Max Loss
                { blockId: ':Vn+w]Y.(QKzgKKENIfo',   numValue: takeProfit }, // Target Profit
                { blockId: 'eo_ep_init_fixed',         numValue: entry },     // entry point
            ];

        case 'over-under-signal': {
            const dirText = signal.direction.split(' ')[0].toUpperCase(); // "OVER" or "UNDER"
            const barrier = parseDigitFrom(signal.direction);             // barrier digit
            return [
                { blockId: 'ou_dir_init',         textValue: dirText },         // Direction: OVER or UNDER
                { blockId: 'ou_barrier_init',      numValue: barrier },          // Barrier digit
                { blockId: 'ou_stake_init',        numValue: stake },            // Stake
                { blockId: 'ou_initial_stake_init',numValue: stake },            // InitialStake (same as Stake)
                { blockId: 'ou_tp_init',           numValue: takeProfit },       // TakeProfit
                { blockId: 'ou_mart_level_init',   numValue: martingaleLevel },  // MartingaleLevel
                { blockId: 'ou_mart_init',         numValue: martingale },       // Martingale
                { blockId: 'ou_ep_init',           numValue: barrier },          // entry point (= barrier)
            ];
        }

        default:
            return [];
    }
}

// ─── Fetch, patch, and load into Blockly workspace ────────────────────────────
// Returns the patched Document so the caller can load it however it needs.

export async function fetchAndPatchBot(
    botId:      string,
    signal:     BotSignal,
    stake:      number,
    takeProfit: number,
    stopLoss:   number,
    martingale: number,
    duration:   number = 1,
): Promise<Document> {
    const xmlPath = BOT_XML_PATHS[botId];
    if (!xmlPath) throw new Error(`Unknown bot id: ${botId}`);

    const res = await fetch(xmlPath);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching bot XML (${xmlPath})`);
    const rawXml = await res.text();

    const patches = getBotPatches(botId, signal, stake, takeProfit, stopLoss, martingale);
    const doc     = patchBotXml(rawXml, signal.symbol, patches, duration);

    if (doc.querySelector('parsererror')) throw new Error('Bot XML parse error — check the bot file.');
    return doc;
}
