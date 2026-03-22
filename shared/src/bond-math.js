// bond-math.js — Pure per-bond calculations
// No ladder state, no running pools, no side effects.
// Spec: knowledge/2.1_TIPS_Basics.md, knowledge/5.0_Computation_Modules.md §bond-math.js

// ─── Modified duration ────────────────────────────────────────────────────────
// Spec: 5.0 §calculateMDuration
export function getNumPeriods(settlement, maturity) {
  const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 +
                 (maturity.getMonth() - settlement.getMonth());
  return Math.ceil(months / 6);
}

export function calculateDuration(settlement, maturity, coupon, yld) {
  const periods = getNumPeriods(settlement, maturity);
  let weightedSum = 0, pvSum = 0;
  for (let i = 1; i <= periods; i++) {
    const cashflow = i === periods ? 1000 + coupon * 1000 / 2 : coupon * 1000 / 2;
    const pv = cashflow / Math.pow(1 + yld / 2, i);
    weightedSum += i * pv;
    pvSum += pv;
  }
  return weightedSum / pvSum / 2;
}

export function calculateMDuration(settlement, maturity, coupon, yld) {
  return calculateDuration(settlement, maturity, coupon, yld) / (1 + yld / 2);
}

// ─── Per-bond quantities ──────────────────────────────────────────────────────
// Spec: 2.1 TIPS Basics, 5.0 §bondCalcs
// bond: { coupon, baseCpi, price, maturity: Date }
export function bondCalcs(bond, refCPI) {
  const coupon          = bond.coupon  ?? 0;
  const baseCpi         = bond.baseCpi ?? refCPI;
  const indexRatio      = refCPI / baseCpi;
  const principalPerBond = 1000 * indexRatio;
  const costPerBond     = (bond.price ?? 0) / 100 * indexRatio * 1000;
  const nPeriods        = (bond.maturity.getMonth() + 1) < 7 ? 1 : 2;
  const couponPerPeriod = coupon / 2;
  const ownRungInt      = principalPerBond * couponPerPeriod * nPeriods;
  const piPerBond       = principalPerBond + ownRungInt;
  const annualInt       = principalPerBond * coupon;
  return { indexRatio, principalPerBond, costPerBond, nPeriods, couponPerPeriod, ownRungInt, piPerBond, annualInt };
}

// ─── Yield from price (actual/actual, matches Excel YIELD(...,2,1)) ───────────
// Spec: 2.1 TIPS Basics (yield calculations)
// cleanPrice: percentage of par (e.g. 99.5)
// coupon: annual rate (decimal, e.g. 0.0125)
// settle: Date object
// mature: Date object
export function yieldFromPrice(cleanPrice, coupon, settle, mature) {
  if (!cleanPrice || cleanPrice <= 0) return null;
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
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getTime());
  lastCoupon.setMonth(lastCoupon.getMonth() - 6);

  const days = (a, b) => (b.getTime() - a.getTime()) / 86400000;
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
    d = new Date(d.getTime());
    d.setMonth(d.getMonth() + 6);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(y) {
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

// ─── Price from yield (Actual/Actual) ─────────────────────────────────────────
// Spec: PV of cash flows for a bond.
// yld: annual yield (decimal, e.g. 0.02)
// coupon: annual rate (decimal)
// settle: Date object
// mature: Date object
export function priceFromYield(yld, coupon, settle, mature) {
  if (yld === null || yld === undefined) return null;
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
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getTime());
  lastCoupon.setMonth(lastCoupon.getMonth() - 6);

  const days = (a, b) => (b.getTime() - a.getTime()) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const w = DSC / E;

  const coupons = [];
  let d = new Date(nextCoupon);
  while (d <= mature) {
    coupons.push(new Date(d));
    d = new Date(d.getTime());
    d.setMonth(d.getMonth() + 6);
  }
  const N = coupons.length;

  const r = yld / 2;
  let pv = 0;
  for (let k = 0; k < N; k++) {
    const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
    pv += cf / Math.pow(1 + r, w + k);
  }

  return pv - accrued; // Return clean price
}

// ─── Rung amount ──────────────────────────────────────────────────────────────
// Spec: 5.0 §rungAmount, 4.0 Phase 5 ARA After formula
export function rungAmount(qty, piPerBond, laterMatInt) {
  return qty * piPerBond + laterMatInt;
}
