// ─── TYPE DEFINITIONS ─────────────────────────────────────────────────────────

export interface TIPS_Bond {
	cusip: string;
	maturity: Date;
	coupon: number;
	baseCpi: number;
	datedDate?: string;
	price: number | null;
	yield: number | null;
}

export interface Holding {
	cusip: string;
	qty: number;
	maturity?: Date;
	year?: number;
}

export interface GapParameters {
	avgDuration: number;
	totalCost: number;
}

export interface Brackets {
	lowerYear: number;
	lowerMaturity: Date;
	lowerCUSIP: string;
	upperYear: number;
	upperMaturity: Date;
	upperCUSIP: string;
}

export interface RebalanceParams {
	dara?: number | null;
	method: 'Gap' | 'Full';
	holdings: Holding[];
	tipsMap: Map<string, TIPS_Bond>;
	refCPI: number;
	settlementDate: Date;
	initialCash?: number;
	startYear?: number;
	endYear?: number;
	excludeCusips?: string[];
	strategy?: 'Default' | 'Cheapest';
	marginalTaxRate?: number;
}

export interface RebalanceResult {
	results: any[][];
	HDR: string[];
	summary: {
		settleDateDisp: string;
		refCPI: number;
		DARA: number;
		inferredDARA: number;
		method: 'Gap' | 'Full';
		firstYear: number;
		lastYear: number;
		rungCount: number;
		gapYears: number[];
		gapParams: GapParameters;
		brackets: Brackets;
		lowerDuration: number;
		upperDuration: number;
		lowerWeight: number;
		upperWeight: number;
		beforeLowerWeight: number | null;
		beforeUpperWeight: number | null;
		afterLowerWeight: number | null;
		afterUpperWeight: number | null;
		costDeltaSum: number;
		initialCash: number;
		totalCash: number;
	};
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

export const LOWEST_LOWER_BRACKET_YEAR = 2032;
const TIPS_PAR_VALUE = 1000;
const TIPS_INTEREST_MONTH_THRESHOLD = 7; // July

// ─── DATE UTILITIES ──────────────────────────────────────────────────────────

/**
 * Parses YYYY-MM-DD as a local date (preventing UTC shift).
 */
export function localDate(str: string): Date {
	const [y, m, d] = str.split('-').map(Number);
	return new Date(y, m - 1, d);
}

/**
 * Formats a Date object to YYYY-MM-DD string.
 */
export function toDateStr(date: Date): string {
	return date.toLocaleDateString('en-CA');
}

/**
 * Formats a Date object for display (MM/DD/YY).
 */
export function fmtDate(date: Date): string {
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const y = String(date.getFullYear()).slice(2);
	return `${m}/${d}/${y}`;
}

// ─── CORE MATHEMATICAL UTILITIES ─────────────────────────────────────────────

/**
 * Calculates the Real Yield from a given Clean Price.
 * Uses the Newton-Raphson method to solve the Present Value equation.
 * @reference Matches Excel YIELD(...,2,1) logic for semi-annual bonds.
 */
export function yieldFromPrice(cleanPrice: number, coupon: number, settleDateStr: string, maturityStr: string): number | null {
	if (!cleanPrice || cleanPrice <= 0) return null;
	const settle = localDate(settleDateStr);
	const mature = localDate(maturityStr);
	if (settle >= mature) return null;

	const semiCoupon = (coupon / 2) * 100;
	const matMon = mature.getMonth() + 1;
	const cm1 = matMon <= 6 ? matMon : matMon - 6;
	const cm2 = cm1 + 6;

	const nextCouponOnOrAfter = (d: Date): Date | null => {
		const candidates: Date[] = [];
		for (let year = d.getFullYear() - 1; year <= d.getFullYear() + 1; year++) {
			candidates.push(new Date(year, cm1 - 1, 15));
			candidates.push(new Date(year, cm2 - 1, 15));
		}
		candidates.sort((a, b) => a.getTime() - b.getTime());
		return candidates.find((c) => c >= d && c <= mature) || null;
	};

	const nextCoupon = nextCouponOnOrAfter(settle);
	if (!nextCoupon) return null;
	const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

	const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86400000;
	const E = days(lastCoupon, nextCoupon);
	const A = days(lastCoupon, settle);
	const DSC = days(settle, nextCoupon);
	const accrued = semiCoupon * (A / E);
	const dirtyPrice = cleanPrice + accrued;
	const w = DSC / E;

	const coupons: Date[] = [];
	let d = new Date(nextCoupon);
	while (d <= mature) {
		coupons.push(new Date(d));
		d = new Date(d.getFullYear(), d.getMonth() + 6, 15);
	}
	const N = coupons.length;
	if (N === 0) return null;

	const pv = (y: number) => {
		const r = y / 2;
		let s = 0;
		for (let k = 0; k < N; k++) {
			const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
			s += cf / Math.pow(1 + r, w + k);
		}
		return s;
	};

	const dpv = (y: number) => {
		const r = y / 2;
		let s = 0;
		for (let k = 0; k < N; k++) {
			const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
			s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
		}
		return s;
	};

	let y = coupon > 0.005 ? coupon : 0.02;
	for (let i = 0; i < 200; i++) {
		const diff = pv(y) - dirtyPrice;
		if (Math.abs(diff) < 1e-10) break;
		const deriv = dpv(y);
		if (Math.abs(deriv) < 1e-15) break;
		y -= diff / deriv;
	}
	return y;
}

/**
 * Calculates Modified Duration for a TIPS bond.
 */
export function calculateMDuration(settlement: Date, maturity: Date, coupon: number, yld: number): number {
	const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 + (maturity.getMonth() - settlement.getMonth());
	const periods = Math.ceil(months / 6);
	
	let weightedSum = 0, pvSum = 0;
	for (let i = 1; i <= periods; i++) {
		const cashflow = i === periods ? 1000 + (coupon * 1000) / 2 : (coupon * 1000) / 2;
		const pv = cashflow / Math.pow(1 + yld / 2, i);
		weightedSum += i * pv;
		pvSum += pv;
	}
	const macaulayDuration = weightedSum / pvSum / 2;
	return macaulayDuration / (1 + yld / 2);
}

// ─── PRIVATE FINANCIAL HELPERS ───────────────────────────────────────────────

function getIndexRatio(refCPI: number, baseCpi: number): number {
	return refCPI / baseCpi;
}

function getAdjustedPrincipal(indexRatio: number): number {
	return TIPS_PAR_VALUE * indexRatio;
}

/**
 * Calculates after-tax interest for the final year of a bond's maturity.
 */
function getAfterTaxInterest(principal: number, coupon: number, maturity: Date, taxRate: number): number {
	const annualInterest = principal * coupon;
	const month = maturity.getMonth() + 1;
	const lastYearInterestFactor = month < TIPS_INTEREST_MONTH_THRESHOLD ? 0.5 : 1.0;
	const rawInterest = annualInterest * lastYearInterestFactor;
	return rawInterest * (1 - taxRate);
}

// ─── LADDER CALCULATION LOGIC ────────────────────────────────────────────────

/**
 * Calculates the Total Principal and Interest (PI) generated by a single bond in its maturity year.
 */
export function calculatePIPerBond(cusip: string, maturity: Date, refCPI: number, tipsMap: Map<string, TIPS_Bond>, marginalTaxRate: number = 0): number {
	const bond = tipsMap.get(cusip);
	const indexRatio = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
	const principal = getAdjustedPrincipal(indexRatio);
	const interest = getAfterTaxInterest(principal, bond?.coupon ?? 0, maturity, marginalTaxRate);
	return principal + interest;
}

/**
 * Solves for the cost and duration targets required to cover synthetic gap rungs.
 */
export function calculateGapParameters(
	gapYears: number[],
	settlementDate: Date,
	refCPI: number,
	tipsMap: Map<string, TIPS_Bond>,
	DARA: number,
	holdings: Holding[],
	marginalTaxRate: number = 0
): GapParameters {
	if (!gapYears || gapYears.length === 0) return { avgDuration: 0, totalCost: 0 };

	const holdingsByYear: Record<number, Holding[]> = {};
	for (const h of holdings) {
		const year = h.year ?? 0;
		if (!holdingsByYear[year]) holdingsByYear[year] = [];
		holdingsByYear[year].push(h);
	}

	let laterMaturityFrom2041Plus = 0;
	for (const yearStr in holdingsByYear) {
		const year = parseInt(yearStr);
		if (year > 2040) {
			for (const h of holdingsByYear[year]) {
				const bond = tipsMap.get(h.cusip);
				const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
				laterMaturityFrom2041Plus += h.qty * getAdjustedPrincipal(ir) * (bond?.coupon ?? 0);
			}
		}
	}

	let bond2040: TIPS_Bond | null = null;
	const tips2040Holding = holdingsByYear[2040] ? holdingsByYear[2040][0] : null;
	if (tips2040Holding) {
		bond2040 = tipsMap.get(tips2040Holding.cusip) || null;
	} else {
		for (const b of tipsMap.values()) {
			if (b.maturity?.getFullYear() === 2040 && b.maturity?.getMonth() === 1) {
				bond2040 = b;
				break;
			}
		}
	}

	if (!bond2040) throw new Error('No TIPS found for 2040 (required for gap interpolation)');
	const maturity2040 = bond2040.maturity;
	if (!maturity2040) throw new Error('2040 anchor missing maturity');

	const piPerBond2040 = calculatePIPerBond(bond2040.cusip, maturity2040, refCPI, tipsMap, marginalTaxRate);
	const targetQty2040 = Math.round((DARA - laterMaturityFrom2041Plus) / piPerBond2040);

	const ir2040 = getIndexRatio(refCPI, bond2040.baseCpi ?? refCPI);
	const annualInterest2040 = targetQty2040 * getAdjustedPrincipal(ir2040) * (bond2040.coupon ?? 0);

	const gapLaterMaturityInterest: Record<number, number> = { 2040: annualInterest2040 };
	for (const yearStr in holdingsByYear) {
		const year = parseInt(yearStr);
		if (year > 2040) {
			gapLaterMaturityInterest[year] = 0;
			for (const h of holdingsByYear[year]) {
				const bond = tipsMap.get(h.cusip);
				const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
				gapLaterMaturityInterest[year] += h.qty * getAdjustedPrincipal(ir) * (bond?.coupon ?? 0);
			}
		}
	}

	const minGapYear = Math.min(...gapYears);
	const maxGapYear = Math.max(...gapYears);
	let anchorBefore: { maturity: Date; yield: number } | null = null;
	let anchorAfter: { maturity: Date; yield: number } | null = null;

	for (const bond of tipsMap.values()) {
		if (!bond.maturity || bond.yield === null) continue;
		const year = bond.maturity.getFullYear();
		const month = bond.maturity.getMonth() + 1;
		if (year === minGapYear - 1 && month === 1) {
			anchorBefore = { maturity: bond.maturity, yield: bond.yield };
		}
		if (year === maxGapYear + 1 && month === 2) {
			anchorAfter = { maturity: bond.maturity, yield: bond.yield };
		}
	}
	if (!anchorBefore || !anchorAfter) throw new Error('Could not find interpolation anchors for gap years');

	let totalDuration = 0, totalCost = 0, count = 0;
	for (const year of [...gapYears].sort((a, b) => b - a)) {
		const syntheticMat = new Date(year, 1, 15);
		const syntheticYield =
			anchorBefore.yield +
			((syntheticMat.getTime() - anchorBefore.maturity.getTime()) * (anchorAfter.yield - anchorBefore.yield)) /
				(anchorAfter.maturity.getTime() - anchorBefore.maturity.getTime());
		const syntheticCoupon = Math.max(0.00125, Math.floor((syntheticYield * 100) / 0.125) * 0.00125);

		totalDuration += calculateMDuration(settlementDate, syntheticMat, syntheticCoupon, syntheticYield);

		let sumLaterMaturityInterest = 0;
		for (const futYearStr in gapLaterMaturityInterest) {
			if (parseInt(futYearStr) > year) sumLaterMaturityInterest += gapLaterMaturityInterest[futYearStr];
		}

		const piPerBond = 1000 + 1000 * syntheticCoupon * 0.5;
		const qty = Math.round((DARA - sumLaterMaturityInterest) / piPerBond);
		totalCost += qty * 1000;
		count++;
	}

	return { avgDuration: totalDuration / count, totalCost };
}

/**
 * Builds a comprehensive TIPS market map from raw yields.
 */
export function buildTipsMapFromYields(rows: any[]): Map<string, TIPS_Bond> {
	const map = new Map<string, TIPS_Bond>();
	for (const r of rows) {
		map.set(r.cusip, {
			cusip: r.cusip,
			maturity: localDate(r.maturity),
			coupon: r.coupon,
			baseCpi: r.baseCpi,
			price: r.price || null,
			yield: r.yield || null
		});
	}
	return map;
}

// ─── MAIN REBALANCE ENGINE ──────────────────────────────────────────────────

/**
 * The primary entry point for the TIPS ladder engine.
 * Handles both Full Rebuilds and specialized Gap-Year Duration Matching.
 */
export function runRebalance({
	dara,
	method,
	holdings: holdingsRaw,
	tipsMap,
	refCPI,
	settlementDate,
	initialCash = 0,
	startYear,
	endYear,
	excludeCusips = [],
	strategy = 'Default',
	marginalTaxRate = 0
}: RebalanceParams): RebalanceResult {
	const settleDateStr = toDateStr(settlementDate);
	const settleDateDisp = fmtDate(settlementDate);

	const holdings: Holding[] = [];
	for (const h of holdingsRaw) {
		const bond = tipsMap.get(h.cusip);
		if (!bond) continue;
		holdings.push({
			cusip: h.cusip,
			qty: h.qty,
			maturity: bond.maturity,
			year: bond.maturity?.getFullYear()
		});
	}
	holdings.sort((a, b) => (a.maturity?.getTime() ?? 0) - (b.maturity?.getTime() ?? 0));

	const yearInfo: Record<number, { firstIdx: number; lastIdx: number; holdings: Holding[] }> = {};
	holdings.forEach((h, idx) => {
		const year = h.year ?? 0;
		if (!yearInfo[year]) yearInfo[year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
		yearInfo[year].lastIdx = idx;
		yearInfo[year].holdings.push(h);
	});

	const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
	const firstYear = startYear ?? (holdingsYears.length > 0 ? holdingsYears[0] : new Date().getFullYear());

	let lastYear: number;
	if (endYear) {
		lastYear = endYear;
	} else if (holdingsYears.length > 0) {
		lastYear = holdingsYears[0];
		for (let i = 0; i < holdingsYears.length; i++) {
			const year = holdingsYears[i];
			if (year <= 2040) {
				lastYear = year;
				continue;
			}
			const nextExpected = year + 1;
			const nextInHoldings = holdingsYears[i + 1];
			if (nextInHoldings && nextInHoldings === nextExpected) {
				lastYear = nextInHoldings;
			} else {
				lastYear = year;
				break;
			}
		}
	} else {
		lastYear = firstYear + 10;
	}

	const tipsMapYears = new Set<number>();
	const tipsByYear: Record<number, TIPS_Bond[]> = {};
	for (const bond of tipsMap.values()) {
		if (bond.maturity && !excludeCusips.includes(bond.cusip)) {
			const year = bond.maturity.getFullYear();
			tipsMapYears.add(year);
			if (!tipsByYear[year]) tipsByYear[year] = [];
			tipsByYear[year].push(bond);
		}
	}

	const gapYears: number[] = [];
	for (let year = firstYear; year <= lastYear; year++) {
		if (!tipsMapYears.has(year) && !yearInfo[year]) gapYears.push(year);
	}

	const araLaterMaturityInterestByYear: Record<number, number> = {};
	const araByYear: Record<number, number> = {};
	const allYearsSorted = Object.keys(yearInfo).map(Number).sort((a, b) => b - a);

	for (const year of allYearsSorted) {
		let laterMatInt = 0;
		for (const yStr in araLaterMaturityInterestByYear) {
			if (parseInt(yStr) > year) laterMatInt += araLaterMaturityInterestByYear[yStr];
		}
		let yearPrincipal = 0, yearLastYearInterest = 0;
		araLaterMaturityInterestByYear[year] = 0;
		for (const holding of yearInfo[year].holdings) {
			const bond = tipsMap.get(holding.cusip);
			const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
			const principal = getAdjustedPrincipal(ir);
			const interest = getAfterTaxInterest(principal, bond?.coupon ?? 0, holding.maturity!, 0); // before rebal, assume no tax for inferred
			
			yearPrincipal += holding.qty * principal;
			yearLastYearInterest += holding.qty * interest;
			araLaterMaturityInterestByYear[year] += holding.qty * principal * (bond?.coupon ?? 0);
		}
		araByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
	}

	let araSum = 0;
	for (let year = firstYear; year <= lastYear; year++) {
		if (araByYear[year] !== undefined) araSum += araByYear[year];
	}
	const rungCount = lastYear - firstYear + 1;
	const inferredDARA = rungCount > 0 ? araSum / rungCount : 0;
	const DARA = dara !== undefined && dara !== null ? dara : inferredDARA;
	const isFullMode = method === 'Full';

	const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, marginalTaxRate);

	const brackets = identifyBrackets(gapYears, holdings, yearInfo, tipsByYear);
	const lowerBond = tipsMap.get(brackets.lowerCUSIP);
	const upperBond = tipsMap.get(brackets.upperCUSIP);
	const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity, lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0);
	const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity, upperBond?.coupon ?? 0, upperBond?.yield ?? 0);
	const lowerWeight = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
	const upperWeight = 1 - lowerWeight;

	const bracketYearSet = new Set([brackets.lowerYear, brackets.upperYear]);
	const gapYearSet = new Set(gapYears);
	const minGapYear = gapYears.length > 0 ? Math.min(...gapYears) : 9999;

	const bracketTargetFYQtyBefore: Record<number, number> = {};
	for (const [bracketYear, bracketCUSIP, bracketMaturity] of [
		[brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity],
		[brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity]
	] as [number, string, Date][]) {
		let laterMatIntBefore = 0;
		for (const yStr in araLaterMaturityInterestByYear) {
			if (parseInt(yStr) > bracketYear) laterMatIntBefore += araLaterMaturityInterestByYear[yStr];
		}
		const yh = yearInfo[bracketYear]?.holdings ?? [];
		let tFYQty;
		if (yh.length <= 1) {
			tFYQty = Math.round((DARA - laterMatIntBefore) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap, marginalTaxRate));
		} else {
			let nonPI = 0;
			for (const h of yh) {
				if (h.cusip !== bracketCUSIP) nonPI += h.qty * calculatePIPerBond(h.cusip, h.maturity!, refCPI, tipsMap, marginalTaxRate);
			}
			tFYQty = Math.round((DARA - laterMatIntBefore - nonPI) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap, marginalTaxRate));
		}
		bracketTargetFYQtyBefore[bracketYear] = tFYQty;
	}

	let rebalYearSet: Set<number>;
	if (isFullMode) {
		rebalYearSet = new Set();
		for (let year = firstYear; year <= lastYear; year++) {
			if (!bracketYearSet.has(year) && !gapYearSet.has(year)) rebalYearSet.add(year);
		}
	} else {
		rebalYearSet = new Set();
		for (let year = brackets.lowerYear + 1; year < minGapYear; year++) {
			if (!gapYearSet.has(year)) rebalYearSet.add(year);
		}
	}

	const bracketExcessTarget: Record<number, number> = {
		[brackets.lowerYear]: gapParams.totalCost * lowerWeight,
		[brackets.upperYear]: gapParams.totalCost * upperWeight
	};

	const buySellTargets: Record<number, any> = {};
	const postRebalQtyMap: Record<string, number> = {};
	for (const h of holdings) postRebalQtyMap[h.cusip] = h.qty;

	let rebuildLaterMatInt = 0;
	const yearLaterMatIntSnapshot: Record<number, number> = {};

	const rebuildYears: number[] = [];
	for (let year = lastYear; year >= firstYear; year--) rebuildYears.push(year);
	for (const year of allYearsSorted) {
		if (year > lastYear) rebuildYears.push(year);
	}
	rebuildYears.sort((a, b) => b - a);

	for (const year of rebuildYears) {
		if (gapYearSet.has(year)) continue;

		yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;

		const yi = yearInfo[year];
		const isBracket = bracketYearSet.has(year);
		const isRebal = rebalYearSet.has(year);

		let targetCUSIP: string | null = null;
		let targetMaturity: Date | null = null;

		if (yi && yi.holdings.length > 0) {
			let maxQty = -1;
			for (const h of yi.holdings) {
				if (!excludeCusips.includes(h.cusip) && h.qty > maxQty) {
					maxQty = h.qty;
					targetCUSIP = h.cusip;
					targetMaturity = h.maturity ?? null;
				}
			}
		}

		if (!targetCUSIP && tipsByYear[year] && tipsByYear[year].length > 0) {
			if (strategy === 'Cheapest') {
				const bestBond = tipsByYear[year].reduce((prev, curr) => (curr.yield || -999) > (prev.yield || -999) ? curr : prev);
				targetCUSIP = bestBond.cusip;
				targetMaturity = bestBond.maturity ?? null;
			} else {
				const febBond = tipsByYear[year].find((b) => b.maturity?.getMonth() === 1);
				const bond = febBond || tipsByYear[year][0];
				targetCUSIP = bond.cusip;
				targetMaturity = bond.maturity ?? null;
			}
		}

		if (!targetCUSIP || !targetMaturity) {
			if (yi) {
				for (const h of yi.holdings) {
					const bond = tipsMap.get(h.cusip);
					const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
					rebuildLaterMatInt += h.qty * getAdjustedPrincipal(ir) * (bond?.coupon ?? 0);
				}
			}
			continue;
		}

		const targetBondR = tipsMap.get(targetCUSIP);
		const tPrice = targetBondR?.price ?? 0;
		const costPerBond = (tPrice / 100) * getIndexRatio(refCPI, targetBondR?.baseCpi ?? refCPI) * TIPS_PAR_VALUE;

		const currentHolding = yi?.holdings.find((h) => h.cusip === targetCUSIP);
		const currentQty = currentHolding ? currentHolding.qty : 0;

		let targetFYQty: number, postRebalQty: number;

		if (isBracket || isRebal) {
			if (!yi || yi.holdings.length <= 1) {
				targetFYQty = Math.round((DARA - rebuildLaterMatInt) / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap, marginalTaxRate));
			} else {
				let nonTargetPI = 0;
				for (const h of yi.holdings) {
					if (h.cusip !== targetCUSIP) nonTargetPI += h.qty * calculatePIPerBond(h.cusip, h.maturity!, refCPI, tipsMap, marginalTaxRate);
				}
				targetFYQty = Math.round((DARA - rebuildLaterMatInt - nonTargetPI) / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap, marginalTaxRate));
			}
			postRebalQty = isBracket ? targetFYQty + Math.round((bracketExcessTarget[year] || 0) / costPerBond) : targetFYQty;
		} else {
			targetFYQty = currentQty;
			postRebalQty = currentQty;
		}

		if (isBracket || isRebal) {
			buySellTargets[year] = {
				targetCUSIP,
				targetFYQty,
				targetQty: postRebalQty,
				postRebalQty,
				qtyDelta: postRebalQty - currentQty,
				targetCost: targetFYQty * costPerBond,
				costDelta: -(postRebalQty - currentQty) * costPerBond,
				costPerBond,
				isBracket,
				currentExcessCost: isBracket ? (currentQty - (bracketTargetFYQtyBefore[year] || 0)) * costPerBond : undefined
			};
		}

		postRebalQtyMap[targetCUSIP] = postRebalQty;
		if (yi) {
			for (const h of yi.holdings) {
				const qtyForInt = h.cusip === targetCUSIP ? postRebalQty : h.qty;
				const bond = tipsMap.get(h.cusip);
				const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
				rebuildLaterMatInt += qtyForInt * getAdjustedPrincipal(ir) * (bond?.coupon ?? 0);
			}
		} else {
			const bond = tipsMap.get(targetCUSIP);
			const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
			rebuildLaterMatInt += postRebalQty * getAdjustedPrincipal(ir) * (bond?.coupon ?? 0);
		}
	}

	const beforeARAByYear: Record<number, number> = {};
	for (const year of rebuildYears) {
		if (gapYearSet.has(year)) continue;
		let laterMatInt = 0;
		for (const yStr in araLaterMaturityInterestByYear) {
			if (parseInt(yStr) > year) laterMatInt += araLaterMaturityInterestByYear[yStr];
		}
		let yearPrincipal = 0, yearLastYearInterest = 0;
		if (yearInfo[year]) {
			for (const holding of yearInfo[year].holdings) {
				const bond = tipsMap.get(holding.cusip);
				const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
				const principal = getAdjustedPrincipal(ir);
				const isBracketTarget = bracketYearSet.has(year) && holding.cusip === buySellTargets[year]?.targetCUSIP;
				const qtyForARA = isBracketTarget ? bracketTargetFYQtyBefore[year] ?? 0 : holding.qty;
				yearPrincipal += qtyForARA * principal;
				yearLastYearInterest += qtyForARA * getAfterTaxInterest(principal, bond?.coupon ?? 0, holding.maturity!, marginalTaxRate);
			}
		}
		beforeARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
	}

	const postARAByYear: Record<number, number> = {};
	for (const year of rebuildYears) {
		if (gapYearSet.has(year)) continue;
		const laterMatInt = yearLaterMatIntSnapshot[year] ?? 0;
		let yearPrincipal = 0, yearLastYearInterest = 0;

		const cusipsInYear = new Set<string>();
		if (yearInfo[year]) yearInfo[year].holdings.forEach((h) => cusipsInYear.add(h.cusip));
		if (buySellTargets[year]) cusipsInYear.add(buySellTargets[year].targetCUSIP);

		for (const cusip of cusipsInYear) {
			const bond = tipsMap.get(cusip);
			const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
			const principal = getAdjustedPrincipal(ir);
			const bt = buySellTargets[year];
			let qtyForARA;
			if (bt && cusip === bt.targetCUSIP) {
				qtyForARA = bt.isBracket ? bt.targetFYQty : bt.postRebalQty;
			} else {
				qtyForARA = postRebalQtyMap[cusip] ?? 0;
			}
			yearPrincipal += qtyForARA * principal;
			yearLastYearInterest += qtyForARA * getAfterTaxInterest(principal, bond?.coupon ?? 0, bond!.maturity, marginalTaxRate);
		}
		postARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
	}

	const displayYears = [...rebuildYears].sort((a, b) => a - b);
	const results: any[][] = [];
	const outputLaterMaturityInterest: Record<number, number> = {};

	for (let i = displayYears.length - 1; i >= 0; i--) {
		const year = displayYears[i];
		let sumLaterMaturityAnnualInterest = 0;
		for (const yearStr in outputLaterMaturityInterest) {
			if (parseInt(yearStr) > year) sumLaterMaturityAnnualInterest += outputLaterMaturityInterest[yearStr];
		}

		const yi = yearInfo[year];
		const bt = buySellTargets[year];
		const cusipsToShow: string[] = [];
		if (yi) yi.holdings.forEach((h) => cusipsToShow.push(h.cusip));
		if (bt && !cusipsToShow.includes(bt.targetCUSIP)) cusipsToShow.push(bt.targetCUSIP);

		for (let j = 0; j < cusipsToShow.length; j++) {
			const cusip = cusipsToShow[j];
			const isLastInYear = j === cusipsToShow.length - 1;
			const holding = yi?.holdings.find((h) => h.cusip === cusip);
			const bond = tipsMap.get(cusip);
			const maturity = bond?.maturity;

			let fy: any = '', principalFY: any = '', interestFY: any = '', araFY: any = '', costFY: any = '';
			let targetQty: any = '', qtyDelta: any = '', targetCost: any = '', costDelta: any = '';
			let araBeforeFY: any = '', araMinusDaraBefore: any = '', araAfterFY: any = '', araMinusDaraAfter: any = '';
			let excessBefore: any = '', excessAfter: any = '';

			if (isLastInYear) {
				let yearPrincipal = 0, yearLastYearInterest = 0, yearCost = 0;
				const allCusipsInYear = new Set(cusipsToShow);
				for (const c of allCusipsInYear) {
					const b = tipsMap.get(c);
					const h = yi?.holdings.find((holding) => holding.cusip === c);
					const q = h?.qty ?? 0;
					const ir = getIndexRatio(refCPI, b?.baseCpi ?? refCPI);
					const principal = getAdjustedPrincipal(ir);
					
					yearPrincipal += q * principal;
					yearLastYearInterest += q * getAfterTaxInterest(principal, b?.coupon ?? 0, b!.maturity, marginalTaxRate);
					yearCost += q * ((b?.price ?? 0) / 100 * principal);
				}
				fy = year.toString();
				principalFY = yearPrincipal;
				interestFY = yearLastYearInterest + sumLaterMaturityAnnualInterest;
				araFY = principalFY + interestFY;
				costFY = yearCost;
				araBeforeFY = beforeARAByYear[year] ?? '';
				araMinusDaraBefore = typeof araBeforeFY === 'number' ? araBeforeFY - DARA : '';
				araAfterFY = postARAByYear[year] ?? '';
				araMinusDaraAfter = typeof araAfterFY === 'number' ? araAfterFY - DARA : '';
			}

			if (bt && cusip === bt.targetCUSIP) {
				targetQty = bt.targetQty;
				qtyDelta = bt.qtyDelta;
				targetCost = bt.targetCost;
				costDelta = bt.costDelta;
				if (bt.isBracket) {
					excessBefore = bt.currentExcessCost;
					excessAfter = (bt.postRebalQty - bt.targetFYQty) * bt.costPerBond;
				}
			}

			const ir = getIndexRatio(refCPI, bond?.baseCpi ?? refCPI);
			if (!outputLaterMaturityInterest[year]) outputLaterMaturityInterest[year] = 0;
			outputLaterMaturityInterest[year] += (holding?.qty ?? 0) * getAdjustedPrincipal(ir) * (bond?.coupon ?? 0);

			results.unshift([
				cusip, holding?.qty ?? 0, maturity ? fmtDate(maturity) : '', fy,
				principalFY, interestFY, araFY, costFY,
				targetQty, qtyDelta, targetCost, costDelta,
				araBeforeFY, araMinusDaraBefore, araAfterFY, araMinusDaraAfter,
				excessBefore, excessAfter
			]);
		}
	}

	const costDeltaSum = results.reduce((sum, row) => sum + (typeof row[11] === 'number' ? row[11] : 0), 0);
	const totalCash = initialCash + costDeltaSum;

	const lowerPrice = lowerBond?.price ?? 0;
	const lowerCostPerBond = (lowerPrice / 100) * getIndexRatio(refCPI, lowerBond?.baseCpi ?? refCPI) * TIPS_PAR_VALUE;
	const upperPrice = upperBond?.price ?? 0;
	const upperCostPerBond = (upperPrice / 100) * getIndexRatio(refCPI, upperBond?.baseCpi ?? refCPI) * TIPS_PAR_VALUE;

	const lowerCurrentExcess = buySellTargets[brackets.lowerYear]?.currentExcessCost;
	const upperCurrentExcess = buySellTargets[brackets.upperYear]?.currentExcessCost;
	const totalCurrentExcess = (lowerCurrentExcess ?? 0) + (upperCurrentExcess ?? 0);

	const lowerExcessQty = (buySellTargets[brackets.lowerYear]?.postRebalQty ?? 0) - (buySellTargets[brackets.lowerYear]?.targetFYQty ?? 0);
	const upperExcessQty = (buySellTargets[brackets.upperYear]?.postRebalQty ?? 0) - (buySellTargets[brackets.upperYear]?.targetFYQty ?? 0);
	const totalExcessCost = (lowerExcessQty * lowerCostPerBond) + (upperExcessQty * upperCostPerBond);

	const beforeLowerWeight = totalCurrentExcess > 0 && lowerCurrentExcess !== undefined ? lowerCurrentExcess / totalCurrentExcess : null;
	const beforeUpperWeight = totalCurrentExcess > 0 && upperCurrentExcess !== undefined ? upperCurrentExcess / totalCurrentExcess : null;
	const afterLowerWeight = totalExcessCost > 0 ? (lowerExcessQty * lowerCostPerBond) / totalExcessCost : null;
	const afterUpperWeight = totalExcessCost > 0 ? (upperExcessQty * upperCostPerBond) / totalExcessCost : null;

	const HDR = [
		'CUSIP', 'Qty', 'Maturity', 'FY', 'Principal', 'Interest', 'ARA', 'Cost',
		'Target Qty', 'Qty Delta', 'Target Cost', 'Cost Delta', 'ARA (Before)',
		'ARA-DARA Before', 'ARA (After)', 'ARA-DARA After', 'Excess $ Before', 'Excess $ After'
	];

	const summary = {
		settleDateDisp, refCPI, DARA, inferredDARA, method,
		firstYear, lastYear, rungCount, gapYears, gapParams,
		brackets, lowerDuration, upperDuration, lowerWeight, upperWeight,
		beforeLowerWeight, beforeUpperWeight, afterLowerWeight, afterUpperWeight,
		costDeltaSum, initialCash, totalCash
	};

	return { results, HDR, summary };
}

// ─── BRACKET IDENTIFICATION ──────────────────────────────────────────────────

/**
 * Intelligently selects anchor bonds to straddle market holes.
 */
export function identifyBrackets(
	gapYears: number[],
	holdings: Holding[],
	yearInfo: Record<number, { holdings: Holding[] }>,
	tipsByYear: Record<number, TIPS_Bond[]>
): Brackets {
	const targetUpperYear = 2040;
	let upperYear: number | null = null;
	let upperMaturity: Date | null = null;
	let upperCUSIP: string | null = null;

	const sortedTipsYears = Object.keys(tipsByYear).map(Number).sort((a, b) => a - b);
	if (sortedTipsYears.length > 0) {
		upperYear = sortedTipsYears.reduce((prev, curr) => (Math.abs(curr - targetUpperYear) < Math.abs(prev - targetUpperYear) ? curr : prev));
		const bonds = tipsByYear[upperYear];
		const bond = bonds.find((b) => b.maturity?.getMonth() === 1) || bonds[0];
		upperCUSIP = bond.cusip;
		upperMaturity = bond.maturity ?? null;
	}

	const minGapYear = gapYears && gapYears.length > 0 ? Math.min(...gapYears) : 9999;
	let lowerYear: number | null = null;
	let lowerMaturity: Date | null = null;
	let lowerCUSIP: string | null = null;
	let maxQty = -1;

	for (const h of holdings) {
		const year = h.year ?? 0;
		if (year >= LOWEST_LOWER_BRACKET_YEAR && year < minGapYear && h.qty > maxQty) {
			maxQty = h.qty;
			lowerYear = year;
			lowerMaturity = h.maturity ?? null;
			lowerCUSIP = h.cusip;
		}
	}

	if (!lowerCUSIP) {
		for (let y = Math.min(minGapYear - 1, 2035); y >= LOWEST_LOWER_BRACKET_YEAR; y--) {
			if (tipsByYear[y]) {
				const bonds = tipsByYear[y];
				const bond = bonds.find((b) => b.maturity?.getMonth() === 1) || bonds[0];
				lowerYear = y;
				lowerCUSIP = bond.cusip;
				lowerMaturity = bond.maturity ?? null;
				break;
			}
		}
	}

	if (!lowerYear || !lowerMaturity || !lowerCUSIP || !upperMaturity || !upperCUSIP || !upperYear) {
		throw new Error(`Could not find suitable coverage brackets in market data. (Found Lower: ${lowerYear}, Upper: ${upperYear})`);
	}

	return { lowerYear, lowerMaturity, lowerCUSIP, upperYear, upperMaturity, upperCUSIP };
}
