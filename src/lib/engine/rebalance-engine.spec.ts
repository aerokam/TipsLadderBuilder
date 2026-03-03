import { describe, it, expect } from 'vitest';
import { localDate, toDateStr, yieldFromPrice, identifyBrackets } from './rebalance-engine.js';

describe('rebalance-engine', () => {
	it('identifies brackets correctly for a gap', () => {
		const tipsByYear = {
			2032: [{ cusip: 'B32', maturity: new Date(2032, 0, 15) }],
			2033: [{ cusip: 'B33', maturity: new Date(2033, 0, 15) }],
			2040: [{ cusip: 'B40', maturity: new Date(2040, 1, 15) }]
		};
		const gapYears = [2037, 2038, 2039];
		const holdings = [{ cusip: 'B32', qty: 100, year: 2032, maturity: new Date(2032, 0, 15) }];
		const yearInfo = { 2032: { holdings: [] } };

		const brackets = identifyBrackets(gapYears, holdings as any, yearInfo as any, tipsByYear as any);
		
		expect(brackets.lowerYear).toBe(2032);
		expect(brackets.upperYear).toBe(2040);
		expect(brackets.lowerCUSIP).toBe('B32');
		expect(brackets.upperCUSIP).toBe('B40');
	});

	it('parses local dates correctly', () => {
		const date = localDate('2026-03-02');
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(2); // March is 2
		expect(date.getDate()).toBe(2);
	});

	it('formats dates back to string', () => {
		const date = new Date(2026, 2, 2);
		expect(toDateStr(date)).toBe('2026-03-02');
	});

	it('calculates yield from price', () => {
		const settle = '2026-03-02';
		const maturity = '2027-01-15';
		const coupon = 0.00375;
		const price = 99.78125;
		
		const yld = yieldFromPrice(price, coupon, settle, maturity);
		expect(yld).toBeCloseTo(0.00626608, 6);
	});
});
