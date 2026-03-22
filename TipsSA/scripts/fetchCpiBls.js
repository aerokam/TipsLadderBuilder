import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
import { uploadToR2 } from './r2.js';

const BUCKET = process.env.R2_BUCKET || 'data';
const OBJECT_KEY = 'bls/CPI.csv';

async function fetchAndUploadCpiBls() {
  console.log(`Script started at ${new Date().toISOString()}`);

  const url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
  const payload = JSON.stringify({
    seriesid: [
      "CUUR0000SA0",  // CPI-U, NSA
      "CUSR0000SA0"   // CPI-U, SA
    ],
    startyear: "2019",
    endyear: new Date().getFullYear().toString()
  });

  const tFetchStart = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });
  
  if (!response.ok) {
    throw new Error(`BLS API fetch failed: ${response.status} ${response.statusText}`);
  }
  
  console.log(`Fetch completed in ${Date.now() - tFetchStart} ms`);

  const data = await response.json();
  if (data.status !== "REQUEST_SUCCEEDED") {
    console.error("BLS API response error:", data.message);
  }

  const lookup = {};
  data.Results.series.forEach(series => {
    const id = series.seriesID;
    series.data.forEach(item => {
      const key = `${item.year}-${item.period}`;
      if (!lookup[key]) {
        lookup[key] = { year: item.year, period: item.period, periodName: item.periodName };
      }
      if (id === "CUUR0000SA0") lookup[key].NSA = item.value;
      else if (id === "CUSR0000SA0") lookup[key].SA = item.value;
    });
  });

  // --- Patch missing Oct 2025 values (no data collected in Sep 2025) ---
  const hardKey = "2025-M10";
  if (lookup[hardKey]) {
    if (lookup[hardKey].NSA === "-" || lookup[hardKey].NSA === undefined) lookup[hardKey].NSA = "325.604";
    if (lookup[hardKey].SA  === "-" || lookup[hardKey].SA  === undefined) lookup[hardKey].SA  = "325.551";
  }

  // --- Sort descending (newest first) ---
  const rows = Object.values(lookup).sort((a, b) => {
    if (a.year === b.year) return b.period.localeCompare(a.period);
    return parseInt(b.year) - parseInt(a.year);
  });

  // --- Build CSV ---
  const csv = [
    ["Year", "Period", "PeriodName", "NSA", "SA"].join(","),
    ...rows.map(r => [r.year, r.period, r.periodName, r.NSA || "", r.SA || ""].join(","))
  ].join("\n");

  // --- Upload ---
  await uploadToR2(OBJECT_KEY, csv);
}

fetchAndUploadCpiBls().catch(err => {
  console.error(err);
  process.exit(1);
});
