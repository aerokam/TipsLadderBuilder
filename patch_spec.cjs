const fs = require('fs');
const path = 'c:/Users/aerok/projects/TipsLadderBuilder/knowledge/4.0_TIPS_Ladder_Rebalancing.md';
let src = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let ok = [];

function rep(label, o, n) {
  if (!src.includes(o)) { console.error('NOMATCH: ' + label + '\n  needle: ' + JSON.stringify(o.slice(0,80))); process.exit(1); }
  src = src.replace(o, n);
  ok.push(label);
}

// 1. excessQtyBefore formula — add max(0,...) clamp note
rep('excessQtyBefore',
  'excessQtyBefore = qtyBefore - fyQty\n```\nCurrent holdings beyond the FY target. Represents prior-build excess for duration matching.',
  'excessQtyBefore = max(0, qtyBefore - fyQty)\n```\nCurrent holdings beyond the FY target. Represents prior-build excess for duration matching. Clamped to 0: in 3-bracket mode the new lower bracket was previously a regular rebalance rung, so its fyQty can exceed current holdings.'
);

// 2. summary Code Variable Mapping — add 3-bracket fields after upperCUSIP row
rep('summaryVars',
  '| Lower bracket CUSIP | `summary.brackets.lowerCUSIP` |\n| Upper bracket CUSIP | `summary.brackets.upperCUSIP` |',
  '| Lower bracket CUSIP | `summary.brackets.lowerCUSIP` |\n| Upper bracket CUSIP | `summary.brackets.upperCUSIP` |\n| Bracket mode | `summary.bracketMode` | \'2bracket\' or \'3bracket\' |\n| New lower bracket year | `summary.newLowerYear` | 3-bracket only |\n| New lower bracket CUSIP | `summary.newLowerCUSIP` | 3-bracket only |\n| New lower bracket duration | `summary.newLowerDuration` | 3-bracket only |\n| Orig lower weight (w1) | `summary.origLowerWeight` | 3-bracket only; fixed at current excess fraction |\n| New lower weight (w2) | `summary.newLowerWeight3` | 3-bracket only; solved from duration constraint |\n| Before new lower weight | `summary.beforeNewLowerWeight` | 3-bracket only |\n| After new lower weight | `summary.afterNewLowerWeight` | 3-bracket only |'
);

fs.writeFileSync(path, src);
console.log('OK:', ok.join(', '));
