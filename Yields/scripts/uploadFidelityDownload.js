import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadToR2 } from './r2.js';

const FILES = [
  { name: 'FidelityTreasuries.csv', r2Key: 'Treasuries/FidelityTreasuries.csv' },
  { name: 'FidelityTips.csv',       r2Key: 'Treasuries/FidelityTips.csv' },
];

const downloadsDir = path.join(os.homedir(), 'Downloads');

function extractDownloadDate(content) {
  const match = content.match(/Date downloaded\s+([\d/]+ [\d:]+ [AP]M)/i);
  return match ? match[1] : 'unknown';
}

let uploaded = 0;

for (const { name, r2Key } of FILES) {
  const filePath = path.join(downloadsDir, name);

  if (!fs.existsSync(filePath)) {
    console.log(`Skipped (not found): ${filePath}`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const downloadDate = extractDownloadDate(content);

  console.log(`Uploading ${name} (downloaded ${downloadDate}) → ${r2Key}`);
  await uploadToR2(r2Key, content);
  uploaded++;
}

if (uploaded === 0) {
  console.error(`No Fidelity files found in ${downloadsDir}`);
  process.exit(1);
}
