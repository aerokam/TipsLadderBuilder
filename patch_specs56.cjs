const fs = require('fs');
let ok = [];

function patch(label, filePath, oldStr, newStr) {
  let src = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(oldStr)) { console.error('NOMATCH: ' + label); process.exit(1); }
  src = src.replace(oldStr, newStr);
  fs.writeFileSync(filePath, src);
  ok.push(label);
}

const p5 = 'c:/Users/aerok/projects/TipsLadderBuilder/knowledge/5.0_Computation_Modules.md';
const p6 = 'c:/Users/aerok/projects/TipsLadderBuilder/knowledge/6.0_UI_Schema.md';

// 5.0: Add bracketWeights3 after bracketWeights section
patch('bracketWeights3',
  p5,
  '**Returns:** `{ lowerWeight, upperWeight }`\n\n**Spec reference:** 4.0 Phase 3c.\n\n---\n\n### `bracketExcessQtys',
  '**Returns:** `{ lowerWeight, upperWeight }`\n\n**Spec reference:** 4.0 Phase 3c.\n\n---\n\n### `bracketWeights3(d1, d2, d3, Dg, origExcess$, gapTotalCost)`\n\nThree-bracket weight solver. `d1` = orig lower duration, `d2` = new lower duration, `d3` = upper duration, `Dg` = gap avg duration.\n\n```\nw1     = gapTotalCost > 0 ? origExcess$ / gapTotalCost : 0   // fixed: current orig lower fraction\nw2_raw = (Dg - d3 + w1×(d3 - d1)) / (d2 - d3)\nw2     = max(0, w2_raw)   // clamp: if orig lower overshoots, skip new lower\nw3     = 1 - w1 - w2\n```\n\n**Returns:** `{ origLowerWeight: w1, newLowerWeight: w2, upperWeight: w3, feasible: w2raw >= 0 }`\n\n**Spec reference:** 4.0 §3-Bracket Mode.\n\n---\n\n### `bracketExcessQtys'
);

// 6.0: Fix buildDrillHTML signature (remove stale `mode` param)
patch('drillSignature',
  p6,
  'buildDrillHTML(d, colKey, summary, mode)',
  'buildDrillHTML(d, colKey, summary)'
);

// 6.0: Sub-row logic — note 3-bracket adds new lower bracket sub-row
patch('subRowLogic',
  p6,
  '**Bracket identification:** `d.isBracketTarget === true` (rebalance) or `d.ex_qty > 0` (build).\nUpper bracket: `d.fy === summary.brackets.upperYear` (rebalance) or `d.fy === summary.upperYear` (build).',
  '**Bracket identification:** `d.isBracketTarget === true` (rebalance) or `d.ex_qty > 0` (build).\nUpper bracket: `d.fy === summary.brackets.upperYear` (rebalance) or `d.fy === summary.upperYear` (build).\n\n**3-bracket mode:** New lower bracket (`summary.newLowerYear`) also gets a Gap sub-row, inserted between orig lower Gap and the non-bracket rebalance years.'
);

// 6.0: Popup routing — update gap popup description to reflect "see Duration Calcs" change
patch('gapPopupRouting',
  p6,
  '| `gapAmtBefore`, `gapAmtAfter` | duration chain → weights → totalCost → excessQty → piPerBond → gapAmt | 4.0 Phase 3c, Phase 2 |\n| `gapCostBefore`, `gapCostAfter` | duration chain → weights → totalCost → excessQty → costPerBond → gapCost | 4.0 Phase 3c |',
  '| `gapAmtBefore`, `gapAmtAfter` | "see Duration Calcs" reference → weight value → totalCost → excessQty → piPerBond → gapAmt | 4.0 Phase 3c, Phase 2 |\n| `gapCostBefore`, `gapCostAfter` | "see Duration Calcs" reference → weight value → totalCost → excessQty → costPerBond → gapCost | 4.0 Phase 3c |'
);

// 6.0: Update Duration chain note
patch('durationChain',
  p6,
  '**Duration chain** (used in gap popups):\n```\nGap avg duration (Phase 2)\n  → lower/upper bracket durations (Phase 3b)\n  → lowerWeight / upperWeight (Phase 3c)\n  → targetExcess$ = gapTotalCost × weight\n  → excessQty = ROUND(targetExcess$ / costPerBond)\n  → amount or cost\n```',
  '**Duration chain** (shown in Duration Calcs popup only; gap cost/amount popups reference it rather than repeat it):\n```\nGap avg duration (Phase 2)\n  → bracket durations (Phase 3b)\n  → bracket weights (Phase 3c / 3c-alt for 3-bracket)\n  → targetExcess$ = gapTotalCost × weight\n  → excessQty = ROUND(targetExcess$ / costPerBond)\n  → amount or cost\n```'
);

// 6.0: Fix traceability chain to remove `mode` param
patch('traceabilityChain',
  p6,
  '  → drill.js buildDrillHTML(d, colKey, summary, mode)',
  '  → drill.js buildDrillHTML(d, colKey, summary)'
);

console.log('OK:', ok.join(', '));
