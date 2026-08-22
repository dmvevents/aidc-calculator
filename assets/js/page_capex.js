// Page config: capex calculator — section extracted 1:1 from the v1 single-page bundle
// (sections_more.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ---------------------------------------------------------------- CAPEX ----
  A.SECTIONS.push({
    id: "capex",
    defaults: A.calcCapex.DEFAULTS,
    compute: (kw) => A.calcCapex.costs(kw),
    hero: "cost_floor_per_gpu_hr", heroLabel: "cost floor (not a price)", heroSrc: "jll",
    fields: [
      { key: "it_mw", label: "critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "power_usd_per_kwh", label: "power price", src: "eia", step: 0.005, min: 0 },
      { key: "utilisation", label: "billable utilisation", src: "legend", step: 0.05, min: 0.05, max: 1 },
      { key: "gpus", label: "GPU count (else derived)", src: "legend", step: 8, min: 1, placeholder: "derived" },
      { key: "it_m_per_mw_it", label: "IT capex $M/MW-IT", src: "iren-8k", step: 0.5, min: 0 },
      { key: "kw_per_gpu", label: "kW per GPU (all-in)", src: "aif-template", step: 0.01, min: 0.1, advanced: true },
      { key: "colo_m_per_mw", label: "shell+core $M/MW", src: "jll", step: 0.1, min: 0, advanced: true },
      { key: "liquid_premium_pct", label: "liquid premium %", src: "jll", step: 1, min: 0, advanced: true },
      { key: "substation_m", label: "substation $M (FEED)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "opex_k_per_mw_it_yr", label: "opex ex-power $k/MW-IT/yr", src: "opex-band", step: 10, min: 0, advanced: true },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
      { key: "load_factor", label: "IT load factor", src: "legend", step: 0.05, min: 0.05, max: 1, advanced: true },
      { key: "life_years", label: "GPU life (yr)", src: "legend", step: 0.5, min: 1, advanced: true },
      { key: "facility_life_years", label: "facility life (yr)", src: "legend", step: 1, min: 1, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      return [
        "capex = shell(" + d(o.capex_colo_m.value) + ") + liquid(" + d(o.capex_liquid_adder_m.value) +
          ") + IT(" + d(o.capex_it_m.value) + ")" +
          (o.capex_substation_m && o.capex_substation_m.value ? " + sub(" + d(o.capex_substation_m.value) + ")" : "") +
          " = " + d(o.capex_total_m.value) + " US$M (" + d(o.capex_per_gpu_usd.value) + " $/GPU)",
        "amortisation = IT÷" + d(i.life_years.value) + " + facility÷" + d(i.facility_life_years.value) +
          " = " + d(o.amortisation_m_yr.value) + " US$M/yr",
        "energy = IT × PUE × 8760 × LF × rate = " + d(i.it_mw.value) + "×" + d(i.pue.value) + "×8760×" +
          d(i.load_factor.value) + "×" + d(i.power_usd_per_kwh.value) + " = " + d(o.energy_cost_m_yr.value) + " US$M/yr",
        "floor = (amort + opex + energy) ÷ billable = (" + d(o.amortisation_m_yr.value) + " + " +
          d(o.opex_ex_power_m_yr.value) + " + " + d(o.energy_cost_m_yr.value) + ")×10⁶ ÷ " +
          d(o.billable_gpu_hours_yr.value) + " = " + d(o.cost_floor_per_gpu_hr.value) + " US$/GPU-h",
      ];
    },
    after: (r, kw) => {
      const host = document.getElementById("capex-sens");
      if (!host) return;
      const s = A.calcCapex.sensitivity(kw, 20, 0.10);
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "cost floor US$/GPU-h — power price ±20% × utilisation ±10 pts [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      const c0 = document.createElement("th");
      c0.textContent = "util \\ price";
      hr.appendChild(c0);
      for (const pr of s.prices) {
        const th = document.createElement("th");
        th.textContent = d(pr) + " $/kWh";
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      s.utils.forEach((u, ui) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = (u * 100).toFixed(0) + "%";
        tr.appendChild(th);
        s.prices.forEach((pr, pi) => {
          const td = document.createElement("td");
          td.className = "num" + (ui === 1 && pi === 1 ? " sens-base" : "");
          td.textContent = d(s.rows[ui * 3 + pi].floor);
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
