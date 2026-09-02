// GPU investor economics: equity returns on a fleet build.
// parity: cli/aidc/core/calc_invest.py — returns() ported 1:1.
// Annual cash-flow screen: capex year 0, EBITDA years 1..N (utilisation ramp,
// optional rate decay), terminal at exit; IRR by deterministic bisection
// (fixed bracket, 200 halvings — identical arithmetic to the Python core);
// optional leverage uses calc_colo's exact monthly-annuity debt service.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const HOURS_PER_YEAR = 8760.0;

  const DEFAULTS = {
    gpus: q(529, "", "[D]",
            "fleet size; default = the capex page's 1 MW-IT outcome at 1.889 kW/GPU " +
            "(529 GPUs/MW) — the CLI/site derive it live from your capex inputs"),
    capex_total_m: q(41.95, "US$M", "[D]",
                     "all-in build: facility + IT fleet + spares + contingency; default " +
                     "= the capex page's 1 MW-IT outcome — derive it live for your " +
                     "platform and scale"),
    opex_fixed_m_yr: q(0.94, "US$M/yr", "[D]",
                       "cash opex ex-power (staff, maintenance, network, insurance); " +
                       "default = the capex page's 1 MW-IT outcome. Amortisation is " +
                       "deliberately EXCLUDED — capex is the year-0 flow here"),
    energy_usd_per_gpu_hr: q(0.189, "US$/GPU-h", "[D]",
                             "facility energy per billable GPU-hour; default = the capex " +
                             "page's 1 MW-IT outcome at its 0.85 basis. Scaled with " +
                             "billable hours [A] — understates cost at low utilisation " +
                             "(idle power persists)"),
    rate_usd_per_gpu_hr: q(null, "US$/GPU-h", "[A]",
                           "the rate you believe you can sell at. Published on-demand " +
                           "anchors: CoreWeave GB200 $10.50 / B200 $8.60 / H100 $6.16; " +
                           "Nebius B200 $7.15 / H100 $3.85; AWS Capacity Blocks GB200 " +
                           "$10.58 (observed 2026-08-20). Committed contracts price " +
                           "BELOW on-demand; rates decay over fleet life"),
    rate_decay_pct_yr: q(0.0, "%/yr", "[A]",
                         "annual sell-rate decline. 0 = flat (optimistic); H100 street " +
                         "history shows double-digit annual decay — underwrite your own " +
                         "curve and read the sensitivity"),
    util_y1: q(0.50, "frac", "[A]",
               "first-year billable share — fill/ramp assumption; steady state applies " +
               "from year 2"),
    util_steady: q(0.85, "frac", "[A]",
                   "steady-state billable share — matched to the cost basis default " +
                   "(capex page 0.85); the TCO page plans at a deliberately conservative " +
                   "0.70. Change cost basis and utilisation together or the model lies"),
    horizon_yr: q(5, "yr", "[A]",
                  "hold period; matches the TCO window and the 5-yr GPU book life"),
    resale_frac_of_capex: q(0.10, "frac", "[A]",
                            "terminal value at exit as a share of all-in capex. The TCO " +
                            "page's resale-decline band (25-40 %/yr, floor 10%) puts a " +
                            "5-yr fleet near its floor; facility residual ignored — " +
                            "conservative vs the 20-yr shell life"),
    ltc_pct: q(null, "%", "[A]",
               "optional LEVERAGE: loan-to-cost. Published SEC prints ladder from 65% " +
               "(IREN covenant ceiling) / 70% (APLD non-IG) / 80% (Galaxy Helios bank " +
               "template) to ~85-95% only against an investment-grade hyperscaler " +
               "lease (Cipher, Hut 8) — 70-80% is the standard construction band [S]; " +
               "your term sheet governs. Leave blank for the unlevered view; setting " +
               "it requires debt_rate_pct"),
    debt_rate_pct: q(null, "%/yr", "[A]",
                     "all-in debt rate (reference + spread). Published prints run " +
                     "SOFR+2.25% (IG offtake, CoreWeave rated DDTL) to SOFR+4.75% with " +
                     "a 250bp floor (Galaxy Helios construction template) [S]; " +
                     "GPU-secured paper prices at the wide end — your term sheet " +
                     "governs"),
    debt_term_yr: q(5.0, "yr", "[A]",
                    "amortization term. GPU-backed facilities run 3-6 yr inside the " +
                    "asset life (vs the colo page's 25-yr real-estate convention) — " +
                    "no published tenor benchmark (assumption-verify)"),
    discount_rate_pct: q(12.0, "%/yr", "[A]",
                         "equity hurdle for the NPV line — a screening rate, not a WACC " +
                         "claim; set your own"),
  };

  function _irr(flows) {
    // parity: calc_invest.py _irr — fixed bracket, 200 halvings, same float ops
    function npv(r) {
      let s = 0.0;
      for (let t = 0; t < flows.length; t++) s += flows[t] / Math.pow(1.0 + r, t);
      return s;
    }
    let lo = -0.95, hi = 10.0;
    let flo = npv(lo);
    if (flo * npv(hi) > 0.0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2.0;
      if (flo * npv(mid) <= 0.0) { hi = mid; }
      else { lo = mid; flo = npv(lo); }
    }
    return (lo + hi) / 2.0;
  }

  function returns(kw, seeded) {
    // seeded: input keys whose values were COMPOSED (capex chain), not
    // user-typed — echoed [D] w/ the composition label (v36 A-04).
    kw = kw || {};
    const seededSet = new Set(seeded || []);
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];

    const gpus = Math.trunc(p.gpus);
    const capex = Number(p.capex_total_m);
    if (gpus <= 0) throw new Error("gpus must be > 0");
    if (capex <= 0.0) throw new Error("capex_total_m must be > 0");
    for (const k of ["util_y1", "util_steady"]) {
      if (!(0.0 < Number(p[k]) && Number(p[k]) <= 1.0)) throw new Error(k + " must be in (0, 1]");
    }
    const horizon = Math.trunc(p.horizon_yr);
    if (!(1 <= horizon && horizon <= 10)) throw new Error("horizon_yr must be 1..10");
    const decay = Number(p.rate_decay_pct_yr);
    if (!(0.0 <= decay && decay < 100.0)) throw new Error("rate_decay_pct_yr must be in [0, 100)");
    if (p.ltc_pct !== null && p.debt_rate_pct === null) {
      throw new Error("debt_rate_pct is required when ltc_pct is set — all-in debt " +
                      "cost is a term-sheet fact, not a default we will guess");
    }

    const rate = p.rate_usd_per_gpu_hr === null ? null : Number(p.rate_usd_per_gpu_hr);
    const opexFixed = Number(p.opex_fixed_m_yr);
    const energy = Number(p.energy_usd_per_gpu_hr);
    const resaleM = Number(p.resale_frac_of_capex) * capex;

    // ---- debt block (calc_colo's exact annuity) -----------------------------
    const levered = p.ltc_pct !== null;
    let loan = null, ads = null, pmtM = null, rM = null;
    let nM = 0;
    if (levered) {
      const ltc = Number(p.ltc_pct);
      if (!(0.0 < ltc && ltc < 100.0)) throw new Error("ltc_pct must be in (0, 100)");
      loan = ltc / 100.0 * capex;
      rM = Number(p.debt_rate_pct) / 100.0 / 12.0;
      nM = Math.round(Number(p.debt_term_yr) * 12.0);
      if (nM <= 0) throw new Error("debt_term_yr must be > 0");
      pmtM = rM === 0.0 ? loan / nM : loan * rM / (1.0 - Math.pow(1.0 + rM, -nM));
      ads = pmtM * 12.0;
    }

    function _balance(months) {
      if (!levered) return 0.0;
      const m = Math.min(months, nM);
      if (rM === 0.0) return Math.max(0.0, loan - pmtM * m);
      const g = Math.pow(1.0 + rM, m);
      return Math.max(0.0, loan * g - pmtM * (g - 1.0) / rM);
    }

    const equity = capex - (loan || 0.0);

    // ---- yearly flows --------------------------------------------------------
    const ebitda = [], unlev = [-capex], lev = [-equity];
    for (let y = 1; y <= horizon; y++) {
      const util = y === 1 ? Number(p.util_y1) : Number(p.util_steady);
      const hours = gpus * HOURS_PER_YEAR * util;
      const rateY = rate === null ? null : rate * Math.pow(1.0 - decay / 100.0, y - 1);
      const rev = rateY === null ? null : hours * rateY / 1e6;
      const opex = opexFixed + energy * hours / 1e6;
      const e = rev === null ? null : rev - opex;
      ebitda.push(e);
      const term = y === horizon ? resaleM : 0.0;
      if (e !== null) {
        unlev.push(e + term);
        const svc = (levered && y * 12 <= nM) ? ads
          : (!levered ? 0.0 : pmtM * Math.max(0, Math.min(12, nM - (y - 1) * 12)));
        const payoff = y === horizon ? _balance(y * 12) : 0.0;
        lev.push(e - (svc || 0.0) + term - payoff);
      }
    }

    const haveRate = rate !== null;
    const irrU = haveRate ? _irr(unlev) : null;
    const irrL = (haveRate && levered) ? _irr(lev) : null;

    let npvU = null;
    if (haveRate) {
      const d = Number(p.discount_rate_pct) / 100.0;
      npvU = 0.0;
      for (let t = 0; t < unlev.length; t++) npvU += unlev[t] / Math.pow(1.0 + d, t);
    }

    // MOIC counts EVERY dollar the investor must fund (v36 antagonist A-01):
    // paid-in = |year-0 equity| + interim capital calls; a year-0-only
    // denominator renders a net-losing strategy as a high multiple.
    let moic = null, capitalCallsM = null;
    const flowsE = levered ? lev : unlev;
    if (haveRate) {
      let dist = 0.0, calls = 0.0;
      for (let i = 1; i < flowsE.length; i++) {
        if (flowsE[i] > 0.0) dist += flowsE[i];
        else if (flowsE[i] < 0.0) calls += -flowsE[i];
      }
      capitalCallsM = calls;
      const paidIn = flowsE[0] < 0.0 ? -flowsE[0] + calls : null;
      moic = paidIn ? dist / paidIn : null;
    }

    // Payback only when nothing after it claws back (A-01).
    let payback = null, paybackSuppressed = false;
    if (haveRate) {
      let cum = flowsE[0];
      for (let y = 1; y < flowsE.length; y++) {
        const nxt = cum + flowsE[y];
        if (nxt >= 0.0 && flowsE[y] > 0.0) {
          let laterNeg = false;
          for (let z = y + 1; z < flowsE.length; z++) if (flowsE[z] < 0.0) laterNeg = true;
          if (laterNeg) { paybackSuppressed = true; } else { payback = (y - 1) + (-cum / flowsE[y]); }
          break;
        }
        cum = nxt;
      }
    }

    let dscr1 = null, dscrMin = null;
    if (levered && haveRate && ads) {
      dscr1 = ebitda[0] / ads;
      const dscrs = [];
      for (let y = 1; y <= horizon; y++) {
        const svcY = y * 12 <= nM ? ads : pmtM * Math.max(0, Math.min(12, nM - (y - 1) * 12));
        if (svcY && svcY > 0.0 && ebitda[y - 1] !== null) dscrs.push(ebitda[y - 1] / svcY);
      }
      dscrMin = dscrs.length ? Math.min.apply(null, dscrs) : null;
    }

    const yq = (i, label) => {
      let v = null;
      if (haveRate && i < flowsE.length - 1) v = flowsE[i + 1];
      return q(v, "US$M", "[D]", label);
    };

    const out = {
      gpus: q(gpus, "", "[D]", "fleet size (input echo)"),
      capex_total_m: q(capex, "US$M", "[D]", "year-0 build outflow"),
      loan_m: q(loan, "US$M", "[D]", levered ? "ltc_pct x capex" : "unlevered — no debt"),
      equity_required_m: q(equity, "US$M", "[D]", "capex - loan (year-0 equity check)"),
      debt_service_m_yr: q(ads, "US$M/yr", "[D]",
                           levered ? "monthly-amortizing annuity x 12 (calc_colo formula)"
                                   : "unlevered — no debt"),
      revenue_y1_m: q(!haveRate ? null : gpus * HOURS_PER_YEAR * Number(p.util_y1) * rate / 1e6,
                      "US$M", "[D]", "gpus x 8760 x util_y1 x rate"),
      ebitda_y1_m: q(ebitda[0], "US$M", "[D]", "revenue - cash opex (year 1, ramp utilisation)"),
      ebitda_steady_m: q(ebitda.length > 1 ? ebitda[1] : ebitda[0], "US$M", "[D]",
                         "year-2+ EBITDA at util_steady (before rate decay compounds further)"),
      terminal_value_m: q(resaleM, "US$M", "[D]", "resale_frac_of_capex x capex, year " + horizon),
      cash_y1_m: yq(0, "equity cash flow, year 1" + (levered ? " (levered)" : "")),
      cash_y2_m: yq(1, "equity cash flow, year 2"),
      cash_y3_m: yq(2, "equity cash flow, year 3"),
      cash_y4_m: yq(3, "equity cash flow, year 4"),
      cash_y5_m: yq(4, "equity cash flow, year 5 (+ terminal - debt payoff at exit)"),
      irr_unlevered_pct: q(irrU === null ? null : irrU * 100.0, "%", "[D]",
                           "bisection IRR on [-capex, EBITDA_y..., + terminal]"),
      irr_levered_pct: q(irrL === null ? null : irrL * 100.0, "%", "[D]",
                         levered ? (irrL !== null || !haveRate
                                    ? "bisection IRR on the equity flows (debt service + exit payoff)"
                                    : "NO UNIQUE IRR — the equity flows change sign more than " +
                                      "once; judge by the cash rows and MOIC (see notes)")
                                 : "unlevered — set ltc_pct + debt_rate_pct"),
      npv_unlevered_m: q(npvU, "US$M", "[D]",
                         "unlevered flows discounted at discount_rate_pct"),
      capital_calls_m: q(capitalCallsM, "US$M", "[D]",
                         "interim NEGATIVE equity flows the investor must fund after " +
                         "year 0 — counted in MOIC's denominator"),
      moic: q(moic, "x", "[D]",
              (levered ? "levered" : "unlevered") + " distributions / TOTAL paid-in (year-0 " +
              "equity + interim capital calls), undiscounted"),
      payback_yr: q(payback, "yr", "[D]",
                    "first year cumulative equity cash turns >= 0 AND no later flow " +
                    "is negative (suppressed with a note otherwise — a payback before " +
                    "a capital call is not a payback)"),
      dscr_y1: q(dscr1, "x", "[D]",
                 levered ? "year-1 EBITDA / annual debt service (lender screens 1.10-1.40x — " +
                           "colo page ladder)"
                         : "unlevered — no debt"),
      dscr_min_over_hold: q(dscrMin, "x", "[D]",
                            levered ? "MIN yearly EBITDA / debt service across the hold — the " +
                                      "covenant-relevant figure when rates decay or the ramp " +
                                      "bites"
                                    : "unlevered — no debt"),
    };

    const notes = [];
    if (!haveRate) {
      notes.push(
        "No sell rate given — returns need rate_usd_per_gpu_hr. The cost side and " +
        "capital structure above are complete; pick a rate from the dated anchors on " +
        "the input row (committed contracts price below on-demand) and re-run.");
    }
    if (haveRate && decay === 0.0) {
      notes.push(
        "Rate held FLAT for " + horizon + " years — optimistic. H100 street " +
        "pricing history shows double-digit annual decay; set rate_decay_pct_yr and " +
        "watch the IRR sensitivity before believing the flat case.");
    }
    if (haveRate && capitalCallsM !== null && capitalCallsM > 0.0) {
      const yrs = [];
      for (let y = 1; y < flowsE.length; y++) if (flowsE[y] < 0.0) yrs.push(String(y));
      notes.push(
        "CAPITAL CALLS: the equity flows go NEGATIVE again in year(s) " + yrs.join(", ") +
        " — the investor must fund a further " + capitalCallsM.toFixed(2) +
        " US$M after closing. MOIC's denominator counts this paid-in; payback is " +
        "suppressed when a call follows it.");
    }
    if (haveRate && paybackSuppressed) {
      notes.push(
        "Payback suppressed: cumulative equity cash crosses zero and then a LATER " +
        "flow is negative — quoting the crossing year would claim a payback the " +
        "investor gives back. Read the cash rows.");
    }
    if (haveRate && levered && irrL === null) {
      notes.push(
        "Levered IRR has NO UNIQUE VALUE here: the equity flows change sign more " +
        "than once (Descartes), so multiple mathematically valid IRRs exist and " +
        "quoting one would be arbitrary. Judge this structure by the cash rows, " +
        "MOIC (paid-in basis) and NPV at your hurdle.");
    }
    notes.push(...[
      "Cash-opex basis: the capex page's 1 MW-IT outcome with amortisation EXCLUDED — " +
      "capex is the year-0 flow, so an amortised cost floor here would double-count it " +
      "(the neocloud page's 2.073 floor INCLUDES amortisation; different question).",
      "Energy scales with billable hours [A] — understates cost at low utilisation " +
      "(idle facility power persists): at util_y1 " + Number(p.util_y1).toFixed(2) +
      " vs the 0.85 cost basis, the fixed-power share of that line is understated " +
      "by ~" + (100.0 * (1.0 - Number(p.util_y1) / 0.85)).toFixed(0) + "% in year 1.",
      "Not modelled: tax, SG&A/sales cost, GPU refresh at end of book life, working " +
      "capital, construction-period interest, rate/utilisation correlation. This is an " +
      "equity screen, not an underwriting model — the financial-model layer holds the " +
      "quarterly version.",
    ]);
    if (levered && haveRate && dscr1 !== null && dscr1 < 1.10) {
      notes.push(
        "YEAR-1 DSCR " + dscr1.toFixed(2) + " is UNDER the 1.10x published lender " +
        "screen floor" + (dscr1 < 1.0 ? " (and under 1.0x — EBITDA cannot cover debt service)" : "") +
        " — expect an interest reserve / equity cure / delayed amortization " +
        "requirement (construction-period IO is the standard structure).");
    }
    if (levered && haveRate && dscrMin !== null && dscr1 !== null && dscrMin < dscr1) {
      notes.push(
        "DSCR deteriorates over the hold: minimum " + dscrMin.toFixed(2) +
        "x vs year-1 " + dscr1.toFixed(2) + "x — decay/ramp effects bite the covenant " +
        "test in later years, not year 1.");
    }

    const inputs = {};
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (k in kw && kw[k] !== null && kw[k] !== undefined)
        ? (seededSet.has(k)
           ? q(kw[k], DEFAULTS[k].unit, "[D]",
               "derived live by the capex engine at your platform/scale " +
               "(composition — not user-typed)")
           : q(kw[k], DEFAULTS[k].unit, "[S]", "user-supplied"))
        : DEFAULTS[k];
    }

    return result(
      "invest — GPU fleet equity returns (IRR, NPV, MOIC, payback)",
      "annual cash-flow screen: capex year 0, EBITDA years 1..N, terminal at exit; " +
      "IRR by deterministic bisection; debt = calc_colo's monthly annuity",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcInvest = { DEFAULTS: DEFAULTS, HOURS_PER_YEAR: HOURS_PER_YEAR,
                                 _irr: _irr, returns: returns };
})();
