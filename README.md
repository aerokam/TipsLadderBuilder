# Treasury Investors Portal

A collection of free, open-source tools for the **Bogleheads** community to manage and analyze TIPS (Treasury Inflation-Protected Securities).

[**Read our Project Vision**](./PROJECT_VISION.md)

## Projects
- **TipsLadderManager**: Browser-based TIPS ladder design and rebalancing.
- **TipsSA**: Seasonally Adjusted TIPS yield analysis and trend fitting.
- **YieldsMonitor**: Treasury yield monitoring and curve tracking.
- **TreasuryAuctions**: Treasury auction data display.

## Shared Infrastructure
- **shared/**: Common libraries and knowledge base used across projects.
- **scripts/**: Root-level data-fetch scripts shared across projects.

## Web Interface
- **Live Version**: [https://aerokam.github.io/TIPS/](https://aerokam.github.io/TIPS/)

## Local Development
To run the tools locally:
1. Ensure you are at the monorepo root.
2. Run `npx serve .`
3. Navigate to the desired tool in your browser (e.g. `http://localhost:8080/TipsLadderManager/`).

Integration tests use Playwright (`npx playwright test` from the relevant project directory).
