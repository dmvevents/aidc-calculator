// Neocloud operator economics: own the fleet, sell GPU-hours. PURE.
// parity: cli/aidc/core/calc_neocloud.py — operate() ported 1:1 (same names,
// inputs, outputs, notes). Unit economics over the capex page's cost floor at
// a MATCHED utilisation basis (the page derives both together so they cannot
// drift); market rate defaults to none — published on-demand anchors are
// listed, dated, with the committed-below-on-demand and rate-decay caveats.
// Estimator, not a business case (no SG&A/financing/tax/decay — stated).
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const HOURS_PER_YEAR = 8760.0;

  const DEFAULTS = {
    gpus: q(529, "", "[D]",
            "fleet size; default = the capex page's 1 MW-IT outcome at 1.889 kW/GPU " +
            "(529 GPUs/MW) — this page derives it live from your capex inputs"),
    capex_total_m: q(41.95, "US$M", "[D]",
                     "all-in build: facility + IT fleet + spares + contingency; default " +
                     "= the capex page's 1 MW-IT outcome — derived live for your " +
                     "platform and scale"),
    cost_floor_usd_per_gpu_hr: q(2.073, "US$/GPU-h", "[D]",
                                 "amortisation + opex + energy per billable GPU-hour; " +
                                 "default = the capex page's 1 MW-IT outcome. MUST be " +
                                 "quoted at the same utilisation as this page (basis " +
                                 "contract) — this site keeps the two in lockstep"),
    utilisation: q(0.85, "frac", "[A]",
                   "billable share of GPU-hours — matched to the cost floor's " +
                   "amortisation basis (capex page 0.85); the TCO page plans at 0.70. " +
                   "Change BOTH together or the margin lies"),
    market_usd_per_gpu_hr: q(null, "US$/GPU-h", "[A]",
                             "the rate you believe you can sell at. Published on-demand " +
                             "anchors: CoreWeave GB200 $10.50 / B200 $8.60 / H100 $6.16; " +
                             "Nebius B200 $7.15 / H100 $3.85; AWS Capacity Blocks GB200 " +
                             "$10.58 (observed 2026-08-20). Committed contracts price " +
                             "BELOW on-demand; rates decay over fleet life"),
  };

  function operate(kw) {
    kw = kw || {};
    const p = {};
    for (const k in DEFAULTS) p[k] = DEFAULTS[k].value;
    for (const k in kw) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    if (!(Number(p.utilisation) > 0.0 && Number(p.utilisation) <= 1.0)) {
      throw new Error("utilisation must be within (0, 1]");
    }

    const gpus = Math.trunc(Number(p.gpus));
    const floor = Number(p.cost_floor_usd_per_gpu_hr);
    const capex = Number(p.capex_total_m);
    const rate = (p.market_usd_per_gpu_hr !== null && p.market_usd_per_gpu_hr !== undefined)
      ? Number(p.market_usd_per_gpu_hr) : null;

    const hours = gpus * HOURS_PER_YEAR * Number(p.utilisation);
    const cost = floor * hours / 1e6;
    const revenue = rate !== null ? rate * hours / 1e6 : null;
    const marginHr = rate !== null ? rate - floor : null;
    const gross = revenue !== null ? revenue - cost : null;
    const grossPct = revenue ? 100.0 * gross / revenue : null;
    const payback = (gross && gross > 0) ? capex / gross : null;

    const out = {
      billable_gpu_hours_yr: q(hours, "GPU-h/yr", "[D]", "gpus x 8760 x utilisation"),
      cost_m_yr: q(cost, "US$M/yr", "[D]",
                   "cost floor x billable hours — amortisation + opex + energy at the " +
                   "matched utilisation basis"),
      revenue_m_yr: q(revenue, "US$M/yr", revenue !== null ? "[D]" : "[A]",
                      revenue !== null ? "market rate x billable hours"
                        : "enter market_usd_per_gpu_hr — published anchors on the " +
                          "input row; committed contracts price below on-demand"),
      margin_usd_per_gpu_hr: q(marginHr, "US$/GPU-h",
                               marginHr !== null ? "[D]" : "[A]",
                               marginHr !== null
                                 ? "market rate - cost floor (the unit economics)"
                                 : "needs a market rate"),
      gross_margin_m_yr: q(gross, "US$M/yr", gross !== null ? "[D]" : "[A]",
                           gross !== null ? "revenue - cost" : "needs a market rate"),
      gross_margin_pct: q(grossPct, "%", grossPct !== null ? "[D]" : "[A]",
                          grossPct !== null
                            ? "gross margin / revenue — before sales, SG&A, financing, tax"
                            : "needs a market rate"),
      breakeven_rate_usd_per_gpu_hr: q(floor, "US$/GPU-h", "[D]",
                                       "= the cost floor: the rate below which a " +
                                       "billable hour loses cash + amortisation"),
      simple_payback_years: q(payback, "yr",
                              payback !== null ? "[D]" : "[A]",
                              rate !== null
                                ? "capex_total / gross margin — undiscounted, constant-" +
                                  "rate; None when margin <= 0 or no rate given"
                                : "needs a market rate"),
    };

    const notes = [
      "Estimator, NOT a business case: no sales cost, SG&A, financing, tax, rate-decay " +
      "curve, lease-up ramp or refresh capex — gross margin at ONE (rate, utilisation) " +
      "point. The TCO page carries cost over time; the deal-grade quarterly P&L is the " +
      "financial-model layer, not this page.",
      "BASIS CONTRACT: the cost floor is quoted at THIS page's utilisation (" +
      Number(p.utilisation).toFixed(2) + "). " +
      "Raising utilisation raises billable hours AND lowers the floor's amortisation " +
      "share per hour — this site derives both together from the capex " +
      "engine so they cannot drift.",
      "The rate anchors are DATED ON-DEMAND list prices (observed 2026-08-20). " +
      "Committed/reserved contracts — the bulk of a real neocloud's book — price " +
      "materially below on-demand, and street rates decay over a fleet's life (the " +
      "H100 history). Underwrite on a contracted rate, not the anchor.",
      "Payback is undiscounted at a constant rate and constant utilisation — a " +
      "planning yardstick, not an IRR. If payback approaches the GPU book life " +
      "(5-6 yr SEC convention), the margin does not carry the refresh.",
      "The colo page prices the same facility WITHOUT the fleet (landlord view); the " +
      "capex page owns the cost floor's derivation; the TCO page owns cost over time " +
      "with residual value and break-even against a rental rate.",
    ];

    const inputs = {};
    for (const k in DEFAULTS) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied") : DEFAULTS[k];
    }
    for (const k in inputs) if (inputs[k].value === null || inputs[k].value === undefined) delete inputs[k];

    return result(
      "neocloud — own the fleet, sell GPU-hours: margin, revenue, payback",
      "unit economics over the capex page's cost floor (matched-utilisation basis " +
      "contract) · published on-demand rate anchors, dated · gross margin only — no " +
      "SG&A/financing/tax/decay (stated)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcNeocloud = { DEFAULTS: DEFAULTS, HOURS_PER_YEAR: HOURS_PER_YEAR,
                                   operate: operate };
})();
