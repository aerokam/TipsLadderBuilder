
import { buildTipsMapFromYields, runRebalance, localDate } from './src/rebalance-lib.js';
import { readFileSync } from 'fs';

const yieldsRaw = JSON.parse(readFileSync('tests/e2e/TipsYields.csv', 'utf8').split('\n').slice(1).map(line => {
    const parts = line.split(',');
    return {
        settlementDate: parts[0],
        cusip: parts[1],
        maturity: parts[2],
        coupon: parseFloat(parts[3]),
        baseCpi: parseFloat(parts[4]),
        price: parseFloat(parts[5]),
        yield: parseFloat(parts[6])
    };
}).filter(r => r.cusip).map(r => JSON.stringify(r)).join('\n'));
// Wait, my JSON.parse logic above is wrong for CSV. Let's do it properly.

const yieldsText = readFileSync('tests/e2e/TipsYields.csv', 'utf8');
const yieldsRows = yieldsText.trim().split('\n').slice(1).map(line => {
    const p = line.split(',');
    return { settlementDate: p[0], cusip: p[1], maturity: p[2], coupon: parseFloat(p[3]), baseCpi: parseFloat(p[4]), price: parseFloat(p[5]), yield: parseFloat(p[6]) };
});

const tipsMap = buildTipsMapFromYields(yieldsRows);
const settlementDate = localDate(yieldsRows[0].settlementDate);
const refCPI = 315.549; // approx

const holdingsText = readFileSync('tests/CusipQtyTestLumpy.csv', 'utf8');
const holdingsRaw = holdingsText.trim().split('\n').slice(1).map(line => {
    const p = line.split(',');
    return { cusip: p[0], qty: parseInt(p[1]) };
});

const result = runRebalance({
    dara: null,
    method: 'Full',
    holdings: holdingsRaw,
    tipsMap,
    refCPI,
    settlementDate
});

console.log('Details count:', result.details.length);
console.log('Holdings count:', holdingsRaw.length);
console.log('First Year:', result.summary.firstYear);
console.log('Last Year:', result.summary.lastYear);

const detailsCusips = result.details.map(d => d.cusip);
const missing = holdingsRaw.filter(h => !detailsCusips.includes(h.cusip));
console.log('Missing CUSIPs:', missing.map(m => m.cusip));
