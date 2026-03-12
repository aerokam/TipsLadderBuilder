import { readFileSync } from 'fs';
import { runRebalance, inferDARAFromCash, buildTipsMapFromYields, localDate } from './rebalance-lib.js';

// Load CSV files
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    return headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] }), {});
  });
}

const tipsYields = parseCSV(readFileSync('./data/TipsYields.csv', 'utf8'));
const refCPIData = parseCSV(readFileSync('./data/RefCPI.csv', 'utf8'));

// Holdings CSV has no header, just CUSIP,QTY pairs
const holdingsContent = readFileSync('./data/CusipQtyTestLumpy.csv', 'utf8');
const holdingsData = holdingsContent.trim().split('\n').map(line => {
  const [cusip, qty] = line.trim().split(',');
  return { cusip: cusip.trim(), qty: parseInt(qty) };
});

// Extract settlement date and refCPI from data
const settleDateStr = tipsYields[0].settlementDate;
const settlementDate = localDate(settleDateStr);
console.log('Looking for RefCPI entry for date:', settleDateStr);
console.log('First few RefCPI entries:', refCPIData.slice(0, 3));
const refCPIEntry = refCPIData.find(r => r.date === settleDateStr);
if (!refCPIEntry) {
  // Try with the column name as it appears
  console.log('Keys in refCPIData[0]:', Object.keys(refCPIData[0]));
  throw new Error(`RefCPI not found for date ${settleDateStr}`);
}
const refCPI = parseFloat(refCPIEntry.refCpi);
console.log('Parsed RefCPI:', refCPI);

// Convert yields to floats
const tipsYieldsTyped = tipsYields.map(r => ({
  ...r,
  coupon: parseFloat(r.coupon),
  baseCpi: parseFloat(r.baseCpi),
  price: parseFloat(r.price),
  yield: parseFloat(r.yield),
  settlementDate: r.settlementDate,
}));

const tipsMap = buildTipsMapFromYields(tipsYieldsTyped);

// Holdings are already parsed
const holdings = holdingsData;

console.log('Settlement Date:', settleDateStr);
console.log('RefCPI:', refCPI);
console.log('Holdings count:', holdings.length);

// Infer DARA for full rebalance
const { dara, portfolioCash } = inferDARAFromCash({ holdings, tipsMap, refCPI, settlementDate });
console.log('\nInferred DARA:', dara);
console.log('Portfolio Cash:', portfolioCash);

// Run rebalance with 3-bracket mode
const result = runRebalance({ dara, method: 'Full', bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate });

console.log('\n=== REBALANCE RESULTS ===');
console.log('Summary:');
console.log('  Cost Delta Sum:', result.summary.costDeltaSum);
console.log('  Total Amount Before:', result.summary.araBeforeTotal);
console.log('  Total Amount After:', result.summary.araAfterTotal);
console.log('  Net Cash:', result.summary.netCash);

// Find rows with Amount Before/After
console.log('\n=== DETAIL ROWS ===');
let totalBefore = 0, totalAfter = 0;
for (const d of result.details) {
  if (d.araBeforeTotal !== null) {
    totalBefore += d.araBeforeTotal;
    totalAfter += d.araAfterTotal;
    console.log(`${d.cusip} (FY ${d.fundedYear}): Before=${d.araBeforeTotal.toFixed(0)}, After=${d.araAfterTotal.toFixed(0)}, Qty Before=${d.qtyBefore}, Qty After=${d.qtyAfter}`);
  }
}
console.log('\nCalculated Totals:');
console.log('  Total Before:', totalBefore);
console.log('  Total After:', totalAfter);
console.log('  Difference:', totalAfter - totalBefore);
