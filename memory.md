# Treasury Investors Portal — Project Memory

## Core Philosophy
- **Understandability Reward**: Every logic or UI change should increase the clarity of information. Opacity is a bug.
- **Drill Baby Drill (in a good way)**: Provide progressive disclosure from high-level UI to legal authority (CFR).
- **Community Contribution**: This is a free, open-source gift to the **Bogleheads.org** community.

## Technical Standards
- **Settlement Logic**:
  - `TipsLadderManager`: Always uses **T** (publication date) for market consistency.
  - `TipsSA`: Uses **T+1 business day** for broker prices. Implementation fetches `BondHolidaysSifma.csv` from R2 and uses `nextBusinessDay` logic to skip weekends and official bond holidays.
- **Shared Math**: `yieldFromPrice` (Actual/Actual) is centralized in `shared/src/bond-math.js`.
- **Infrastructure**: Served via GitHub Pages from the monorepo root. E2E tests must account for the Yield column shift in the Build table (Amount is now column index 4).

## Upcoming: Deep Drill Enhancements (Task List)
- [x] **Nested Interactivity**: Make variables inside popups (e.g., Index Ratio) clickable to trigger a secondary "Level 3" drill-down (e.g., the Ref CPI interpolation math).
- [x] **Live Formula Inspector**: Implement source-highlighting where hovering over a formula variable highlights the UI element or data date it originated from.
- [x] **Visual Proofs**: Add a "balance beam" SVG inside the Duration Matching popup to visually demonstrate how brackets anchor the gap years.
- [x] **CFR Hyperlinks**: Turn legal citations (like 31 CFR § 356) into direct deep-links to official gov/legal sites for "Level 4" authority.
- [x] **Breadcrumb Navigation**: Add a path indicator at the top of deep popups (e.g., `Ladder > FY 2036 > Amount > LMI Pool`) to maintain context during deep dives.
- [x] **Grade-Level Toggle**: Experiment with a "Complexity Toggle" (ELI5 vs. Quant) inside educational popups to reward users at all levels of expertise.

