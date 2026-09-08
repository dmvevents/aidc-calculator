// Cost-control roll-up: baseline / commitments / contingency / change orders /
// variance -> Estimate At Completion (EAC). PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_costctl.py — costctl() ported 1:1 (same names,
// inputs, outputs, output key order, notes). BASELINE composes over the capex
// core (A.calcCapex.costs(...).capex_total_m for the same scenario). The load-
// bearing identity: EAC = baseline + change_orders - contingency_draw + variance
// (contingency_draw SUBTRACTED — reserve money sits outside the baseline). Pure
// money arithmetic, so a run byte-matches the python core to the cent.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    commitments_m: q(0.0, "US$M", "[A]",
                     "value committed to date (POs + executed contracts) — t0 default 0 " +
                     "(nothing committed yet); does not enter EAC (informational)"),
    contingency_m: q(2.0, "US$M", "[A]",
                     "contingency reserve HELD on the baseline (management + named-risk " +
                     "reserve); does not enter EAC — its DRAW does"),
    contingency_draw_m: q(0.0, "US$M", "[A]",
                         "amount DRAWN from the reserve to fund variance/changes; " +
                         "SUBTRACTED from EAC (release back to reserve = negative draw)"),
    change_orders_m: q(0.0, "US$M", "[A]",
                       "net of APPROVED change orders (+ adds scope/cost, - de-scopes) — " +
                       "ADDED to EAC"),
    variance_m: q(0.0, "US$M", "[A]",
                  "forecast cost variance on the base scope (overrun +, underrun -) — " +
                  "ADDED to EAC"),
  };

  function costctl(kw) {
    kw = kw || {};
    // BASELINE composes over the capex core — call calc_capex with the scenario
    // knobs and read the exact capex-total accessor.
    const scen = {};
    for (const k of ["it_mw", "gpus", "kw_per_gpu", "pue"]) {
      if (kw[k] !== null && kw[k] !== undefined) scen[k] = kw[k];
    }
    const cap = globalThis.AIDC.calcCapex.costs(scen);
    const baseline = cap.outputs.capex_total_m.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      commitments_m: kw.commitments_m, contingency_m: kw.contingency_m,
      contingency_draw_m: kw.contingency_draw_m, change_orders_m: kw.change_orders_m,
      variance_m: kw.variance_m,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const commitments = Number(p.commitments_m);
    const contingency = Number(p.contingency_m);
    const draw = Number(p.contingency_draw_m);
    const cos = Number(p.change_orders_m);
    const varc = Number(p.variance_m); // `var` is reserved in JS; value parity, not name
    if (contingency < 0.0) throw new Error("contingency_m must be >= 0");
    if (commitments < 0.0) throw new Error("commitments_m must be >= 0");

    // ---- the load-bearing EAC identity --------------------------------------
    const eac = baseline + cos - draw + varc;

    const eacVsBaseline = eac - baseline;
    const variancePct = baseline ? varc / baseline * 100.0 : null;
    const contingencyRemaining = contingency - draw;
    const committedVsBaseline = commitments - baseline;

    const out = {
      baseline_m: q(baseline, "US$M", "[D]",
                    "capex-core total for the scenario (calc_capex.costs -> capex_total_m)"),
      commitments_m: q(commitments, "US$M", "[D]", "value committed to date (input echo)"),
      change_orders_m: q(cos, "US$M", "[D]", "net approved change orders (input echo)"),
      contingency_m: q(contingency, "US$M", "[D]", "contingency reserve held (input echo)"),
      contingency_draw_m: q(draw, "US$M", "[D]", "amount drawn from the reserve (input echo)"),
      variance_m: q(varc, "US$M", "[D]", "forecast variance on base scope (input echo)"),
      eac_m: q(eac, "US$M", "[D]",
               "ESTIMATE AT COMPLETION = baseline + change_orders - contingency_draw + variance"),
      eac_vs_baseline_delta_m: q(eacVsBaseline, "US$M", "[D]",
                                 "eac - baseline (= change_orders - contingency_draw + variance)"),
      variance_pct_of_baseline: q(variancePct, "%", "[D]", "variance / baseline x 100"),
      contingency_remaining_m: q(contingencyRemaining, "US$M", "[D]",
                                 "contingency - contingency_draw (negative = reserve overdrawn)"),
      committed_vs_baseline_m: q(committedVsBaseline, "US$M", "[D]",
                                 "commitments - baseline (positive = committed over baseline)"),
    };

    const notes = [
      "SIGN CONVENTION — EAC = baseline + change_orders - contingency_draw + variance. " +
      "baseline is the capex-core total (the approved cost baseline); change_orders is " +
      "the NET of approved change orders (+ adds, - de-scopes); variance is the forecast " +
      "cost deviation on the base scope (overrun +, underrun -); contingency_draw is the " +
      "amount drawn from the held reserve to fund those and is SUBTRACTED, because reserve " +
      "money sits outside the baseline (releasing it back = a negative draw, raising EAC).",
      "BASELINE composes over the capex core: baseline_m is calc_capex.costs(...) " +
      "capex_total_m for the same scenario (default 1 MW-IT -> 41.95325 US$M), so a change " +
      "in the build cost flows straight into EAC. commitments and contingency are carried " +
      "for the cost-control view (contingency_remaining, committed_vs_baseline) but do NOT " +
      "enter the EAC identity — only a contingency DRAW does.",
      "DETERMINISTIC: pure money arithmetic — no wall clock, no randomness — so a double " +
      "run is byte-identical and the JS port matches to the cent.",
      "Scope: a single-snapshot cost-control roll-up, not an earned-value time series — no " +
      "BCWS/BCWP/ACWP curve, CPI/SPI, or period phasing. Change orders and variance are " +
      "entered as net US$M; a real controls system tracks them line by line with approval " +
      "state and a monthly forecast.",
    ];
    if (draw > contingency) {
      notes.push(
        "OVER-DRAW: contingency_draw (" + draw.toFixed(3) + ") exceeds the held reserve (" +
        contingency.toFixed(3) + ") — contingency_remaining is negative; the reserve is " +
        "exhausted and the excess overrun is no longer covered.");
    }

    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcCapex.DEFAULTS.it_mw.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to the capex core for the baseline"),
    };
    const scenEcho = [
      ["gpus", kw.gpus, "", "GPU count — forwarded to the capex core"],
      ["kw_per_gpu", kw.kw_per_gpu, "kW/GPU", "density — forwarded to the capex core"],
      ["pue", kw.pue, "", "PUE — forwarded to the capex core"],
    ];
    for (const [k, v, unit, src] of scenEcho) {
      if (v !== null && v !== undefined) inputs[k] = q(v, unit, "[S]", src);
    }
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "costctl — cost-control roll-up to Estimate At Completion (EAC)",
      "baseline composed over calc_capex.costs (capex_total_m); EAC = baseline + " +
      "change_orders - contingency_draw + variance (pure money math, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcCostctl = { DEFAULTS: DEFAULTS, costctl: costctl };
})();
