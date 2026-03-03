#!/usr/bin/env node
// @ts-check

// TIPS Ladder Rebalancing Engine — Node.js port of RebalnceForDurationMatch.js
// Usage: node rebalance.js [--dara AMOUNT] [--method Full|Gap] [holdings.csv]

import fs from 'fs';
import path from 'path';
import readline from 'readline';

import {
  LOWEST_LOWER_BRACKET_YEAR,
  localDate,
  toDateStr,
  fmtDate,
  yieldFromPrice,
  calculateMDuration,
  calculatePIPerBond,
  calculateGapParameters,
  identifyBrackets
} from './rebalance-engine.js';

// ─── Configuration ───────────────────────────────────────────────────────────
const REFCPI_CUSIP = '912810FD5'; // matures 04/15/2028 — replace after that

const FEDINVEST_URL = 'https://www.treasurydirect.gov/GA-FI/FedInvest/securityPriceDetail';
const TIPSREF_URL =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query' +
  '?format=json&sort=maturity_date' +
  '&filter=inflation_index_security:eq:Yes,reopening:eq:No' +
  '&fields=cusip,ref_cpi_on_dated_date,dated_date,maturity_date,security_term,int_rate' +
  '&page[number]=1&page[size]=150';

// ─── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let dara = null, method = null, holdingsFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dara')   { dara = parseFloat(args[++i]); continue; }
    if (args[i] === '--method') { const m = args[++i]; method = m[0].toUpperCase() + m.slice(1).toLowerCase(); continue; }
    holdingsFile = args[i];
  }

  return { dara, method, holdingsFile };
}

// ─── Interactive prompts (simulates web form inputs) ─────────────────────────
async function promptInputs(holdingsFile, dara, method) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = prompt => new Promise(resolve => rl.question(prompt, resolve));

  if (!holdingsFile) {
    holdingsFile = (await ask('Holdings CSV path [e.g. data/holdings.csv]: ')).trim();
  }
  if (dara === null) {
    const ans = (await ask('DARA (leave blank to infer from holdings): ')).trim();
    dara = ans ? parseFloat(ans) : null;
  }
  if (method === null) {
    const ans = (await ask('Rebalance method — Gap or Full [default: Gap]: ')).trim();
    method = ans.toLowerCase() === 'full' ? 'Full' : 'Gap';
  }

  rl.close();
  return { holdingsFile, dara, method };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function mostRecentWeekday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return d;
}

// ─── FedInvest fetch ──────────────────────────────────────────────────────────
async function fetchTipsPrices(date) {
  const day   = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year  = String(date.getFullYear());

  const body = new URLSearchParams({
    priceDateDay: day, priceDateMonth: month, priceDateYear: year,
    fileType: 'csv', csv: 'CSV FORMAT'
  });

  const res = await fetch(FEDINVEST_URL, { method: 'POST', body });
  if (!res.ok) throw new Error(`FedInvest HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  return lines.slice(1)
    .map(line => {
      const c = line.split(',').map(s => s.trim());
      return {
        cusip:    c[0],
        type:     c[1],
        coupon:   parseFloat(c[2]),   // decimal (e.g. 0.00125)
        maturity: c[3],               // YYYY-MM-DD
        buy:  parseFloat(c[5]) || 0,
        sell: parseFloat(c[6]) || 0,
        eod:  parseFloat(c[7]) || 0,
      };
    })
    .filter(r => r.type === 'TIPS');
}

// ─── Base CPI / metadata fetch (Treasury FiscalData auctions_query) ───────────
async function fetchBaseCpi() {
  const res = await fetch(TIPSREF_URL);
  if (!res.ok) throw new Error(`FiscalData HTTP ${res.status}`);
  const json = await res.json();
  return json.data.map(r => ({
    cusip:     r.cusip,
    baseCpi:   parseFloat(r.ref_cpi_on_dated_date),
    coupon:    parseFloat(r.int_rate) / 100,
    maturity:  r.maturity_date,
    datedDate: r.dated_date,
  }));
}

// ─── Settlement CPI fetch (TreasuryDirect secindex) ───────────────────────────
async function fetchSettlementCpi(dateStr) {
  const url =
    `https://www.treasurydirect.gov/TA_WS/secindex/search?cusip=${REFCPI_CUSIP}` +
    `&format=jsonp&callback=jQuery_CUSIP_FETCHER&filterscount=0&groupscount=0` +
    `&sortdatafield=indexDate&sortorder=asc&pagenum=0&pagesize=1000` +
    `&recordstartindex=0&recordendindex=1000&_=${Date.now()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TreasuryDirect HTTP ${res.status}`);
  const text = await res.text();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse refCPI JSONP');

  const rows = JSON.parse(match[0]).map(r => ({
    date:   r.indexDate.split('T')[0],
    refCpi: parseFloat(r.refCpi),
  }));

  // Find exact match or nearest prior date
  const prior = rows.filter(r => r.date <= dateStr);
  if (prior.length === 0) throw new Error(`No settlement CPI data on or before ${dateStr}`);
  const row = prior[prior.length - 1];
  if (row.date !== dateStr) {
    console.error(`No settlement CPI for ${dateStr}, using ${row.date}`);
  }
  return row.refCpi;
}

// ─── Build unified TIPS map (keyed by CUSIP) ─────────────────────────────────
function buildTipsMap(baseCpiRows, priceRows, settleDateStr) {
  const map = new Map();
  for (const r of baseCpiRows) {
    map.set(r.cusip, {
      cusip:     r.cusip,
      maturity:  localDate(r.maturity),
      coupon:    r.coupon,
      baseCpi:   r.baseCpi,
      datedDate: r.datedDate,
      price:     null,
      yield:     null,
    });
  }
  for (const r of priceRows) {
    const entry = map.get(r.cusip);
    if (!entry) continue;
    const price = r.sell || r.eod || r.buy || null;
    if (price) {
      entry.price = price;
      entry.yield = yieldFromPrice(price, entry.coupon, settleDateStr, toDateStr(entry.maturity));
    }
  }
  return map;
}

// ─── Main engine ─────────────────────────────────────────────────────────────
async function main() {
  let { dara, method, holdingsFile } = parseArgs();

  // ── Prompt for any missing inputs ──
  ({ holdingsFile, dara, method } = await promptInputs(holdingsFile, dara, method));

  // ── Load holdings ──
  const holdingsRaw = fs.readFileSync(holdingsFile, 'utf8')
    .trim().split('\n')
    .filter(l => l.trim())
    .map(line => {
      const [cusip, qty] = line.split(',').map(s => s.trim());
      return { cusip, qty: parseInt(qty, 10) };
    });

  // ── Fetch TIPS prices ──
  console.error('Fetching TIPS prices from FedInvest...');
  let priceRows = [];
  let priceDate = mostRecentWeekday();
  for (let attempt = 0; attempt < 5; attempt++) {
    priceRows = await fetchTipsPrices(priceDate);
    if (priceRows.length > 0) break;
    console.error(`No data for ${toDateStr(priceDate)}, trying previous weekday...`);
    priceDate.setDate(priceDate.getDate() - 1);
    priceDate = mostRecentWeekday(priceDate);
  }
  if (priceRows.length === 0) throw new Error('No TIPS price data found');

  const settlementDate = priceDate;
  const settleDateStr  = toDateStr(settlementDate);
  const settleDateDisp = fmtDate(settlementDate);
  console.error(`Settlement date: ${settleDateStr}`);

  console.error('Fetching base CPI from Treasury FiscalData...');
  const baseCpiRows = await fetchBaseCpi();

  console.error('Fetching settlement CPI from TreasuryDirect...');
  const refCPI = await fetchSettlementCpi(settleDateStr);
  console.error(`Settlement CPI: ${refCPI}`);

  // ── Build unified TIPS map ──
  const tipsMap = buildTipsMap(baseCpiRows, priceRows, settleDateStr);

  // ── Build holdings list ──
  const holdings = [];
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) {
      console.error(`Warning: CUSIP ${h.cusip} not found in TIPS data — skipping`);
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

  // ── DARA calculation ──
  const yearInfo = {};
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });

  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const firstYear = holdingsYears[0];
  let lastYear = firstYear;
  for (let i = 0; i < holdingsYears.length; i++) {
    const year = holdingsYears[i];
    if (year <= 2040) { lastYear = year; continue; }
    const nextExpected = year + 1;
    const nextInHoldings = holdingsYears[i + 1];
    if (nextInHoldings && nextInHoldings === nextExpected) { lastYear = nextInHoldings; }
    else { lastYear = year; break; }
  }

  const tipsMapYears = new Set();
  for (const bond of tipsMap.values()) {
    if (bond.maturity) tipsMapYears.add(bond.maturity.getFullYear());
  }
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!tipsMapYears.has(year) && !yearInfo[year]) gapYears.push(year);
  }

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
      const coupon = bond?.coupon ?? 0;
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
  const rungCount = lastYear - firstYear + 1;
  const inferredDARA = araSum / rungCount;
  const DARA = dara !== null ? dara : inferredDARA;

  const isFullMode = (method === 'Full');

  console.error(`DARA: ${DARA.toFixed(2)}${dara === null ? ' (inferred)' : ''}`);
  console.error(`Method: ${method}`);
  console.error(`First year: ${firstYear}, Last year: ${lastYear}`);
  console.error(`Gap years: ${gapYears.join(', ')}`);

  // ── Rebalance logic ──
  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings);
  const brackets = identifyBrackets(gapYears, holdings, yearInfo);

  const lowerBond = tipsMap.get(brackets.lowerCUSIP);
  const upperBond = tipsMap.get(brackets.upperCUSIP);
  const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity, lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0);
  const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity, upperBond?.coupon ?? 0, upperBond?.yield ?? 0);

  const lowerWeight = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
  const upperWeight = 1 - lowerWeight;

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

  const buySellTargets = {};
  const postRebalQtyMap = {};
  for (const h of holdings) postRebalQtyMap[h.cusip] = h.qty;

  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {};

  for (const year of allYearsSorted) {
    if (gapYearSet.has(year)) continue;
    yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;

    const yi = yearInfo[year];
    const isBracket = bracketYearSet.has(year);
    const isRebal = rebalYearSet.has(year);

    let targetCUSIP = null, targetMaturity = null, maxQty = 0;
    for (const h of yi.holdings) {
      if (h.qty > maxQty) { maxQty = h.qty; targetCUSIP = h.cusip; targetMaturity = h.maturity; }
    }
    if (!targetCUSIP || !targetMaturity) continue;

    const targetBond = tipsMap.get(targetCUSIP);
    const tPrice = targetBond?.price ?? 0;
    const tBaseCpi = targetBond?.baseCpi ?? refCPI;
    const tIndexRatio = refCPI / tBaseCpi;
    const costPerBond = tPrice / 100 * tIndexRatio * 1000;

    const currentHolding = yi.holdings.find(h => h.cusip === targetCUSIP);
    const currentQty = currentHolding ? currentHolding.qty : 0;

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
      postRebalQty = isBracket ? targetFYQty + Math.round(bracketExcessTarget[year] / costPerBond) : targetFYQty;
    } else {
      targetFYQty = currentQty;
      postRebalQty = currentQty;
    }

    if (isBracket || isRebal) {
      buySellTargets[year] = {
        targetCUSIP, targetFYQty,
        targetQty: postRebalQty, postRebalQty, qtyDelta: postRebalQty - currentQty,
        targetCost: targetFYQty * costPerBond,
        costDelta: -((postRebalQty - currentQty) * costPerBond),
        costPerBond, isBracket,
        currentExcessCost: isBracket ? (currentQty - bracketTargetFYQtyBefore[year]) * costPerBond : undefined,
      };
    }

    postRebalQtyMap[targetCUSIP] = postRebalQty;
    for (const h of yi.holdings) {
      const qtyForInt = h.cusip === targetCUSIP ? postRebalQty : h.qty;
      const bond = tipsMap.get(h.cusip);
      rebuildLaterMatInt += qtyForInt * 1000 * (refCPI / (bond?.baseCpi ?? refCPI)) * (bond?.coupon ?? 0);
    }
  }

  // ── ARA Before/After ──
  const beforeARAByYear = {};
  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    for (const yStr in araLaterMaturityInterestByYear) if (parseInt(yStr) > year) laterMatInt += araLaterMaturityInterestByYear[yStr];
    let yearP = 0, yearI = 0;
    for (const h of yearInfo[year].holdings) {
      const bond = tipsMap.get(h.cusip);
      const ir = refCPI / (bond?.baseCpi ?? refCPI);
      const qtyARA = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP) ? bracketTargetFYQtyBefore[year] : h.qty;
      yearP += qtyARA * 1000 * ir;
      const adjInt = 1000 * ir * (bond?.coupon ?? 0);
      yearI += qtyARA * ((h.maturity.getMonth() + 1) < 7 ? adjInt * 0.5 : adjInt);
    }
    beforeARAByYear[year] = yearP + yearI + laterMatInt;
  }

  const postARAByYear = {};
  for (const year of allYearsSorted) {
    const laterMatInt = yearLaterMatIntSnapshot[year] ?? 0;
    let yearP = 0, yearI = 0;
    for (const h of yearInfo[year].holdings) {
      const bond = tipsMap.get(h.cusip);
      const ir = refCPI / (bond?.baseCpi ?? refCPI);
      const bt = buySellTargets[year];
      const qtyARA = (bt && h.cusip === bt.targetCUSIP) ? (bt.isBracket ? bt.targetFYQty : bt.postRebalQty) : postRebalQtyMap[h.cusip];
      yearP += qtyARA * 1000 * ir;
      const adjInt = 1000 * ir * (bond?.coupon ?? 0);
      yearI += qtyARA * ((h.maturity.getMonth() + 1) < 7 ? adjInt * 0.5 : adjInt);
    }
    postARAByYear[year] = yearP + yearI + laterMatInt;
  }

  // ── Results table ──
  const results = [];
  const outLaterInt = {};
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLast = (yearInfo[h.year].lastIdx === i);
    let sumLaterInt = 0;
    for (const yStr in outLaterInt) if (parseInt(yStr) > h.year) sumLaterInt += outLaterInt[yStr];

    let fy='', pFY='', iFY='', aFY='', cFY='', tQ='', qD='', tC='', cD='', aB='', amdB='', aA='', amdA='', eB='', eA='';
    if (isLast) {
      let yearP=0, yearI=0, yearCost=0;
      for (const hy of yearInfo[h.year].holdings) {
        const bond = tipsMap.get(hy.cusip);
        const ir = refCPI / (bond?.baseCpi ?? refCPI);
        yearP += hy.qty * 1000 * ir;
        const adjInt = 1000 * ir * (bond?.coupon ?? 0);
        yearI += hy.qty * ((hy.maturity.getMonth() + 1) < 7 ? adjInt * 0.5 : adjInt);
        yearCost += hy.qty * ((bond?.price ?? 0) / 100 * ir * 1000);
      }
      fy=h.year; pFY=yearP; iFY=yearI+sumLaterInt; aFY=pFY+iFY; cFY=yearCost;
      aB=beforeARAByYear[h.year]; amdB=aB-DARA; aA=postARAByYear[h.year]; amdA=aA-DARA;
    }
    const bt = buySellTargets[h.year];
    if (bt && h.cusip === bt.targetCUSIP) { tQ=bt.targetQty; qD=bt.qtyDelta; tC=bt.targetCost; cD=bt.costDelta; if(bt.isBracket){ eB=bt.currentExcessCost; eA=(bt.postRebalQty-bt.targetFYQty)*bt.costPerBond; }}

    const bond = tipsMap.get(h.cusip);
    if (!outLaterInt[h.year]) outLaterInt[h.year] = 0;
    outLaterInt[h.year] += h.qty * 1000 * (refCPI / (bond?.baseCpi ?? refCPI)) * (bond?.coupon ?? 0);

    results.unshift([h.cusip, h.qty, fmtDate(h.maturity), fy, pFY, iFY, aFY, cFY, tQ, qD, tC, cD, aB, amdB, aA, amdA, eB, eA]);
  }

  // ── Output ──
  const costDeltaSum = results.reduce((sum, row) => sum + (typeof row[11] === 'number' ? row[11] : 0), 0);
  const fmtI = n => typeof n === 'number' ? Math.round(n).toLocaleString() : String(n);
  const sign = n => typeof n === 'number' && n > 0 ? '+' + Math.round(n) : String(Math.round(n) || n);
  const pct = n => typeof n === 'number' ? (n * 100).toFixed(1) + '%' : 'N/A';

  console.log(`\nSettlement: ${settleDateDisp}  |  RefCPI: ${refCPI}  |  DARA: ${fmtI(DARA)}`);
  console.log(`Net cash: ${sign(costDeltaSum)}`);

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost','Target Qty','Qty Delta','Target Cost','Cost Delta','ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After','Excess $ Before','Excess $ After'];
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const mainTableRows = results.map(r => '<tr>' + r.map((v, ci) => `<td class="${ci>=4?'num':''}">${typeof v==='number'?(ci===1||ci===3?v:v.toLocaleString()):esc(v)}</td>`).join('') + '</tr>').join('\n');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>TIPS Rebalance</title><style>body{font-family:system-ui;font-size:13px;padding:20px}table{border-collapse:collapse;width:100%}th{background:#222;color:#fff;padding:5px;text-align:right}td{padding:4px;border-bottom:1px solid #eee;text-align:right}.num{font-variant-numeric:tabular-nums}.pos{color:green}.neg{color:red}</style></head><body><h1>TIPS Rebalance</h1><p>Settlement: ${settleDateDisp} | RefCPI: ${refCPI} | DARA: ${fmtI(DARA)}</p><table><thead><tr>${HDR.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${mainTableRows}</tbody></table></body></html>`;
  fs.writeFileSync(path.join(path.dirname(holdingsFile), 'output.html'), html);
  console.log(`Output written to ${path.join(path.dirname(holdingsFile), 'output.html')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
