// Treasury Yields Monitor - app.js
import { handleChartKeydown } from '../../shared/src/chart-keys.js';

const AVAILABLE_SYMBOLS = {
  // TIPS
  'US1YTIPS': '1-Year TIPS',
  'US2YTIPS': '2-Year TIPS',
  'US5YTIPS': '5-Year TIPS',
  'US10YTIPS': '10-Year TIPS',
  'US30YTIPS': '30-Year TIPS',
  // Nominal Treasuries
  'US1M': '1-Month',
  'US2M': '2-Month',
  'US3M': '3-Month',
  'US6M': '6-Month',
  'US1Y': '1-Year',
  'US2Y': '2-Year',
  'US5Y': '5-Year',
  'US10Y': '10-Year',
  'US30Y': '30-Year'
};

const MATURITY_ORDER = {
  'US1M': 1, 'US2M': 2, 'US3M': 3, 'US6M': 4, 'US1Y': 5, 'US2Y': 6, 'US5Y': 7, 'US10Y': 8, 'US30Y': 9,
  'US1YTIPS': 5, 'US2YTIPS': 6, 'US5YTIPS': 7, 'US10YTIPS': 8, 'US30YTIPS': 9
};

const COLORS = [
  '#1a56db', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be123c',
  '#4f46e5', '#db2777', '#059669', '#ea580c', '#7c3aed', '#0284c7', '#e11d48'
];

const TIME_RANGE_MAP = {
  '2D': '1D',
  '10D': '5D',
  '1Y': '1M',
  '2Y': '3M',
  '3Y': '6M',
  '10Y': '5Y',
  'ALL': 'ALL'
};

const TIME_RANGES = Object.keys(TIME_RANGE_MAP);

const charts = {}; // symbol -> chartInstance
const historyCache = {}; // symbol -> points (baseline from R2)
const liveCache = {}; // symbol -> points (2D real-time tip)
let activeSymbols = new Set(['US10YTIPS', 'US30YTIPS', 'US10Y', 'US30Y']);
let activeRange = '2D';

async function init() {
  setupUI();
  syncChartContainers();
  updateAllData();

  window.addEventListener('resize', () => {
    Object.values(charts).forEach(c => c.resize());
  });

  window.addEventListener('keydown', (e) => {
    Object.values(charts).forEach(chart => {
      handleChartKeydown(e, chart);
    });
  });
}

function setupUI() {
  const root = document.getElementById('controls-root');
  
  const rangeHtml = TIME_RANGES.map(r => 
    `<button class="range-btn ${r === activeRange ? 'active' : ''}" data-range="${r}">${r}</button>`
  ).join('');

  const tips = Object.keys(AVAILABLE_SYMBOLS).filter(s => s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
  const nominals = Object.keys(AVAILABLE_SYMBOLS).filter(s => !s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);

  const createGrid = (syms) => syms.map(sym => {
    const idx = Object.keys(AVAILABLE_SYMBOLS).indexOf(sym);
    const color = COLORS[idx % COLORS.length];
    return `
      <label class="sym-item-check">
        <input type="checkbox" value="${sym}" ${activeSymbols.has(sym) ? 'checked' : ''}>
        <span class="color-dot" style="background:${color}"></span>
        <span class="sym-code">${sym}</span>
      </label>
    `;
  }).join('');

  root.innerHTML = `
    <style>
      .range-picker { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 20px; }
      .range-btn { flex: 1; min-width: 45px; padding: 6px 0; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px; }
      .range-btn.active { background: #1e293b; color: #fff; border-color: #1e293b; }
      .sym-group h4 { margin: 12px 0 6px; font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; }
      .sym-item-check { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 11px; cursor: pointer; }
      .sym-item-check input { margin: 0; }
      .color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .sym-code { font-weight: 700; color: #1e293b; }
      #fetchStatus { font-size: 11px; color: #64748b; margin-top: 20px; font-style: italic; }
    </style>
    <div class="range-picker">${rangeHtml}</div>
    <div class="sym-group">
      <h4>TIPS</h4>
      ${createGrid(tips)}
      <h4>Nominal Treasuries</h4>
      ${createGrid(nominals)}
    </div>
    <div id="fetchStatus">Ready</div>
  `;

  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeRange = e.target.dataset.range;
      updateAllData();
    });
  });

  document.querySelectorAll('.sym-item-check input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) activeSymbols.add(e.target.value);
      else activeSymbols.delete(e.target.value);
      syncChartContainers();
      updateAllData();
    });
  });

  document.getElementById('refreshAll').addEventListener('click', updateAllData);
  document.getElementById('resetAllZoom').addEventListener('click', () => {
    Object.values(charts).forEach(c => c.resetZoom());
  });
}

function syncChartContainers() {
  const tipsRow = document.getElementById('tips-row');
  const nominalsRow = document.getElementById('nominals-row');
  
  // Remove charts no longer active
  Object.keys(charts).forEach(sym => {
    if (!activeSymbols.has(sym)) {
      charts[sym].destroy();
      delete charts[sym];
      const card = document.getElementById(`card-${sym}`);
      if (card) card.remove();
    }
  });

  // Create new charts & distribute
  activeSymbols.forEach(sym => {
    if (!charts[sym]) {
      const card = document.createElement('div');
      card.className = 'chart-card';
      card.id = `card-${sym}`;
      card.innerHTML = `
        <div class="chart-header">
          <span class="chart-title">${AVAILABLE_SYMBOLS[sym]} (${sym})</span>
        </div>
        <div class="chart-container"><canvas id="chart-${sym}"></canvas></div>
      `;
      
      const targetRow = sym.endsWith('TIPS') ? tipsRow : nominalsRow;
      targetRow.appendChild(card);
      createChartInstance(sym);
    }
  });

  // Re-sort charts in each row
  const sortRow = (row, isTips) => {
    const syms = Array.from(activeSymbols).filter(s => isTips ? s.endsWith('TIPS') : !s.endsWith('TIPS'));
    syms.sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
    syms.forEach(sym => {
      const card = document.getElementById(`card-${sym}`);
      if (card) row.appendChild(card);
    });
    // Hide section if empty
    row.parentElement.style.display = syms.length > 0 ? 'flex' : 'none';
  };

  sortRow(tipsRow, true);
  sortRow(nominalsRow, false);

  // Trigger resize after grid re-layout
  setTimeout(() => {
    Object.values(charts).forEach(c => c.resize());
  }, 0);
}

function createChartInstance(sym) {
  const ctx = document.getElementById(`chart-${sym}`).getContext('2d');
  const symIdx = Object.keys(AVAILABLE_SYMBOLS).indexOf(sym);
  const color = COLORS[symIdx % COLORS.length];

  charts[sym] = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: sym,
        data: [],
        borderColor: color,
        backgroundColor: color + '1A',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'MM/dd/yy HH:mm:ss', displayFormats: { hour: 'MM/dd HH:mm', day: 'MMM dd' } },
          grid: { color: '#f1f5f9' },
          ticks: { autoSkip: true, font: { size: 9 } }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 9, family: 'monospace' }, callback: v => v.toFixed(3) + '%' }
        }
      },
      plugins: {
        legend: { display: false },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          pan: { enabled: true, mode: 'xy' }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#94a3b8',
          titleFont: { size: 11 },
          bodyColor: '#1e293b',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 8,
          bodyFont: { size: 12 },
          cornerRadius: 6,
          displayColors: false,
          callbacks: { label: ctx => `Yield: ${ctx.parsed.y.toFixed(3)}%` }
        }
      }
    }
  });

  const container = document.getElementById(`card-${sym}`);
  new ResizeObserver(() => {
    if (charts[sym]) charts[sym].resize();
  }).observe(container);
}

function buildUrl(symbol, timeRange) {
  const base = "https://webql-redesign.cnbcfm.com/graphql";
  const providerRange = TIME_RANGE_MAP[timeRange] || '1D';
  const params = {
    operationName: "getQuoteChartData",
    variables: JSON.stringify({ symbol, timeRange: providerRange }),
    extensions: JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: "9e1670c29a10707c417a1efd327d4b2b1d456b77f1426e7e84fb7d399416bb6b"
      }
    })
  };
  return base + "?" + Object.entries(params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
}

const R2_HISTORY_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/yield-history';

function parseSourceTime(tt) {
  if (!tt || tt.length !== 14) return null;
  const year = parseInt(tt.substring(0, 4), 10);
  const month = parseInt(tt.substring(4, 6), 10) - 1;
  const day = parseInt(tt.substring(6, 8), 10);
  const hour = parseInt(tt.substring(8, 10), 10);
  const minute = parseInt(tt.substring(10, 12), 10);
  const second = parseInt(tt.substring(12, 14), 10);
  return new Date(year, month, day, hour, minute, second);
}

async function fetchOne(symbol, range) {
  const isIntraday = range === '2D' || range === '10D';
  
  if (isIntraday) {
    console.log(`%c[CNBC] %cFetching real-time ${range} for ${symbol}`, "color: #2563eb; font-weight: bold", "color: inherit");
    const live = await fetchLive(symbol, range);
    if (range === '2D') liveCache[symbol] = live; // Update tip cache
    return live;
  } else {
    // Baseline from R2 + Live Tip from CNBC
    console.log(`%c[R2] %cLoading history for ${symbol}...`, "color: #ea580c; font-weight: bold", "color: inherit");
    const history = await fetchHistory(symbol);
    
    // Reuse live tip if available, else fetch once
    let liveTip = liveCache[symbol];
    if (!liveTip) {
      console.log(`%c[CNBC] %cFetching 2D tip for ${symbol}...`, "color: #2563eb; font-weight: bold", "color: inherit");
      liveTip = await fetchLive(symbol, '2D');
      liveCache[symbol] = liveTip;
    }

    if (!history) return liveTip;
    if (!liveTip) return history;

    const lastHistTime = history[history.length - 1].x.getTime();
    const newPoints = liveTip.filter(p => p.x.getTime() > lastHistTime);
    const combined = [...history, ...newPoints];

    if (range === 'ALL') return combined;
    const cutoff = new Date();
    if (range === '1Y') cutoff.setFullYear(cutoff.getFullYear() - 1);
    else if (range === '2Y') cutoff.setFullYear(cutoff.getFullYear() - 2);
    else if (range === '3Y') cutoff.setFullYear(cutoff.getFullYear() - 3);
    else if (range === '10Y') cutoff.setFullYear(cutoff.getFullYear() - 10);
    
    return combined.filter(p => p.x >= cutoff);
  }
}

async function fetchLive(symbol, range) {
  const url = buildUrl(symbol, range);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const priceBars = json?.data?.chartData?.priceBars || [];
    return priceBars.map(bar => {
      let closeVal = bar.close;
      if (typeof closeVal === "string" && closeVal.endsWith("%")) closeVal = closeVal.slice(0, -1);
      return { x: parseSourceTime(bar.tradeTime), y: parseFloat(closeVal) };
    }).filter(p => p.x && !isNaN(p.y));
  } catch (err) {
    console.warn(`Live fetch failed for ${symbol}:`, err);
    return null;
  }
}

async function fetchHistory(symbol) {
  if (!historyCache[symbol]) {
    historyCache[symbol] = (async () => {
      const fileName = `${symbol}_history.json`;
      const r2Url = `${R2_HISTORY_URL}/${fileName}`;
      const localUrl = `./data/yield-history/${fileName}`;

      try {
        let response = await fetch(r2Url);
        if (!response.ok) response = await fetch(localUrl);
        if (!response.ok) throw new Error("History not found");
        
        const data = await response.json();
        return data.map(p => ({ x: parseSourceTime(p.x), y: p.y }));
      } catch (err) {
        console.error(`History load failed for ${symbol}:`, err);
        delete historyCache[symbol];
        return null;
      }
    })();
  }
  return await historyCache[symbol];
}

function updateDynamicTicks(chart, data) {
  if (!data || data.length === 0) return;
  const yields = data.map(p => p.y);
  const min = Math.min(...yields);
  const max = Math.max(...yields);
  const range = max - min;
  const padding = range * 0.1 || 0.01;
  chart.options.scales.y.min = min - padding;
  chart.options.scales.y.max = max + padding;
}

async function updateAllData() {
  const statusEl = document.getElementById('fetchStatus');
  statusEl.textContent = `Updating charts...`;

  const isIntraday = activeRange === '2D' || activeRange === '10D';
  const shouldSlant = activeRange === '2D';

  const promises = Array.from(activeSymbols).map(async sym => {
    const data = await fetchOne(sym, activeRange);
    const chart = charts[sym];
    if (chart && data) {
      chart.data.datasets[0].data = data;
      
      chart.options.scales.x.time.tooltipFormat = isIntraday ? 'MM/dd/yy HH:mm:ss' : 'MM/dd/yy';
      chart.options.scales.x.time.displayFormats = isIntraday 
        ? { hour: 'MM/dd HH:mm', minute: 'HH:mm:ss', day: 'MMM dd' }
        : { day: 'MMM dd', month: 'MMM yyyy', year: 'yyyy' };
      
      chart.options.scales.x.ticks.minRotation = shouldSlant ? 45 : 0;
      chart.options.scales.x.ticks.maxRotation = shouldSlant ? 45 : 0;

      updateDynamicTicks(chart, data);
      chart.update();
      chart.resetZoom();
    }
  });

  await Promise.all(promises);
  statusEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
}

window.addEventListener('DOMContentLoaded', init);
