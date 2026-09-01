// Page config: neocloud operator (calc_neocloud.js over calc_capex.js).
// COMPOSITION with a basis contract: the capex engine derives the fleet, the
// all-in capex and the $/GPU-hr cost floor at THIS page's utilisation, then
// the neocloud engine prices margin/revenue/payback at the same utilisation —
// the two bases cannot drift (every consumer resolves through chain()).
// Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  const { q } = A.res;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  const PLATFORMS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];

  // ONE resolution for compute, derive and the grid (A-04 convention)
  function chain(kw) {
    const ck = {};
    const v = kw.platform ? DB[kw.platform] : null;
    if (kw.it_mw != null) ck.it_mw = kw.it_mw;
    if (kw.gpus != null) ck.gpus = kw.gpus;
    ck.kw_per_gpu = kw.kw_per_gpu != null ? kw.kw_per_gpu
      : (v ? v.nameplate_kw / v.gpus_per_rack : null);
    ck.pue = kw.pue != null ? kw.pue : (v ? v.pue_target : null);
    if (kw.it_m_per_mw_it != null) ck.it_m_per_mw_it = kw.it_m_per_mw_it;
    if (kw.power_usd_per_kwh != null) ck.power_usd_per_kwh = kw.power_usd_per_kwh;
    if (kw.utilisation != null) ck.utilisation = kw.utilisation;
    for (const k in ck) if (ck[k] === null || ck[k] === undefined) delete ck[k];
    const cap = A.calcCapex.costs(ck);
    const res = A.calcNeocloud.operate({
      gpus: cap.outputs.gpus.value,
      capex_total_m: cap.outputs.capex_total_m.value,
      cost_floor_usd_per_gpu_hr: cap.outputs.cost_floor_per_gpu_hr.value,
      utilisation: kw.utilisation != null ? kw.utilisation : null,
      market_usd_per_gpu_hr: kw.market_usd_per_gpu_hr != null ? kw.market_usd_per_gpu_hr : null,
    });
    return { cap: cap, res: res };
  }

  A.SECTIONS.push({
    id: "neo",
    defaults: {
      platform: q("", "", "[A]", "rack-matrix variant — seeds kW/GPU + PUE for the capex basis"),
      it_mw: q(1.0, "MW-IT", "[A]", "critical IT capacity for the capex basis"),
      gpus: q(null, "", "[A]", "fleet size; if blank, derived from IT ÷ kW/GPU"),
      utilisation: A.calcNeocloud.DEFAULTS.utilisation,
      market_usd_per_gpu_hr: A.calcNeocloud.DEFAULTS.market_usd_per_gpu_hr,
      kw_per_gpu: q(null, "kW/GPU", "[D]", "blank = the capex page's 1.889 GB200 basis (or the platform pick)"),
      pue: q(null, "", "[S]", "blank = the capex page's 1.15 DSX-band default (or the platform pick)"),
      it_m_per_mw_it: q(null, "US$M/MW-IT", "[D]", "blank = the capex page's 28.5 anchor-band default"),
      power_usd_per_kwh: q(null, "US$/kWh", "[S]", "blank = the 8.71 c/kWh EIA industrial average"),
    },
    compute: (kw) => chain(kw).res,
    hero: "breakeven_rate_usd_per_gpu_hr", heroLabel: "break-even sell rate (the cost floor)",
    heroSrc: "neocloud-model",
    fields: [
      { key: "platform", label: "GPU platform (sets kW/GPU + PUE)", src: "variants", type: "select", value: "",
        options: [["", "(none — GB200 basis)"]].concat(PLATFORMS.map((n) => [n, DB[n].platform])) },
      { key: "it_mw", label: "critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "gpus", label: "GPU count (else derived)", src: "legend", step: 8, min: 1, placeholder: "derived" },
      { key: "market_usd_per_gpu_hr", label: "your sell rate $/GPU-h (anchors below)",
        src: "rental-anchors", step: 0.1, min: 0, placeholder: "enter a rate" },
      { key: "utilisation", label: "billable utilisation (basis-matched to the floor)",
        src: "neocloud-model", step: 0.05, min: 0.05, max: 1 },
      { key: "kw_per_gpu", label: "kW per GPU (rack nameplate)", src: "aif-template", step: 0.01, min: 0.1, advanced: true },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
      { key: "it_m_per_mw_it", label: "IT capex $M/MW-IT", src: "iren-8k", step: 0.5, min: 0, advanced: true },
      { key: "power_usd_per_kwh", label: "power price $/kWh", src: "eia", step: 0.005, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const c = chain(kw);
      const i = c.res.inputs, o = c.res.outputs, co = c.cap.outputs;
      const lines = [
        "capex basis: " + d(co.gpus.value) + " GPUs · all-in " + d(co.capex_total_m.value) +
          " US$M · floor " + d(co.cost_floor_per_gpu_hr.value) + " $/GPU-h at " +
          d(i.utilisation.value) + " utilisation (derived live by the capex engine)",
        "billable hours = GPUs × 8760 × utilisation = " + d(co.gpus.value) + " × 8760 × " +
          d(i.utilisation.value) + " = " + d(o.billable_gpu_hours_yr.value) + " GPU-h/yr",
        "cost = floor × hours = " + d(o.cost_m_yr.value) + " US$M/yr — break-even sell rate = " +
          d(o.breakeven_rate_usd_per_gpu_hr.value) + " $/GPU-h",
      ];
      if (o.margin_usd_per_gpu_hr.value !== null && o.margin_usd_per_gpu_hr.value !== undefined) {
        lines.push(
          "margin = rate − floor = " + d(i.market_usd_per_gpu_hr.value) + " − " +
            d(o.breakeven_rate_usd_per_gpu_hr.value) + " = " + d(o.margin_usd_per_gpu_hr.value) +
            " $/GPU-h (" + d(o.gross_margin_pct.value) + "% gross)",
          "gross margin = " + d(o.gross_margin_m_yr.value) + " US$M/yr → simple payback = " +
            d(c.res.outputs.simple_payback_years.value) + " yr on " +
            d(c.cap.outputs.capex_total_m.value) +
            " US$M all-in capex (undiscounted; compare against the 5-6 yr GPU book life)");
      } else {
        lines.push("enter YOUR sell rate to price margin/revenue/payback — published " +
          "on-demand anchors are on the rate row (dated; committed contracts price below)");
      }
      return lines;
    },
    after: (r, kw) => {
      const host = document.getElementById("neo-sens");
      if (!host) return;
      const rate = kw.market_usd_per_gpu_hr;
      if (rate === null || rate === undefined || rate === "") {
        const p = document.createElement("p");
        p.className = "preset-note";
        p.textContent = "Sensitivity grid appears once you enter a sell rate — every cell " +
          "re-derives the cost floor at its utilisation (the basis contract), so the " +
          "grid can never mix bases.";
        host.replaceChildren(p);
        return;
      }
      const u0 = kw.utilisation != null ? Number(kw.utilisation)
        : A.calcNeocloud.DEFAULTS.utilisation.value;
      const rates = [Number(rate) * 0.8, Number(rate), Number(rate) * 1.2];
      const utils = [Math.max(0.05, u0 - 0.10), u0, Math.min(1.0, u0 + 0.10)];
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "gross margin US$M/yr — sell rate ±20% × utilisation ±10 pts [D] " +
        "(each cell re-derives the floor at its utilisation)";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      const c0 = document.createElement("th");
      c0.textContent = "util \\ rate";
      hr.appendChild(c0);
      for (const rt of rates) {
        const th = document.createElement("th");
        th.textContent = d(rt) + " $/h";
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      utils.forEach((u, ui) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = (u * 100).toFixed(0) + "%";
        tr.appendChild(th);
        rates.forEach((rt, ri) => {
          const cell = chain(Object.assign({}, kw, { utilisation: u, market_usd_per_gpu_hr: rt }))
            .res.outputs.gross_margin_m_yr.value;
          const td = document.createElement("td");
          td.className = "num" + (ui === 1 && ri === 1 ? " sens-base" : "");
          td.textContent = d(cell);
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
  });

  A.boot();
})();
