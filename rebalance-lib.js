// TIPS Ladder Rebalancing — browser-compatible ES module
// Pure computation only — no Node.js I/O, no file system, no CLI.

import {
  LOWEST_LOWER_BRACKET_YEAR,
  localDate,
  toDateStr,
  fmtDate,
  calculateMDuration,
  calculatePIPerBond,
  calculateGapParameters,
  identifyBrackets
} from './rebalance-engine.js';

/**
 * Build tipsMap from TipsYields.csv rows
 * @param {any[]} rows 
 * @returns {Map<string, import('./rebalance-engine.js').TIPS_Bond>}
 */
export function buildTipsMapFromYields(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(r.cusip, {
      cusip:    r.cusip,
      maturity: localDate(r.maturity),
      coupon:   r.coupon,
      baseCpi:  r.baseCpi,
      price:    r.price  || null,
      yield:    r.yield  || null,
    });
  }
  return map;
}

/**
 * @param {{
 *  dara: number|null,
 *  method: 'Gap'|'Full',
 *  holdings: any[],
 *  tipsMap: Map<string, import('./rebalance-engine.js').TIPS_Bond>,
 *  refCPI: number,
 *  settlementDate: Date
 * }} params
 */
export function runRebalance({ dara, method, holdings: holdingsRaw, tipsMap, refCPI, settlementDate }) {
  const settleDateStr  = toDateStr(settlementDate);
  const settleDateDisp = fmtDate(settlementDate);

  // Enrich holdings with maturity from tipsMap
  const holdings = [];
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) {
      console.warn(`Warning: CUSIP ${h.cusip} not found in TIPS data — skipping`);
      continue;
    }
    holdings.push({
      cusip:    h.cusip,
      qty:      h.qty,
      maturity: bond.maturity,
      year:     bond.maturity.getFullYear(),
    });
  }
  holdings.sort((a, b) => a.maturity.getTime() - b.maturity.getTime());

  // Build yearInfo
  const yearInfo = {};
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });

  // Determine firstYear / lastYear
  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const firstYear = holdingsYears[0];
  let lastYear = firstYear;
  for (let i = 0; i < holdingsYears.length; i++) {
    const year = holdingsYears[i];
    if (year <= 2040) { lastYear = year; continue; }
    const nextExpected   = year + 1;
    const nextInHoldings = holdingsYears[i + 1];
    if (nextInHoldings && nextInHoldings === nextExpected) { lastYear = nextInHoldings; }
    else { lastYear = year; break; }
  }

  // Gap years: in range, no TIPS in market and no holdings
  const tipsMapYears = new Set();
  for (const bond of tipsMap.values()) {
    if (bond.maturity) tipsMapYears.add(bond.maturity.getFullYear());
  }
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!tipsMapYears.has(year) && !yearInfo[year]) gapYears.push(year);
  }

  // ARA per year (for inferred DARA and before-state display)
  const araLaterMaturityInterestByYear = {};
  const araByYear = {};
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
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = (holding.maturity?.getMonth() ?? 0) + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      yearPrincipal += holding.qty * adjustedPrincipal;
      yearLastYearInterest += holding.qty * lastYearInterest;
      araLaterMaturityInterestByYear[year] += holding.qty * adjustedAnnualInterest;
    }
    araByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  let araSum = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    if (araByYear[year] !== undefined) araSum += araByYear[year];
  }
  const rungCount    = lastYear - firstYear + 1;
  const inferredDARA = araSum / rungCount;
  const DARA         = dara !== null ? dara : inferredDARA;
  const isFullMode   = (method === 'Full');

  // Phase 2: Gap parameters
  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings);

  // Phase 3a: Brackets + durations + weights
  const brackets      = identifyBrackets(gapYears, holdings, yearInfo);
  const lowerBond     = tipsMap.get(brackets.lowerCUSIP);
  const upperBond     = tipsMap.get(brackets.upperCUSIP);
  const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity,
    lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0);
  const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity,
    upperBond?.coupon ?? 0, upperBond?.yield ?? 0);
  const lowerWeight   = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
  const upperWeight   = 1 - lowerWeight;

  // Phase 3b: Before-state bracket excess (display only)
  const bracketYearSet = new Set([brackets.lowerYear, brackets.upperYear]);
  const gapYearSet     = new Set(gapYears);
  const minGapYear     = Math.min(...gapYears);

  const bracketTargetFYQtyBefore = {};
  for (const [bracketYear, bracketCUSIP, bracketMaturity] of /** @type {const} */ ([
    [brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity],
    [brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity],
  ])) {
    let laterMatIntBefore = 0;
    for (const yStr in araLaterMaturityInterestByYear) {
      if (parseInt(yStr) > bracketYear) laterMatIntBefore += araLaterMaturityInterestByYear[yStr];
    }
    const yh = yearInfo[bracketYear].holdings;
    let tFYQty;
    if (yh.length === 1) {
      tFYQty = Math.round((DARA - laterMatIntBefore) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap));
    } else {
      let nonPI = 0;
      for (const h of yh) {
        if (h.cusip !== bracketCUSIP) nonPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);
      }
      tFYQty = Math.round((DARA - laterMatIntBefore - nonPI) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap));
    }
    bracketTargetFYQtyBefore[bracketYear] = tFYQty;
  }

  // Phase 4: Ladder rebuild (longest to shortest)
  let rebalYearSet;
  if (isFullMode) {
    rebalYearSet = new Set(
      Object.keys(yearInfo).map(Number)
        .filter(y => y >= firstYear && y <= lastYear && !bracketYearSet.has(y) && !gapYearSet.has(y))
    );
  } else {
    rebalYearSet = new Set(
      Object.keys(yearInfo).map(Number)
        .filter(y => y > brackets.lowerYear && y < minGapYear)
    );
  }

  const bracketExcessTarget = {
    [brackets.lowerYear]: gapParams.totalCost * lowerWeight,
    [brackets.upperYear]: gapParams.totalCost * upperWeight,
  };

  const buySellTargets  = {};
  const postRebalQtyMap = {};
  for (const h of holdings) postRebalQtyMap[h.cusip] = h.qty;

  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {};

  for (const year of allYearsSorted) {
    if (gapYearSet.has(year)) continue;

    yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;

    const yi        = yearInfo[year];
    const isBracket = bracketYearSet.has(year);
    const isRebal   = rebalYearSet.has(year);

    let targetCUSIP = null, targetMaturity = null, maxQty = 0;
    for (const h of yi.holdings) {
      if (h.qty > maxQty) { maxQty = h.qty; targetCUSIP = h.cusip; targetMaturity = h.maturity; }
    }

    if (!targetCUSIP || !targetMaturity) continue;

    const targetBondR  = tipsMap.get(targetCUSIP);
    const tPrice       = targetBondR?.price ?? 0;
    const tBaseCpi     = targetBondR?.baseCpi ?? refCPI;
    const tIndexRatio  = refCPI / tBaseCpi;
    const costPerBond  = tPrice / 100 * tIndexRatio * 1000;

    const currentHolding = yi.holdings.find(h => h.cusip === targetCUSIP);
    const currentQty     = currentHolding ? currentHolding.qty : 0;

    let targetFYQty, postRebalQty;

    if (isBracket || isRebal) {
      if (yi.holdings.length === 1) {
        targetFYQty = Math.round((DARA - rebuildLaterMatInt) / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap));
      } else {
        let nonTargetPI = 0;
        for (const h of yi.holdings) {
          if (h.cusip !== targetCUSIP) nonTargetPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);
        }
        targetFYQty = Math.round((DARA - rebuildLaterMatInt - nonTargetPI) / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap));
      }
      postRebalQty = isBracket
        ? targetFYQty + Math.round(bracketExcessTarget[year] / costPerBond)
        : targetFYQty;
    } else {
      targetFYQty  = currentQty;
      postRebalQty = currentQty;
    }

    if (isBracket || isRebal) {
      buySellTargets[year] = {
        targetCUSIP, targetFYQty,
        targetQty: postRebalQty, postRebalQty, qtyDelta: postRebalQty - currentQty,
        targetCost:        targetFYQty * costPerBond,
        costDelta:         -((postRebalQty - currentQty) * costPerBond),
        costPerBond, isBracket,
        currentExcessCost: isBracket
          ? (currentQty - bracketTargetFYQtyBefore[year]) * costPerBond
          : undefined,
      };
    }

    postRebalQtyMap[targetCUSIP] = postRebalQty;
    for (const h of yi.holdings) {
      const qtyForInt = h.cusip === targetCUSIP ? postRebalQty : h.qty;
      const bond = tipsMap.get(h.cusip);
      const c  = bond?.coupon  ?? 0;
      const bc = bond?.baseCpi ?? refCPI;
      const ir = refCPI / bc;
      rebuildLaterMatInt += qtyForInt * 1000 * ir * c;
    }
  }

  // Before ARA
  const beforeARAByYear = {};
  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    for (const yStr in araLaterMaturityInterestByYear) {
      if (parseInt(yStr) > year) laterMatInt += araLaterMaturityInterestByYear[yStr];
    }
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = (holding.maturity?.getMonth() ?? 0) + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      const isBracketTarget = bracketYearSet.has(year) && holding.cusip === buySellTargets[year]?.targetCUSIP;
      const qtyForARA = isBracketTarget ? bracketTargetFYQtyBefore[year] : holding.qty;
      yearPrincipal        += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    beforeARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  // After ARA
  const postARAByYear = {};
  for (const year of allYearsSorted) {
    const laterMatInt = yearLaterMatIntSnapshot[year] ?? 0;
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = (holding.maturity?.getMonth() ?? 0) + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      const bt = buySellTargets[year];
      let qtyForARA;
      if (bt && holding.cusip === bt.targetCUSIP) {
        qtyForARA = bt.isBracket ? bt.targetFYQty : bt.postRebalQty;
      } else {
        qtyForARA = postRebalQtyMap[holding.cusip];
      }
      yearPrincipal        += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    postARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  // Build result rows
  const results = [];
  const outputLaterMaturityInterest = {};

  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLastInYear = (yearInfo[h.year].lastIdx === i);

    let sumLaterMaturityAnnualInterest = 0;
    for (const yearStr in outputLaterMaturityInterest) {
      if (parseInt(yearStr) > h.year) sumLaterMaturityAnnualInterest += outputLaterMaturityInterest[yearStr];
    }

    let fy = '', principalFY = '', interestFY = '', araFY = '', costFY = '';
    let targetQty = '', qtyDelta = '', targetCost = '', costDelta = '';
    let araBeforeFY = '', araMinusDaraBefore = '', araAfterFY = '', araMinusDaraAfter = '';

    if (isLastInYear) {
      let yearPrincipal = 0, yearLastYearInterest = 0, yearCost = 0;
      for (const holding of yearInfo[h.year].holdings) {
        const bond = tipsMap.get(holding.cusip);
        const coupon  = bond?.coupon  ?? 0;
        const price   = bond?.price   ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        const adjustedPrincipal = 1000 * indexRatio;
        yearPrincipal += holding.qty * adjustedPrincipal;
        const adjustedAnnualInterest = adjustedPrincipal * coupon;
        const monthF = (holding.maturity?.getMonth() ?? 0) + 1;
        const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
        yearLastYearInterest += holding.qty * lastYearInterest;
        yearCost += holding.qty * (price / 100 * indexRatio * 1000);
      }
      fy              = h.year;
      principalFY     = yearPrincipal;
      interestFY      = yearLastYearInterest + sumLaterMaturityAnnualInterest;
      araFY           = principalFY + interestFY;
      costFY          = yearCost;
      araBeforeFY        = beforeARAByYear[h.year];
      araMinusDaraBefore = araBeforeFY - DARA;
      araAfterFY         = postARAByYear[h.year];
      araMinusDaraAfter  = araAfterFY - DARA;
    }

    if (buySellTargets[h.year] && h.cusip === buySellTargets[h.year].targetCUSIP) {
      targetQty  = buySellTargets[h.year].targetQty;
      qtyDelta   = buySellTargets[h.year].qtyDelta;
      targetCost = buySellTargets[h.year].targetCost;
      costDelta  = buySellTargets[h.year].costDelta;
    }

    let excessBefore = '', excessAfter = '';
    const bt = buySellTargets[h.year];
    if (bt?.isBracket && h.cusip === bt.targetCUSIP) {
      excessBefore = bt.currentExcessCost;
      excessAfter  = (bt.postRebalQty - bt.targetFYQty) * bt.costPerBond;
    }

    const bond = tipsMap.get(h.cusip);
    const coupon  = bond?.coupon  ?? 0;
    const baseCpi = bond?.baseCpi ?? refCPI;
    const indexRatio = refCPI / baseCpi;
    if (!outputLaterMaturityInterest[h.year]) outputLaterMaturityInterest[h.year] = 0;
    outputLaterMaturityInterest[h.year] += h.qty * 1000 * indexRatio * coupon;

    results.unshift([
      h.cusip, h.qty, fmtDate(h.maturity), fy,
      principalFY, interestFY, araFY, costFY,
      targetQty, qtyDelta, targetCost, costDelta,
      araBeforeFY, araMinusDaraBefore, araAfterFY, araMinusDaraAfter,
      excessBefore, excessAfter,
    ]);
  }

  const costDeltaSum = results.reduce((sum, row) => sum + (typeof row[11] === 'number' ? row[11] : 0), 0);

  // Weight summary
  const lowerBondS       = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS       = tipsMap.get(brackets.upperCUSIP);
  const lowerPrice       = lowerBondS?.price ?? 0;
  const lowerBaseCpi     = lowerBondS?.baseCpi ?? refCPI;
  const lowerCostPerBond = lowerPrice / 100 * (refCPI / lowerBaseCpi) * 1000;
  const upperPrice       = upperBondS?.price ?? 0;
  const upperBaseCpi     = upperBondS?.baseCpi ?? refCPI;
  const upperCostPerBond = upperPrice / 100 * (refCPI / upperBaseCpi) * 1000;

  const lowerCurrentExcess = buySellTargets[brackets.lowerYear].currentExcessCost;
  const upperCurrentExcess = buySellTargets[brackets.upperYear].currentExcessCost;
  const totalCurrentExcess = (lowerCurrentExcess ?? 0) + (upperCurrentExcess ?? 0);

  const lowerPostQty     = buySellTargets[brackets.lowerYear].postRebalQty;
  const upperPostQty     = buySellTargets[brackets.upperYear].postRebalQty;
  const lowerTargetFYQty = buySellTargets[brackets.lowerYear].targetFYQty;
  const upperTargetFYQty = buySellTargets[brackets.upperYear].targetFYQty;
  const lowerExcessQty   = lowerPostQty - lowerTargetFYQty;
  const upperExcessQty   = upperPostQty - upperTargetFYQty;
  const lowerExcessCost  = lowerExcessQty * lowerCostPerBond;
  const upperExcessCost  = upperExcessQty * upperCostPerBond;
  const totalExcessCost  = lowerExcessCost + upperExcessCost;

  const beforeLowerWeight = (totalCurrentExcess > 0 && lowerCurrentExcess !== undefined) ? lowerCurrentExcess / totalCurrentExcess : null;
  const beforeUpperWeight = (totalCurrentExcess > 0 && upperCurrentExcess !== undefined) ? upperCurrentExcess / totalCurrentExcess : null;
  const afterLowerWeight  = totalExcessCost   > 0 ? lowerExcessCost   / totalExcessCost   : null;
  const afterUpperWeight  = totalExcessCost   > 0 ? upperExcessCost   / totalExcessCost   : null;

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost',
               'Target Qty','Qty Delta','Target Cost','Cost Delta',
               'ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After',
               'Excess $ Before','Excess $ After'];

  const summary = {
    settleDateDisp, refCPI, DARA, inferredDARA, method,
    firstYear, lastYear, rungCount, gapYears,
    gapParams, brackets,
    lowerDuration, upperDuration, lowerWeight, upperWeight,
    beforeLowerWeight, beforeUpperWeight, afterLowerWeight, afterUpperWeight,
    costDeltaSum,
  };

  return { results, HDR, summary };
}
