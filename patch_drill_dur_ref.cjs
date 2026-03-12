const fs = require('fs');
const path = 'c:/Users/aerok/projects/TipsLadderBuilder/drill.js';
let src = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let ok = [];

function rep(label, o, n) {
  if (!src.includes(o)) { console.error('NOMATCH: ' + label); process.exit(1); }
  src = src.replace(o, n);
  ok.push(label);
}

// 1. Build gapAmount/gapCost: replace duration/weight derivation rows with a reference
rep('build-gap-dur',
  "      const isLower = d.fundedYear === s.lowerYear;\n" +
  "      const weight  = isLower ? s.lowerWeight  : s.upperWeight;\n" +
  "      const wLabel  = isLower ? 'Lower weight' : 'Upper weight';\n" +
  "      const wFml    = isLower\n" +
  "        ? '(upper dur \\u2212 avg dur) / (upper dur \\u2212 lower dur)'\n" +
  "        : '1 \\u2212 lower weight';\n" +
  "      const exCost  = s.gapParams.totalCost * weight;\n" +
  "      rows = row('Gap year avg duration', '', fd(s.gapParams.avgDuration, 2) + ' yr')\n" +
  "        + row('Lower bracket (' + s.lowerYear + ')', 'duration', fd(s.lowerDuration, 2) + ' yr')\n" +
  "        + row('Upper bracket (' + s.upperYear + ')', 'duration', fd(s.upperDuration, 2) + ' yr')\n" +
  "        + sep()\n" +
  "        + row(wLabel, wFml, fd(weight, 4))\n" +
  "        + sep()\n" +
  "        + row('Gap year total cost', '', fm(s.gapParams.totalCost))\n" +
  "        + row('Target excess cost', 'total cost \\xd7 ' + wLabel.toLowerCase(), fm(exCost))\n" +
  "        + sep()\n" +
  "        + row('Cost per bond', 'price/100 \\xd7 index ratio \\xd7 1,000', fm2(d.costPerBond))\n" +
  "        + row('Excess qty', 'round(target cost \\xf7 cost/bond)', d.excessQty + ' bonds');",

  "      const isLower = d.fundedYear === s.lowerYear;\n" +
  "      const weight  = isLower ? s.lowerWeight  : s.upperWeight;\n" +
  "      const wLabel  = isLower ? 'Lower weight' : 'Upper weight';\n" +
  "      const exCost  = s.gapParams.totalCost * weight;\n" +
  "      rows = row('Bracket weights', 'see Duration Calcs \\u2197', fd(weight, 4))\n" +
  "        + sep()\n" +
  "        + row('Gap year total cost', '', fm(s.gapParams.totalCost))\n" +
  "        + row('Target excess cost', 'total cost \\xd7 ' + wLabel.toLowerCase(), fm(exCost))\n" +
  "        + sep()\n" +
  "        + row('Cost per bond', 'price/100 \\xd7 index ratio \\xd7 1,000', fm2(d.costPerBond))\n" +
  "        + row('Excess qty', 'round(target cost \\xf7 cost/bond)', d.excessQty + ' bonds');"
);

// 2. Rebal gapAmtAfter/gapCostAfter: replace duration/weight derivation rows with a reference
rep('rebal-gap-dur',
  "      const isLower = d.cusip === s.brackets.lowerCUSIP;\n" +
  "      const weight  = isLower ? s.lowerWeight  : s.upperWeight;\n" +
  "      const wLabel  = isLower ? 'Lower weight' : 'Upper weight';\n" +
  "      const wFml    = isLower\n" +
  "        ? '(upper dur \\u2212 avg dur) / (upper dur \\u2212 lower dur)'\n" +
  "        : '1 \\u2212 lower weight';\n" +
  "      const exCost  = s.gapParams.totalCost * weight;\n" +
  "      const exQty   = d.excessQtyAfter;\n" +
  "      rows = row('Gap year avg duration', '', fd(s.gapParams.avgDuration, 2) + ' yr')\n" +
  "        + row('Lower bracket (' + s.brackets.lowerCUSIP + ')', 'duration', fd(s.lowerDuration, 2) + ' yr')\n" +
  "        + row('Upper bracket (' + s.brackets.upperCUSIP + ')', 'duration', fd(s.upperDuration, 2) + ' yr')\n" +
  "        + sep()\n" +
  "        + row(wLabel, wFml, fd(weight, 4))\n" +
  "        + sep()\n" +
  "        + row('Gap year total cost', '', fm(s.gapParams.totalCost))\n" +
  "        + row('Target excess cost', 'total cost \\xd7 ' + wLabel.toLowerCase(), fm(exCost))\n" +
  "        + sep()\n" +
  "        + row('Cost per bond', 'price/100 \\xd7 index ratio \\xd7 1,000', fm2(d.costPerBond))\n" +
  "        + row('Excess qty', 'round(target cost \\xf7 cost/bond)', exQty + ' bonds');",

  "      const isLower = d.cusip === s.brackets.lowerCUSIP;\n" +
  "      const isNewLower = s.bracketMode === '3bracket' && d.cusip === s.newLowerCUSIP;\n" +
  "      const weight  = isLower ? (s.origLowerWeight ?? s.lowerWeight)\n" +
  "                   : isNewLower ? (s.newLowerWeight3 ?? 0)\n" +
  "                   : s.upperWeight;\n" +
  "      const wLabel  = isLower ? 'Orig lower weight' : isNewLower ? 'New lower weight' : 'Upper weight';\n" +
  "      const exCost  = s.gapParams.totalCost * weight;\n" +
  "      const exQty   = d.excessQtyAfter;\n" +
  "      rows = row('Bracket weights', 'see Duration Calcs \\u2197', fd(weight, 4))\n" +
  "        + sep()\n" +
  "        + row('Gap year total cost', '', fm(s.gapParams.totalCost))\n" +
  "        + row('Target excess cost', 'total cost \\xd7 ' + wLabel.toLowerCase(), fm(exCost))\n" +
  "        + sep()\n" +
  "        + row('Cost per bond', 'price/100 \\xd7 index ratio \\xd7 1,000', fm2(d.costPerBond))\n" +
  "        + row('Excess qty', 'round(target cost \\xf7 cost/bond)', exQty + ' bonds');"
);

fs.writeFileSync(path, src);
console.log('OK:', ok.join(', '));
