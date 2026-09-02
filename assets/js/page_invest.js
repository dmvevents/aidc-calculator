// Page config: investor equity screen (calc_invest.js over calc_capex.js).
// COMPOSITION: the capex engine derives the fleet, the all-in capex and the
// CASH-opex basis (fixed ex-power + energy per billable hour, amortisation
// EXCLUDED — capex is the year-0 flow) at this page's platform/scale; the
// invest engine then runs the annual cash-flow screen. One chain() resolves
// compute, derive lines and every sensitivity cell (A-04 convention).
// Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  const { q } = A.res;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  const PLATFORMS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];

  function chain(kw) {
    const ck = {};
    const v = kw.platform ? DB[kw.platform] : null;
    if (kw.it_mw != null) ck.it_mw = kw.it_mw;
    if (kw.gpus != null) ck.gpus = kw.gpus;
    ck.kw_per_gpu = kw.kw_per_gpu != null ? kw.kw_per_gpu
      : (v ? v.nameplate_kw / v.gpus_per_rack : null);
    ck.pue = kw.pue != null ? kw.pue : (v ? v.pue_target : null);
    for (const k in ck) if (ck[k] === null || ck[k] === undefined) delete ck[k];
    const cap = A.calcCapex.costs(ck);
    const res = A.calcInvest.returns({
      gpus: cap.outputs.gpus.value,
      capex_total_m: cap.outputs.capex_total_m.value,
      opex_fixed_m_yr: cap.outputs.opex_ex_power_m_yr.value,
      energy_usd_per_gpu_hr: cap.outputs.cost_energy_per_gpu_hr.value,
      rate_usd_per_gpu_hr: kw.rate_usd_per_gpu_hr != null ? kw.rate_usd_per_gpu_hr : null,
      rate_decay_pct_yr: kw.rate_decay_pct_yr != null ? kw.rate_decay_pct_yr : null,
      util_y1: kw.util_y1 != null ? kw.util_y1 : null,
      util_steady: kw.util_steady != null ? kw.util_steady : null,
      horizon_yr: kw.horizon_yr != null ? kw.horizon_yr : null,
      resale_frac_of_capex: kw.resale_frac_of_capex != null ? kw.resale_frac_of_capex : null,
      ltc_pct: kw.ltc_pct != null ? kw.ltc_pct : null,
      debt_rate_pct: kw.debt_rate_pct != null ? kw.debt_rate_pct : null,
      debt_term_yr: kw.debt_term_yr != null ? kw.debt_term_yr : null,
      discount_rate_pct: kw.discount_rate_pct != null ? kw.discount_rate_pct : null,
    }, ["gpus", "capex_total_m", "opex_fixed_m_yr", "energy_usd_per_gpu_hr"]);
    return { cap: cap, res: res };
  }

  A.SECTIONS.push({
    id: "inv",
    defaults: {
      platform: q("", "", "[A]", "rack-matrix variant — seeds kW/GPU + PUE for the capex basis"),
      it_mw: q(1.0, "MW-IT", "[A]", "critical IT capacity for the capex basis"),
      gpus: q(null, "", "[A]", "fleet size; if blank, derived from IT ÷ kW/GPU"),
      rate_usd_per_gpu_hr: A.calcInvest.DEFAULTS.rate_usd_per_gpu_hr,
      rate_decay_pct_yr: A.calcInvest.DEFAULTS.rate_decay_pct_yr,
      util_y1: A.calcInvest.DEFAULTS.util_y1,
      util_steady: A.calcInvest.DEFAULTS.util_steady,
      horizon_yr: A.calcInvest.DEFAULTS.horizon_yr,
      resale_frac_of_capex: A.calcInvest.DEFAULTS.resale_frac_of_capex,
      ltc_pct: A.calcInvest.DEFAULTS.ltc_pct,
      debt_rate_pct: A.calcInvest.DEFAULTS.debt_rate_pct,
      debt_term_yr: A.calcInvest.DEFAULTS.debt_term_yr,
      discount_rate_pct: A.calcInvest.DEFAULTS.discount_rate_pct,
    },
    compute: (kw) => chain(kw).res,
    hero: "irr_unlevered_pct", heroLabel: "unlevered IRR over the hold",
    heroSrc: "invest-model",
    fields: [
      { key: "platform", label: "GPU platform (sets kW/GPU + PUE)", src: "variants", type: "select", value: "",
        options: [["", "(none — GB200 basis)"]].concat(PLATFORMS.map((n) => [n, DB[n].platform])) },
      { key: "it_mw", label: "critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "gpus", label: "GPU count (else derived)", src: "legend", step: 8, min: 1, placeholder: "derived" },
      { key: "rate_usd_per_gpu_hr", label: "your sell rate $/GPU-h (anchors below)",
        src: "rental-anchors", step: 0.1, min: 0, placeholder: "enter a rate" },
      { key: "rate_decay_pct_yr", label: "rate decay %/yr (0 = flat, optimistic)",
        src: "invest-model", step: 5, min: 0, max: 99 },
      { key: "util_y1", label: "year-1 utilisation (ramp)", src: "invest-model", step: 0.05, min: 0.05, max: 1 },
      { key: "util_steady", label: "steady-state utilisation (year 2+)", src: "invest-model",
        step: 0.05, min: 0.05, max: 1 },
      { key: "ltc_pct", label: "FINANCING: loan-to-cost % (blank = unlevered)", src: "invest-model",
        step: 5, min: 1, max: 95, placeholder: "unlevered", advanced: false },
      { key: "debt_rate_pct", label: "FINANCING: all-in debt rate %/yr", src: "invest-model",
        step: 0.25, min: 0, placeholder: "term sheet", advanced: false },
      { key: "debt_term_yr", label: "FINANCING: amortization (yr)", src: "invest-model",
        step: 0.5, min: 0.5, advanced: true },
      { key: "horizon_yr", label: "hold period (yr)", src: "invest-model", step: 1, min: 1, max: 10, advanced: true },
      { key: "resale_frac_of_capex", label: "terminal value (frac of capex)", src: "invest-model",
        step: 0.05, min: 0, max: 1, advanced: true },
      { key: "discount_rate_pct", label: "NPV hurdle %/yr", src: "invest-model", step: 1, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const c = chain(kw);
      const o = c.res.outputs, co = c.cap.outputs, i = c.res.inputs;
      const lines = [
        "capex basis: " + d(co.gpus.value) + " GPUs · all-in " + d(co.capex_total_m.value) +
          " US$M (year-0 outflow) · cash opex " + d(co.opex_ex_power_m_yr.value) +
          " US$M/yr fixed + " + d(co.cost_energy_per_gpu_hr.value) +
          " $/GPU-h energy (amortisation EXCLUDED — capex is the year-0 flow)",
        "year 1: hours = " + d(o.gpus.value) + " × 8760 × " + d(i.util_y1.value) +
          " → revenue " + d(o.revenue_y1_m.value) + " US$M → EBITDA " + d(o.ebitda_y1_m.value) +
          " US$M; steady-state EBITDA " + d(o.ebitda_steady_m.value) + " US$M/yr",
        "exit year " + d(i.horizon_yr.value) + ": terminal " + d(o.terminal_value_m.value) +
          " US$M (" + d(i.resale_frac_of_capex.value) + " × capex)" +
          (o.loan_m.value ? " − debt payoff" : ""),
      ];
      if (o.irr_unlevered_pct.value !== null && o.irr_unlevered_pct.value !== undefined) {
        lines.push(
          "IRR: bisection on the annual flows → unlevered " + d(o.irr_unlevered_pct.value) +
            "%" + (o.irr_levered_pct.value != null
                   ? " · levered " + d(o.irr_levered_pct.value) + "% on " +
                     d(o.equity_required_m.value) + " US$M equity (DSCR y1 " +
                     d(o.dscr_y1.value) + "x)"
                   : "") +
            " · NPV@" + d(i.discount_rate_pct.value) + "% = " + d(o.npv_unlevered_m.value) +
            " US$M · MOIC " + d(o.moic.value) + "x · payback " + d(o.payback_yr.value) + " yr");
      } else {
        lines.push("enter YOUR sell rate to run the screen — dated on-demand anchors are " +
          "on the rate row (committed contracts price below; decay is the honest case)");
      }
      return lines;
    },
    after: (r, kw) => {
      const host = document.getElementById("inv-sens");
      if (!host) return;
      const rate = kw.rate_usd_per_gpu_hr;
      if (rate === null || rate === undefined || rate === "") {
        const p = document.createElement("p");
        p.className = "preset-note";
        p.textContent = "Sensitivity grid appears once you enter a sell rate — each cell " +
          "re-runs the full model (capex basis, ramp, decay curve, leverage), so nothing " +
          "is interpolated.";
        host.replaceChildren(p);
        return;
      }
      const levered = kw.ltc_pct != null && kw.ltc_pct !== "" && kw.debt_rate_pct != null && kw.debt_rate_pct !== "";
      const key = levered ? "irr_levered_pct" : "irr_unlevered_pct";
      const rates = [Number(rate) * 0.8, Number(rate), Number(rate) * 1.2];
      const decays = [0, 10, 20, 30];
      const base = kw.rate_decay_pct_yr != null ? Number(kw.rate_decay_pct_yr) : 0;
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = (levered ? "LEVERED" : "unlevered") + " IRR % — sell rate ±20% × " +
        "rate-decay curve [D] (each cell re-runs the full model" +
        (levered ? "; leverage amplifies both tails" : "") + ")";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      const c0 = document.createElement("th");
      c0.textContent = "decay \\ rate";
      hr.appendChild(c0);
      for (const rt of rates) {
        const th = document.createElement("th");
        th.textContent = d(rt) + " $/h";
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const dec of decays) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = dec + "%/yr";
        tr.appendChild(th);
        rates.forEach((rt, ri) => {
          let cell = null;
          try {
            cell = chain(Object.assign({}, kw, { rate_usd_per_gpu_hr: rt, rate_decay_pct_yr: dec }))
              .res.outputs[key].value;
          } catch (e) { cell = null; }
          const td = document.createElement("td");
          td.className = "num" + (dec === base && ri === 1 ? " sens-base" : "");
          td.textContent = cell === null ? "n/a" : d(cell);
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
  });

  A.boot();
})();
