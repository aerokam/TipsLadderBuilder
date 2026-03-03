import { describe, it, expect } from 'vitest';
import { 
  runRebalance,
  localDate 
} from '../../src/lib/engine/rebalance-engine.js';

// Helper to create a mock TIPS map
function createMockTipsMap() {
  const map = new Map();
  const tips = [
    { cusip: 'B2032', maturity: '2032-01-15', coupon: 0.01, baseCpi: 300, price: 100, yield: 0.01 },
    { cusip: 'B2033', maturity: '2033-01-15', coupon: 0.01, baseCpi: 300, price: 100, yield: 0.01 },
    { cusip: 'B2034', maturity: '2034-01-15', coupon: 0.01, baseCpi: 300, price: 100, yield: 0.01 },
    { cusip: 'B2035', maturity: '2035-01-15', coupon: 0.01, baseCpi: 300, price: 100, yield: 0.01 },
    { cusip: 'B2036', maturity: '2036-01-15', coupon: 0.01, baseCpi: 300, price: 100, yield: 0.01 },
    // 2037, 2038, 2039 are gaps (market data anchors only)
    { cusip: 'B2036J', maturity: '2036-01-15', coupon: 0.01, baseCpi: 300, price: 100, yield: 0.01 }, // anchorBefore
    { cusip: 'B2040F', maturity: '2040-02-15', coupon: 0.02, baseCpi: 300, price: 100, yield: 0.02 }, // anchorAfter / upper bracket
  ];

  for (const t of tips) {
    map.set(t.cusip, {
      ...t,
      maturity: localDate(t.maturity)
    });
  }
  return map;
}

describe('Legacy Rebalance Tests', () => {
  it('runRebalance - Gap Mode (Basic)', () => {
    const tipsMap = createMockTipsMap();
    const settlementDate = localDate('2026-03-02');
    const refCPI = 300;
    
    // Initial holdings: Ladder from 2032 to 2036, with excess in 2034 and 2040
    const holdings = [
      { cusip: 'B2032', qty: 10 },
      { cusip: 'B2033', qty: 10 },
      { cusip: 'B2034', qty: 50 }, // Lower bracket
      { cusip: 'B2035', qty: 10 },
      { cusip: 'B2036', qty: 10 },
      { cusip: 'B2040F', qty: 100 }, // Upper bracket
    ];

    const result = runRebalance({
      dara: 10000,
      method: 'Gap',
      holdings,
      tipsMap,
      refCPI,
      settlementDate
    });

    expect(result.summary.method).toBe('Gap');
    expect(result.summary.gapYears).toContain(2037);
    expect(result.summary.gapYears).toContain(2038);
    expect(result.summary.gapYears).toContain(2039);
    
    // In Gap mode, 2035 and 2036 should be rebalanced (between lower bracket 2034 and first gap 2037)
    const row2035 = result.results.find(r => r[3] === '2035');
    const row2032 = result.results.find(r => r[3] === '2032');

    expect(row2035![8]).not.toBe("");
    expect(row2032![8]).toBe("");
  });

  it('runRebalance - Full Mode', () => {
    const tipsMap = createMockTipsMap();
    const settlementDate = localDate('2026-03-02');
    const refCPI = 300;
    
    const holdings = [
      { cusip: 'B2032', qty: 10 },
      { cusip: 'B2034', qty: 50 },
      { cusip: 'B2040F', qty: 100 },
    ];

    const result = runRebalance({
      dara: 10000,
      method: 'Full',
      holdings,
      tipsMap,
      refCPI,
      settlementDate
    });

    expect(result.summary.method).toBe('Full');
    
    // In Full mode, 2032 should be rebalanced
    const row2032 = result.results.find(r => r[3] === '2032');
    expect(row2032![8]).not.toBe("");
  });

  it('runRebalance - Full Rebuild (Empty Rungs)', () => {
    const tipsMap = createMockTipsMap();
    const settlementDate = localDate('2026-03-02');
    const refCPI = 300;
    
    // Only holdings in 2032 and 2040. 2033, 2034, 2035, 2036 are "empty rungs" but TIPS exist in market.
    const holdings = [
      { cusip: 'B2032', qty: 10 },
      { cusip: 'B2040F', qty: 100 },
    ];

    const result = runRebalance({
      dara: 10000,
      method: 'Full',
      holdings,
      tipsMap,
      refCPI,
      settlementDate
    });

    // Verify 2033 (empty rung) is present in results and has a target
    const row2033 = result.results.find(r => r[3] === '2033');
    expect(row2033).toBeDefined();
    expect(row2033![0]).toBe('B2033');
    expect(row2033![1]).toBe(0);
    expect(row2033![8]).toBeGreaterThan(0);
  });

  it('runRebalance - Virgin Build (New Investor)', () => {
    const tipsMap = createMockTipsMap();
    const settlementDate = localDate('2026-03-02');
    const refCPI = 300;
    
    // Starting with $0 in TIPS and $100,000 cash
    const holdings: any[] = [];
    const initialCash = 100000;
    const startYear = 2032;
    const endYear = 2036;
    const dara = 5000;

    const result = runRebalance({
      dara,
      method: 'Full',
      holdings,
      tipsMap,
      refCPI,
      settlementDate,
      initialCash,
      startYear,
      endYear
    });

    expect(result.summary.initialCash).toBe(100000);
    expect(result.summary.firstYear).toBe(2032);
    expect(result.summary.lastYear).toBe(2036);
    
    // Verify that we have targets for all years in the range
    for (let y = 2032; y <= 2036; y++) {
      const row = result.results.find(r => r[3] === y.toString());
      expect(row).toBeDefined();
      expect(row![8]).toBeGreaterThan(0);
    }

    // Cash should have been spent
    expect(result.summary.costDeltaSum).toBeLessThan(0);
    expect(result.summary.totalCash).toBeLessThan(initialCash);
  });
});
