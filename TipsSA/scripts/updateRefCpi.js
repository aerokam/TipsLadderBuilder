import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
// We'll just import the functions and run them.
// But they are currently standalone scripts with top-level await/calls.
// I'll refactor them to export functions if needed, or just use child_process.

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  try {
    console.log("Step 1: Fetching CPI from BLS...");
    execSync(`node "${path.join(__dirname, 'fetchCpiBls.js')}"`, { stdio: 'inherit' });
    
    console.log("\nStep 2: Calculating daily Reference CPI...");
    execSync(`node "${path.join(__dirname, 'calcRefCpi.js')}"`, { stdio: 'inherit' });
    
    console.log("\nUpdate complete.");
  } catch (error) {
    console.error("\nUpdate failed:", error.message);
    process.exit(1);
  }
}

main();
