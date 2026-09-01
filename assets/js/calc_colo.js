// Colo-developer economics: build the facility, lease the kW, own no GPUs. PURE.
// parity: cli/aidc/core/calc_colo.py — costs() ported 1:1 (same names, inputs,
// outputs, notes). Facility capex = the published $/W-IT band (same basis as
// the TCO calculator's BUILD mode, NO IT/GPU line); lease anchors = CBRE
// retail asking [S] / wholesale [A]. Cost floor, NOI, yield-on-cost,
// break-even occupancy — plus an optional LEVERAGE view (OFF unless ltc_pct
// is set): loan at LTC, monthly-amortizing debt service, DSCR, debt yield,
// cash-on-cash; terms are quote-only [A]. An estimator, not an underwriting.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const LEASE_TIERS = ["retail", "wholesale"];

  const LEASE_DEFAULT = {
    retail: q(217.30, "US$/kW/mo", "[S]",
              "CBRE Global Data Center Trends 2025: global average retail asking rate, " +
              "+3.3% YoY Q1-2025; regional band $140-470"),
    wholesale: q(140.0, "US$/kW/mo", "[A]",
                 "multi-MW wholesale leases price BELOW published retail asking; no " +
                 "public wholesale benchmark was sourced — band anchored on the CBRE " +
                 "regional low end. Get quotes"),
  };

  const DEFAULTS = {
    it_mw: q(1.0, "MW-IT", "[A]", "leasable critical IT capacity — set to your project"),
    build_usd_per_w_it: q(12.43, "US$/W-IT", "[D]",
                          "facility capex: JLL 2026 shell-and-core 11.3 $/W x 1.10 " +
                          "liquid premium; published facility range 10-13 $/W-IT — same " +
                          "basis as the TCO calculator's BUILD mode; NO IT/GPU capex in " +
                          "this model"),
    substation_m: q(null, "US$M", "[A]",
                    "substation + interconnection: NO benchmark could be sourced — " +
                    "carry as a FEED-priced item, never a point estimate"),
    contingency_pct_of_facility: q(2.5, "%", "[D]",
                                   "named-risk contingency on facility capex — the same " +
                                   "10-class P x exposure derivation as the capex page " +
                                   "(2.54% -> 2.5); 0 = pre-FMEA floor"),
    opex_k_per_mw_it_yr: q(940.0, "US$k/MW-IT/yr", "[D]",
                           "facility cash opex ex-power at 10 MW-IT, band 940-1,140 — " +
                           "charged on FULL capacity (staffing and maintenance do not " +
                           "scale down with vacancy)"),
    lease_tier: q("retail", "", "[A]",
                  "retail = published asking-rate basis; wholesale = multi-MW leases " +
                  "that price below it (quote-only)"),
    lease_usd_per_kw_month: q(null, "US$/kW/mo", "[A]",
                              "colo rate incl. space/cooling/facility O&M, EXCL. metered " +
                              "energy; default = the chosen tier's published anchor"),
    occupancy: q(0.85, "frac", "[A]",
                 "stabilised leased share of capacity — deliberately below full: " +
                 "lease-up takes quarters and churn is real; the sensitivity grid " +
                 "prices ±10 pts"),
    facility_life_years: q(20.0, "yr", "[A]",
                           "shell + MEP amortisation life (same convention as the capex " +
                           "and TCO calculators)"),
    ltc_pct: q(null, "%", "[A]",
               "optional LEVERAGE: loan-to-cost — data-center construction lending is a " +
               "quote-only market (announced facilities cluster in a broad ~55-70% LTC " +
               "class); leave blank for the unlevered view. Setting it requires " +
               "debt_rate_pct"),
    debt_rate_pct: q(null, "%/yr", "[A]",
                     "all-in debt rate (reference rate + spread) for the leverage view — " +
                     "floating construction debt then a stabilized perm refi is the " +
                     "standard structure; rates are quote-only, get term sheets"),
    amort_years: q(25.0, "yr", "[A]",
                   "perm-loan amortization for the leverage view; construction-period " +
                   "interest-only precedes it (not modelled)"),
  };

  function costs(kw) {
    kw = kw || {};
    const p = {};
    for (const k in DEFAULTS) p[k] = DEFAULTS[k].value;
    for (const k in kw) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    if (LEASE_TIERS.indexOf(p.lease_tier) < 0) {
      throw new Error("lease_tier must be one of " + LEASE_TIERS.join(", "));
    }
    if (!(Number(p.occupancy) > 0.0 && Number(p.occupancy) <= 1.0)) {
      throw new Error("occupancy must be within (0, 1]");
    }
    if (p.ltc_pct !== null && p.ltc_pct !== undefined
        && (p.debt_rate_pct === null || p.debt_rate_pct === undefined)) {
      throw new Error("debt_rate_pct is required when ltc_pct is set — all-in debt " +
                      "rates are quote-only, there is no defensible default");
    }
    if (p.ltc_pct !== null && p.ltc_pct !== undefined
        && !(Number(p.ltc_pct) > 0.0 && Number(p.ltc_pct) < 100.0)) {
      throw new Error("ltc_pct must be within (0, 100)");
    }

    const resolved = {};
    if (p.lease_usd_per_kw_month === null || p.lease_usd_per_kw_month === undefined) {
      resolved.lease_usd_per_kw_month = LEASE_DEFAULT[p.lease_tier];
      p.lease_usd_per_kw_month = resolved.lease_usd_per_kw_month.value;
    }

    const it = Number(p.it_mw);
    const itKw = it * 1000.0;
    const rate = Number(p.lease_usd_per_kw_month);
    const occ = Number(p.occupancy);

    const facility = Number(p.build_usd_per_w_it) * itKw * 1000.0 / 1e6;   // US$M
    const substation = (p.substation_m !== null && p.substation_m !== undefined)
      ? Number(p.substation_m) : 0.0;
    const contingency = (facility + substation) * Number(p.contingency_pct_of_facility) / 100.0;
    const capexTotal = facility + substation + contingency;

    const leasedKw = itKw * occ;
    const revenue = leasedKw * rate * 12.0 / 1e6;                          // US$M/yr
    const opex = it * Number(p.opex_k_per_mw_it_yr) / 1000.0;              // US$M/yr
    const noi = revenue - opex;
    const amort = capexTotal / Number(p.facility_life_years);

    const floorRate = leasedKw ? (amort + opex) * 1e6 / (leasedKw * 12.0) : null;
    const yieldPct = capexTotal ? 100.0 * noi / capexTotal : null;
    const beOcc = (rate && itKw) ? 100.0 * (amort + opex) * 1e6 / (rate * 12.0 * itKw) : null;
    const payback = noi > 0 ? capexTotal / noi : null;

    const out = {
      capex_facility_m: q(facility, "US$M", "[D]",
                          "it_mw x build_usd_per_w_it — shell + MEP, ex land + IT"),
      capex_substation_m: q(substation || null, "US$M", "[A]",
                            "0 unless substation_m is given — unsourced by design"),
      capex_contingency_m: q(contingency, "US$M", "[D]",
                             "(facility + substation) x contingency_pct_of_facility"),
      capex_total_m: q(capexTotal, "US$M", "[D]", "sum of the capex lines (NO IT/GPU line)"),
      capex_per_mw_it_m: q(it ? capexTotal / it : null, "US$M/MW-IT", "[D]",
                           "capex_total_m / it_mw"),
      leased_kw: q(leasedKw, "kW", "[D]", "it_mw x 1000 x occupancy"),
      revenue_m_yr: q(revenue, "US$M/yr", "[D]",
                      "leased_kw x lease rate x 12 — space/cooling/O&M revenue only; " +
                      "tenant energy is metered pass-through (excluded both sides)"),
      opex_m_yr: q(opex, "US$M/yr", "[D]",
                   "it_mw x opex_k_per_mw_it_yr — on FULL capacity, not leased share"),
      noi_m_yr: q(noi, "US$M/yr", "[D]", "revenue - opex (before financing, tax, TI)"),
      noi_margin_pct: q(revenue ? 100.0 * noi / revenue : null, "%", "[D]",
                        "noi / revenue"),
      amortisation_m_yr: q(amort, "US$M/yr", "[D]",
                           "capex_total / facility_life_years, straight-line"),
      yield_on_cost_pct: q(yieldPct, "%", "[D]",
                           "NOI / total capex — the developer's stabilised headline; " +
                           "compare against your cost of capital, not a promise"),
      cost_floor_usd_per_kw_month: q(floorRate, "US$/kW/mo", "[D]",
                                     "(amortisation + opex) / (leased_kw x 12) — the " +
                                     "rate that breaks even at this occupancy; a COST " +
                                     "FLOOR, not a price"),
      rate_spread_usd_per_kw_month: q(floorRate !== null ? rate - floorRate : null,
                                      "US$/kW/mo", "[D]",
                                      "lease rate - cost floor: the margin one kW earns " +
                                      "before financing and tax"),
      breakeven_occupancy_pct: q(beOcc, "%", "[D]",
                                 "occupancy where NOI first covers amortisation at the " +
                                 "chosen rate: (amort + opex) / (rate x 12 x capacity)"),
      simple_payback_years: q(payback, "yr", "[D]",
                              "capex_total / NOI — undiscounted; None when NOI <= 0"),
    };

    const levered = p.ltc_pct !== null && p.ltc_pct !== undefined;
    if (levered) {
      const loan = capexTotal * Number(p.ltc_pct) / 100.0;
      const equity = capexTotal - loan;
      const rM = Number(p.debt_rate_pct) / 100.0 / 12.0;
      const nM = Number(p.amort_years) * 12.0;
      const ads = rM > 0 ? loan * rM / (1.0 - Math.pow(1.0 + rM, -nM)) * 12.0
                         : loan / Number(p.amort_years);
      out.loan_m = q(loan, "US$M", "[D]", "capex_total x ltc_pct");
      out.equity_m = q(equity, "US$M", "[D]", "capex_total - loan");
      out.debt_service_m_yr = q(ads, "US$M/yr", "[D]",
                                "monthly-amortizing payment x 12: loan x r/12 / " +
                                "(1 - (1 + r/12)^-(12n))");
      out.dscr = q(ads ? noi / ads : null, "x", "[D]",
                   "NOI / annual debt service — lenders covenant ~1.20-1.25x [A]; " +
                   "below that this structure would not finance at these terms");
      out.debt_yield_pct = q(loan ? 100.0 * noi / loan : null, "%", "[D]",
                             "NOI / loan — the lender's rate-independent sizing floor");
      out.cash_on_cash_pct = q(equity > 0 ? 100.0 * (noi - ads) / equity : null,
                               "%", "[D]",
                               "(NOI - debt service) / equity — the sponsor's levered " +
                               "cash return, before tax and before any refi");
    }

    const notes = [
      "Estimator, not an underwriting: no tenant-improvement " +
      "allowances, no churn/re-lease gaps, no escalators, no tax — yield_on_cost and " +
      "payback are stabilised cash readings at ONE occupancy point. A full quarterly " +
      "model with debt, ramps and levies is the financial-model layer, not this page.",
      "Tenant ENERGY is excluded on both sides: this model treats power as metered " +
      "pass-through at cost. Real colos recover house load via a PUE-loaded rate or " +
      "markup — that is pricing strategy, and it moves NOI materially at scale.",
      "The retail rate anchor is a PUBLISHED ASKING average ($217.30/kW/mo, CBRE) — " +
      "signed multi-MW leases price below asking, so the wholesale tier [A] is the " +
      "honest comparison for anchor tenants. REPLACE both with quotes.",
      "Opex is charged on FULL capacity: staffing, maintenance and security do not " +
      "scale down with vacancy — which is exactly why the cost floor rises steeply " +
      "below ~70% occupancy (watch breakeven_occupancy_pct).",
      "Facility capex uses the same published $/W-IT band as the TCO calculator's " +
      "BUILD mode (10-13 $/W-IT; 12.43 default) — a GPU-ready liquid-cooled shell. A " +
      "lower-density enterprise colo builds cheaper; a quote beats the band.",
      "For the GPU-owner side of this trade (build vs lease at these same rates), run " +
      "the TCO calculator; for build capex including the GPU fleet, the capex page.",
    ];
    if (levered) {
      notes.push(
        "LEVERAGE view = one stabilized year, static: a monthly-amortizing perm loan " +
        "from day one — no construction-draw schedule, no interest-only period, no " +
        "refi event, no rate hedge. The real structure is floating-rate construction " +
        "debt drawn against milestones, then a perm refi sized to BOTH a DSCR " +
        "covenant (~1.20-1.25x class [A]) and a debt-yield floor at stabilization. " +
        "Terms are quote-only: the LTC/rate you enter should come from a term sheet, " +
        "and the quarterly deal-grade model (draws, ramps, covenants) is the " +
        "financial-model layer, not this page.");
    }

    const inputs = {};
    for (const k in DEFAULTS) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied") : DEFAULTS[k];
    }
    for (const k in resolved) inputs[k] = resolved[k];
    for (const k in inputs) if (inputs[k].value === null || inputs[k].value === undefined) delete inputs[k];

    return result(
      "colo — build the facility, lease the kW: cost floor, NOI, yield-on-cost",
      "JLL shell-and-core + liquid premium (published facility $/W-IT band) · CBRE " +
      "Global Data Center Trends 2025 asking rates · opex + named-risk contingency " +
      "conventions shared with the capex page · NO IT capex, NO energy margin, NO leverage",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcColo = { DEFAULTS: DEFAULTS, LEASE_TIERS: LEASE_TIERS,
                               LEASE_DEFAULT: LEASE_DEFAULT, costs: costs };
})();
