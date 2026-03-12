import {runRebalance} from './rebalance-lib.js';
import {parseCsv} from './data.js';
import fs from 'fs';

// Try the lumpy CSV since that's what gets DARA=41020
const csv = fs.readFileSync('./data/CusipQtyTestLumpy.csv', 'utf8');
const bonds = parseCsv(csv);

const result = await runRebalance({bonds, method:'full', bracketMode:'3bracket'});
const {details, summary} = result;

console.log('DARA inferred:', summary.dara?.toFixed(0));

let totalAmtBefore = 0, totalAmtAfter = 0, totalCostBefore = 0, totalCostAfter = 0;
for (const d of details) {
  if (d.araBeforeTotal != null) totalAmtBefore += d.araBeforeTotal;
  if (d.araAfterTotal != null) totalAmtAfter += d.araAfterTotal;
  if (d.costBefore != null) totalCostBefore += d.costBefore;
  if (d.costAfter != null) totalCostAfter += d.costAfter;
}
console.log('Amount Before total:', totalAmtBefore.toFixed(0));
console.log('Amount After total:', totalAmtAfter.toFixed(0));
console.log('Cost Before total:', totalCostBefore.toFixed(0));
console.log('Cost After total:', totalCostAfter.toFixed(0));

console.log('\nPer FY row:');
for (const d of details) {
  if (d.araBeforeTotal != null || d.araAfterTotal != null) {
    console.log(d.maturityYear, 
      'qtyB:', d.qtyBefore, 'qtyA:', d.qtyAfter,
      'pi:', d.piPerBond?.toFixed(0),
      'cost:', d.costPerBond?.toFixed(0),
      'amtB:', d.araBeforeTotal?.toFixed(0), 
      'amtA:', d.araAfterTotal?.toFixed(0));
  }
}
