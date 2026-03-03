// @ts-check
/**
 * @typedef {Object} TIPS_Bond
 * @property {string} cusip
 * @property {Date} maturity
 * @property {number} coupon
 * @property {number} baseCpi
 * @property {string} [datedDate]
 * @property {number|null} price
 * @property {number|null} yield
 */

/**
 * @typedef {Object} Holding
 * @property {string} cusip
 * @property {number} qty
 * @property {Date} [maturity]
 * @property {number} [year]
 */

/**
 * @typedef {Object} GapParameters
 * @property {number} avgDuration
 * @property {number} totalCost
 */

/**
 * @typedef {Object} Brackets
 * @property {number} lowerYear
 * @property {Date} lowerMaturity
 * @property {string} lowerCUSIP
 * @property {number} upperYear
 * @property {Date} upperMaturity
 * @property {string} upperCUSIP
 */

export const LOWEST_LOWER_BRACKET_YEAR = 2032;

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Parses YYYY-MM-DD as local date (not UTC)
 * @param {string} str 
 * @returns {Date}
 */
export function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * @param {Date} date 
 * @returns {string}
 */
export function toDateStr(date) {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

/**
 * @param {Date} date 
 * @returns {string}
 */
export function fmtDate(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = String(date.getFullYear()).slice(2);
  return `${m}/${d}/${y}`;
}

// ─── Yield and Duration Math ──────────────────────────────────────────────────

/**
 * Yield from price (actual/actual, matches Excel YIELD(...,2,1))
 * @param {number} cleanPrice 
 * @param {number} coupon 
 * @param {string} settleDateStr 
 * @param {string} maturityStr 
 * @returns {number|null}
 */
export function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = localDate(settleDateStr);
  const mature = localDate(maturityStr);
  if (settle >= mature) return null;

  const semiCoupon = (coupon / 2) * 100;
  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      candidates.push(new Date(y, cm1 - 1, 15));
      candidates.push(new Date(y, cm2 - 1, 15));
    }
    candidates.sort((a, b) => a.getTime() - b.getTime());
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

  const days = (/** @type {Date} */ a, /** @type {Date} */ b) => (b.getTime() - a.getTime()) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const dirtyPrice = cleanPrice + accrued;
  const w = DSC / E;

  const coupons = [];
  let d = new Date(nextCoupon);
  while (d <= mature) {
    coupons.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 6, 15);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(/** @type {number} */ y)  {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(/** @type {number} */ y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
    }
    return s;
  }

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
 * @param {Date} settlement 
 * @param {Date} maturity 
 * @returns {number}
 */
export function getNumPeriods(settlement, maturity) {
  const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 +
                 (maturity.getMonth() - settlement.getMonth());
  return Math.ceil(months / 6);
}

/**
 * @param {Date} settlement 
 * @param {Date} maturity 
 * @param {number} coupon 
 * @param {number} yld 
 * @returns {number}
 */
export function calculateDuration(settlement, maturity, coupon, yld) {
  const settle = new Date(settlement);
  const mature = new Date(maturity);
  const periods = getNumPeriods(settle, mature);
  let weightedSum = 0, pvSum = 0;
  for (let i = 1; i <= periods; i++) {
    const cashflow = i === periods ? 1000 + coupon * 1000 / 2 : coupon * 1000 / 2;
    const pv = cashflow / Math.pow(1 + yld / 2, i);
    weightedSum += i * pv;
    pvSum += pv;
  }
  return weightedSum / pvSum / 2;
}

/**
 * @param {Date} settlement 
 * @param {Date} maturity 
 * @param {number} coupon 
 * @param {number} yld 
 * @returns {number}
 */
export function calculateMDuration(settlement, maturity, coupon, yld) {
  return calculateDuration(settlement, maturity, coupon, yld) / (1 + yld / 2);
}

// ─── Financial Logic ──────────────────────────────────────────────────────────

/**
 * PI per bond
 * @param {string} cusip 
 * @param {Date} maturity 
 * @param {number} refCPI 
 * @param {Map<string, TIPS_Bond>} tipsMap 
 * @returns {number}
 */
export function calculatePIPerBond(cusip, maturity, refCPI, tipsMap) {
  const bond = tipsMap.get(cusip);
  const coupon  = bond?.coupon  ?? 0;
  const baseCpi = bond?.baseCpi ?? refCPI; // default 1:1 index ratio if not found
  const indexRatio = refCPI / baseCpi;
  const adjustedPrincipal = 1000 * indexRatio;
  const adjustedAnnualInterest = adjustedPrincipal * coupon;
  const monthF = new Date(maturity).getMonth() + 1;
  const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
  return adjustedPrincipal + lastYearInterest;
}

/**
 * @param {number[]} gapYears 
 * @param {Date} settlementDate 
 * @param {number} refCPI 
 * @param {Map<string, TIPS_Bond>} tipsMap 
 * @param {number} DARA 
 * @param {Holding[]} holdings 
 * @returns {GapParameters}
 */
export function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings) {
  /** @type {Record<number, Holding[]>} */
  const holdingsByYear = {};
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
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        laterMaturityFrom2041Plus += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }

  const tips2040 = holdingsByYear[2040] ? holdingsByYear[2040][0] : null;
  if (!tips2040) throw new Error('No holdings found for 2040');
  if (!tips2040.maturity) throw new Error('2040 holding missing maturity');

  const piPerBond2040 = calculatePIPerBond(tips2040.cusip, tips2040.maturity, refCPI, tipsMap);
  const targetQty2040 = Math.round((DARA - laterMaturityFrom2041Plus) / piPerBond2040);

  const bond2040 = tipsMap.get(tips2040.cusip);
  const coupon2040 = bond2040?.coupon ?? 0;
  const baseCpi2040 = bond2040?.baseCpi ?? refCPI;
  const indexRatio2040 = refCPI / baseCpi2040;
  const annualInterest2040 = targetQty2040 * 1000 * indexRatio2040 * coupon2040;

  /** @type {Record<number, number>} */
  const gapLaterMaturityInterest = { 2040: annualInterest2040 };
  for (const yearStr in holdingsByYear) {
    const year = parseInt(yearStr);
    if (year > 2040) {
      gapLaterMaturityInterest[year] = 0;
      for (const h of holdingsByYear[year]) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        gapLaterMaturityInterest[year] += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }

  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  /** @type {{maturity: Date, yield: number} | null} */
  let anchorBefore = null;
  /** @type {{maturity: Date, yield: number} | null} */
  let anchorAfter = null;

  for (const bond of tipsMap.values()) {
    if (!bond.maturity || bond.yield === null) continue;
    const year  = bond.maturity.getFullYear();
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
    const syntheticYield = anchorBefore.yield +
      (syntheticMat.getTime() - anchorBefore.maturity.getTime()) * (anchorAfter.yield - anchorBefore.yield) /
      (anchorAfter.maturity.getTime() - anchorBefore.maturity.getTime());
    const syntheticCoupon = Math.max(0.00125, Math.floor(syntheticYield * 100 / 0.125) * 0.00125);

    totalDuration += calculateMDuration(settlementDate, syntheticMat, syntheticCoupon, syntheticYield);

    let sumLaterMaturityInterest = 0;
    for (const futYearStr in gapLaterMaturityInterest) {
      const futYear = parseInt(futYearStr);
      if (futYear > year) sumLaterMaturityInterest += gapLaterMaturityInterest[futYear];
    }

    const piPerBond = 1000 + 1000 * syntheticCoupon * 0.5;
    const qty = Math.round((DARA - sumLaterMaturityInterest) / piPerBond);
    totalCost += qty * 1000;
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost };
}

/**
 * @param {number[]} gapYears 
 * @param {Holding[]} holdings 
 * @param {Record<number, {holdings: Holding[]}>} yearInfo 
 * @returns {Brackets}
 */
export function identifyBrackets(gapYears, holdings, yearInfo) {
  const upperYear = 2040;
  /** @type {Date|null} */
  let upperMaturity = null;
  /** @type {string|null} */
  let upperCUSIP = null;
  let maxQty = 0;

  if (yearInfo[upperYear]) {
    for (const h of yearInfo[upperYear].holdings) {
      if (h.qty > maxQty) {
        maxQty = h.qty;
        upperMaturity = h.maturity ?? null;
        upperCUSIP = h.cusip;
      }
    }
  }

  const minGapYear = Math.min(...gapYears);
  /** @type {number|null} */
  let lowerYear = null;
  /** @type {Date|null} */
  let lowerMaturity = null;
  /** @type {string|null} */
  let lowerCUSIP = null;
  maxQty = 0;

  for (const h of holdings) {
    const year = h.year ?? 0;
    if (year >= LOWEST_LOWER_BRACKET_YEAR && year < minGapYear && h.qty > maxQty) {
      maxQty = h.qty;
      lowerYear = year;
      lowerMaturity = h.maturity ?? null;
      lowerCUSIP = h.cusip;
    }
  }

  if (!lowerYear || !lowerMaturity || !lowerCUSIP || !upperMaturity || !upperCUSIP) {
    throw new Error(`Could not find full brackets. Lower: ${lowerYear}, Upper: ${upperYear}`);
  }

  return { lowerYear, lowerMaturity, lowerCUSIP, upperYear, upperMaturity, upperCUSIP };
}
