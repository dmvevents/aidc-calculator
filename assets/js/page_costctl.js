// Page config: cost-control calculator — the project-controls lens. The capex
// engine sets the cost BASELINE live; the controls-desk inputs (change orders,
// forecast variance, contingency held/drawn, commitments) roll into a single
// Estimate At Completion. Renders the EAC-vs-baseline BRIDGE with the variance
// called out. Ends with A.boot(). parity: assets/js/calc_costctl.js (the 1:1
// core port); the arithmetic lives in the engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  const sgn = (x) => (x >= 0 ? "+" : "") + d(x);   // signed contribution to EAC
  A.SECTIONS = A.SECTIONS || [];

  // -------------------------------------------------------------- COST CONTROL --
  A.SECTIONS.push({
    id: "costctl",
    // the 5 controls-desk layering inputs carry their own DEFAULTS/chips; the
    // capex-scenario knobs (it_mw/gpus/kw_per_gpu/pue) the baseline composes over
    // borrow capex's DEFAULTS so their fields chip + placeholder like the capex page.
    defaults: Object.assign({}, A.calcCapex.DEFAULTS, A.calcCostctl.DEFAULTS),
    compute: (kw) => A.calcCostctl.costctl(kw),
    hero: "eac_m", heroLabel: "estimate at completion (EAC)", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (sets the capex baseline)", src: "legend", step: 0.5, min: 0.1 },
      // may go negative (de-scope / underrun / reserve release) → no min, no inputmode
      { key: "change_orders_m", label: "approved change orders (net, + adds / - de-scopes)", src: "legend", step: 0.5 },
      { key: "variance_m", label: "forecast variance on base scope (+ over / - under)", src: "legend", step: 0.5 },
      { key: "contingency_m", label: "contingency reserve held", src: "legend", step: 0.5, min: 0 },
      { key: "contingency_draw_m", label: "contingency drawn (- releases back)", src: "legend", step: 0.5 },
      { key: "commitments_m", label: "committed to date (informational)", src: "legend", step: 1, min: 0 },
      // capex-scenario knobs the baseline composes over (it_mw is primary above)
      { key: "gpus", label: "GPU count (else derived)", src: "legend", step: 8, min: 1, placeholder: "derived", advanced: true },
      { key: "kw_per_gpu", label: "kW per GPU (rack nameplate)", src: "aif-template", step: 0.01, min: 0.1, advanced: true },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "EAC = baseline + change_orders - contingency_draw + variance = " +
          d(o.baseline_m.value) + " + " + d(o.change_orders_m.value) + " - " +
          d(o.contingency_draw_m.value) + " + " + d(o.variance_m.value) + " = " +
          d(o.eac_m.value) + " US$M",
        "baseline = capex-core total for the scenario (calc_capex -> capex_total_m) = " +
          d(o.baseline_m.value) + " US$M",
        "EAC vs baseline = " + d(o.eac_vs_baseline_delta_m.value) + " US$M (" +
          d(o.variance_pct_of_baseline.value) + "% variance of baseline)",
        "contingency remaining = held - drawn = " + d(o.contingency_m.value) + " - " +
          d(o.contingency_draw_m.value) + " = " + d(o.contingency_remaining_m.value) + " US$M",
        "committed vs baseline = commitments - baseline = " + d(o.commitments_m.value) + " - " +
          d(o.baseline_m.value) + " = " + d(o.committed_vs_baseline_m.value) + " US$M",
      ];
    },
    // the VISUAL: an EAC bridge from baseline to estimate at completion — each
    // controls line is its signed contribution to EAC and they sum to the delta;
    // the running column closes on eac_m (the identity, shown as a waterfall).
    after: (r) => {
      const host = document.getElementById("costctl-bridge");
      if (!host) return;
      const o = r.outputs;
      const baseline = o.baseline_m.value;
      const co = o.change_orders_m.value;
      const draw = o.contingency_draw_m.value;
      const varc = o.variance_m.value;
      const eac = o.eac_m.value;
      const r1 = baseline, r2 = baseline + co, r3 = r2 - draw, r4 = r3 + varc;
      const rows = [
        ["Baseline — capex-core total", d(baseline), d(r1), false],
        ["+ Change orders (net, approved)", sgn(co), d(r2), false],
        ["- Contingency draw (applied)", sgn(-draw), d(r3), false],
        ["+ Variance (forecast, base scope)", sgn(varc), d(r4), false],
        ["= Estimate at completion (EAC)", "", d(eac), true],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "EAC bridge — baseline to estimate at completion, US$M [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const h of ["component", "US$M", "running EAC"]) {
        const th = document.createElement("th");
        th.textContent = h;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const [label, amt, run, isEac] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        const tda = document.createElement("td");
        tda.className = "num";
        tda.textContent = amt;
        const tdr = document.createElement("td");
        tdr.className = "num" + (isEac ? " sens-base" : "");
        tdr.textContent = run;
        tr.append(tda, tdr);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);

      // variance / contingency / commitments callout under the bridge
      const note = document.createElement("p");
      note.className = "preset-note";
      const overdrawn = o.contingency_remaining_m.value < 0;
      note.textContent =
        "EAC vs baseline: " + sgn(o.eac_vs_baseline_delta_m.value) + " US$M (" +
        d(o.variance_pct_of_baseline.value) + "% variance of baseline). " +
        "Contingency: " + d(o.contingency_m.value) + " held - " + d(draw) + " drawn = " +
        d(o.contingency_remaining_m.value) + " remaining" +
        (overdrawn ? " (OVERDRAWN — reserve exhausted)." : ".") +
        " Committed to date: " + d(o.commitments_m.value) + " (" +
        sgn(o.committed_vs_baseline_m.value) + " vs baseline).";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
