# Treasury Investors Portal Master Glossary

This document is the authoritative source for all financial concepts, mathematical formulas, and terminology used across the Treasury Investors Portal projects.

> **Terminology note:** "Bond" is used as informal shorthand for any Treasury security (bill, note, bond, TIPS) where the instrument type is clear from context. In formal definitions, the precise term or "Treasury security" is always used.

---

## 1.0 Core Financial Primitives
Basic building blocks for all Treasury securities.

### Quantity
**Definition:** Number of Treasury securities held, where qty 1 = $1,000 of face value. Always an integer.

### Face Value
**Definition:** The original, unadjusted principal amount of a security.
**Formula:** `Face Value = Quantity * $1,000`

### Price
**Definition:** Market value expressed as a percentage of par.
**Unit:** Percent (e.g., 102.5 = 102.5% of par).

### Clean Price
**Definition:** The market price of a bond excluding accrued interest. For TIPS, this is the unadjusted price before applying the Index Ratio.

### Settlement Date
**Definition:** The date on which a trade is finalized and ownership transfers.
**Standard:** T+1 (Trade date + 1 business day) for secondary market Treasuries.

### Maturity Date
**Definition:** The date on which the principal amount of a security becomes due and is paid to the holder.

---

## 2.0 Bond Fundamentals
General concepts applicable to all fixed-income securities (Bills, Notes, Bonds).

### Par Value (Nominal)
**Definition:** The current principal value of a nominal security. For standard Treasuries, this equals Face Value.
**Formula:** `Par Value = Face Value`

### Coupon Rate
**Definition:** The fixed annual interest rate paid by the security.

### Annual Interest (Nominal)
**Definition:** The total interest paid in one year for a nominal security.
**Formula:** `Annual Interest = Face Value * Coupon Rate`

### Yield
**Full name:** Yield to Maturity (YTM)
**Definition:** The internal rate of return (IRR) earned by an investor who buys the bond at the current market price and holds it until maturity.

---

## 3.0 TIPS-Specific Extensions
Concepts specific to Treasury Inflation-Protected Securities (TIPS).

### TIPS
**Full name:** Treasury Inflation-Protected Securities
**Definition:** Marketable Treasury securities whose principal is adjusted by changes in the Consumer Price Index (CPI). They provide protection against inflation by increasing in par value as inflation rises.

### Ref CPI
**Full name:** Reference CPI (RefCPI)
**Definition:** The daily interpolated Consumer Price Index value used to calculate inflation adjustments.
**Formula:** See [2.1 TIPS Basics](./2.1_TIPS_Basics.md) for interpolation logic.

### Index Ratio
**Definition:** The ratio used to adjust the principal of a TIPS for inflation.
**Formula:** `Index Ratio = RefCPI(Settlement Date) / RefCPI(Dated Date)`

### Par Value (Adjusted)
**Definition:** The inflation-adjusted principal value of a TIPS.
**Formula:** `Par Value = Face Value * Index Ratio`

### P+I per TIPS
**Definition:** The total inflation-adjusted cash flow (Adjusted Principal + Last-Year Interest) received in the year the security matures.
**Formula:** `P+I = Par Value + Last-Year Interest`

### Cost per TIPS
**Definition:** The nominal cash cost to purchase one $1,000 Face Value unit of a TIPS.
**Formula:** `Cost = (Price / 100) * Index Ratio * 1,000`

---

## 4.0 Portfolio & Ladder Concepts
High-level terms used for designing and rebalancing TIPS ladders.

### Funded Year
**Full name:** Funded Year (FY)
**Definition:** A calendar year (rung) in the ladder for which we calculate total cash flow.

### Ladder Period
**Definition:** Range of funded years from first year to last year.

### DAA
**Full name:** Desired Annual Amount
**Definition:** Target total nominal cash flow for a funded year (includes both maturing principal and interest payments).

### AA
**Full name:** Annual Amount
**Synonym for:** [ARA](#ara). Used in the UI where "Real" is implied by context.

### DARA
**Full name:** Desired Annual Real Amount
**Definition:** Target annual real amount for a funded year. "Amount" = maturing principal + last-year interest + interest from later maturities ([LMI](#lmi)). Expressed in inflation-adjusted dollars.

### ARA
**Full name:** Annual Real Amount
**Definition:** Actual annual real amount produced by a specific year of the ladder. "Amount" = maturing principal + last-year interest + interest from later maturities ([LMI](#lmi)).
**Formula:** `ARA = ([P+I per TIPS](#pi-per-tips)) + ([LMI](#lmi))`

### LMI
**Full name:** Later Maturity Interest
**Definition:** The sum of annual interest payments from all TIPS in the ladder maturing in years *strictly later* than the current year.

### Gap Years
**Definition:** Years within the intended ladder range for which no TIPS have been issued by the Treasury.

### Synthetic TIPS
**Definition:** Theoretical TIPS created for Gap Years to maintain ladder continuity.

### Bracket Years
**Definition:** Existing TIPS used to "bracket" a gap year to match its duration and funding requirements.

### Rebalance Years
**Definition:** Years that will receive buys/sells during a rebalancing operation.

### First Year
**Definition:** The earliest contiguous year in the ladder range with holdings.

### Last Year
**Definition:** The latest contiguous year in the ladder range with holdings, bounded by the maximum gap year bracket.

---

## 5.0 Seasonal Adjustment (SA) Concepts
Terms used for normalizing TIPS yields for seasonal inflation patterns.

### SA Factor
**Definition:** The multiplicative factor used to normalize for seasonal inflation patterns, calculated as CPI-NSA / CPI-SA.

### SA Yield
**Definition:** The real yield derived from a Seasonally Adjusted Price.
