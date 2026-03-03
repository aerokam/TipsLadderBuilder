import { describe, it, expect } from 'vitest';
import { 
  localDate, 
  toDateStr, 
  yieldFromPrice, 
  calculateMDuration 
} from '../../src/lib/engine/rebalance-engine.js';

describe('Legacy Engine Tests', () => {
  it('Date helpers', () => {
    const date = localDate('2026-03-02');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2); // March
    expect(date.getDate()).toBe(2);
    
    expect(toDateStr(date)).toBe('2026-03-02');
  });

  it('yieldFromPrice calculation', () => {
    const settle = '2026-03-02';
    const maturity = '2027-01-15';
    const coupon = 0.00375;
    const price = 99.78125;
    
    const yld = yieldFromPrice(price, coupon, settle, maturity);
    expect(yld).not.toBeNull();
    expect(yld!).toBeCloseTo(0.00626608, 6);
  });

  it('calculateMDuration', () => {
    const settle = new Date('2026-03-02');
    const maturity = new Date('2030-01-15');
    const coupon = 0.02;
    const yld = 0.02;
    
    const dur = calculateMDuration(settle, maturity, coupon, yld);
    expect(dur).toBeGreaterThan(0);
    expect(dur).toBeGreaterThan(3);
    expect(dur).toBeLessThan(4);
  });
});
