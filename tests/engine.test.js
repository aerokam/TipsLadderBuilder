import test from 'node:test';
import assert from 'node:assert';
import { 
  localDate, 
  toDateStr, 
  yieldFromPrice, 
  calculateMDuration 
} from '../rebalance-engine.js';

test('Date helpers', () => {
  const date = localDate('2026-03-02');
  assert.strictEqual(date.getFullYear(), 2026);
  assert.strictEqual(date.getMonth(), 2); // March
  assert.strictEqual(date.getDate(), 2);
  
  assert.strictEqual(toDateStr(date), '2026-03-02');
});

test('yieldFromPrice calculation', () => {
  // Using data from TipsYields.csv for 912828V49
  // settle: 2026-03-02, mat: 2027-01-15, coupon: 0.00375, price: 99.78125, expected yield: 0.00626608
  const settle = '2026-03-02';
  const maturity = '2027-01-15';
  const coupon = 0.00375;
  const price = 99.78125;
  
  const yld = yieldFromPrice(price, coupon, settle, maturity);
  assert.ok(yld !== null);
  // @ts-ignore
  assert.ok(Math.abs(yld - 0.00626608) < 1e-6);
});

test('calculateMDuration', () => {
  const settle = new Date('2026-03-02');
  const maturity = new Date('2030-01-15');
  const coupon = 0.02;
  const yld = 0.02;
  
  const dur = calculateMDuration(settle, maturity, coupon, yld);
  assert.ok(dur > 0);
  // Duration for ~4 years should be roughly 3.5-4 depending on coupon
  assert.ok(dur > 3 && dur < 4);
});
