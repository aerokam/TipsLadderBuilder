# TIPS Ladder Builder

## Project Overview

This project is a free, browser-based tool for building and rebalancing [TIPS](https://www.treasurydirect.gov/marketable-securities/tips/) (Treasury Inflation-Protected Securities) ladders. All calculations run locally in the user's browser, and no data is uploaded to any server.

The application is built with vanilla JavaScript, HTML, and CSS. It fetches data from external sources using GitHub Actions and Cloudflare R2.

## Data Pipeline

The application relies on three external data sources:

*   **TIPS Prices & Yields:** Fetched daily from FedInvest (TreasuryDirect) by a GitHub Action and uploaded to Cloudflare R2.
*   **Reference CPI:** Fetched daily from the Bureau of Labor Statistics (via TreasuryDirect) by a GitHub Action and uploaded to Cloudflare R2.
*   **TIPS Metadata:** Fetched as needed from TreasuryDirect's securities list.

The `scripts/` directory contains the scripts responsible for fetching and updating this data:

*   `scripts/fetchRefCpi.js`: Fetches daily reference CPI data from TreasuryDirect.
*   `scripts/fetchTipsRef.js`: Fetches TIPS metadata (coupon, base CPI) from TreasuryDirect.
*   `scripts/getTipsYields.js`: Fetches TIPS prices and yields from FedInvest.

These scripts are executed by GitHub Actions, as defined in the `.github/workflows/` directory.

## Key Files

*   `index.html`: The main entry point of the application.
*   `src/`: Contains the core JavaScript logic for the application.
    *   `src/data.js`: Handles data fetching and parsing from the Cloudflare R2 bucket.
    *   `src/render.js`: Renders the UI and updates it based on user input.
    *   `src/bond-math.js`: Contains the core logic for bond calculations.
    *   `src/rebalance-lib.js`: Contains the logic for rebalancing TIPS ladders.
    *   `src/broker-import.js`: Handles importing data from brokerage accounts.
*   `scripts/`: Contains scripts for fetching data from external sources.
    *   `scripts/fetchRefCpi.js`: Fetches daily reference CPI data from TreasuryDirect and uploads it to Cloudflare R2.
    *   `scripts/fetchTipsRef.js`: Fetches TIPS metadata from TreasuryDirect and uploads it to Cloudflare R2.
    *   `scripts/getTipsYields.js`: Fetches daily TIPS yields and prices from FedInvest and uploads it to Cloudflare R2.
*   `.github/workflows/`: Contains the GitHub Actions workflows that execute the data fetching scripts.
*   `tests/`: Contains end-to-end and unit tests for the application.
    *   `tests/run.js`: The main test runner script.
    *   `tests/e2e/`: Contains the Playwright end-to-end tests.


## Building and Running

No build step is required. To run the application locally, simply open `index.html` in a web browser.

Alternatively, you can serve the project root with any static file server:

```bash
npx serve . -p 8080
```

## Testing

The project uses a combination of scripts and Playwright for testing.

*   To run the main test suite, use the following command:

    ```bash
    npm test
    ```

    This will execute the `tests/run.js` script.

*   To run the end-to-end tests specifically, use the following command:

    ```bash
    npm run test:e2e
    ```

    This will run the Playwright tests.
