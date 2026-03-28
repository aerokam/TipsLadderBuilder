import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');

function checkReleaseDate() {
  const now = new Date();
  // Format today as "Day, Month DD, YYYY" in Eastern Time to match CSV
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' };
  const todayStr = now.toLocaleDateString('en-US', options);

  console.log(`Checking if today (${todayStr}) is a release date...`);

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('CpiReleaseSchedule') && f.endsWith('.csv'));
  
  for (const file of files) {
    const csv = fs.readFileSync(path.join(dataDir, file), 'utf8');
    const lines = csv.split('\n');
    
    for (const line of lines) {
      // Matches: "Tuesday, January 13, 2026","08:30 AM","Consumer Price Index for December 2025"
      const match = line.match(/"([^"]+)"/);
      if (match && match[1] === todayStr) {
        console.log(`MATCH FOUND in ${file}: ${line.trim()}`);
        return true;
      }
    }
  }

  return false;
}

const isReleaseDay = checkReleaseDate();

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `is_release_day=${isReleaseDay}\n`);
}

if (isReleaseDay) {
  console.log("Release day confirmed.");
} else {
  console.log("Not a release day.");
}

process.exit(0);
