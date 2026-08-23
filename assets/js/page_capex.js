// Page config: capex calculator — section extracted 1:1 from the v1 single-page bundle
// (sections_more.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  function resolvePlatform(kw) {
    const k2 = Object.assign({}, kw);
    const name = k2.platform;
    delete k2.platform;
    const v = name && globalThis.RACKDB ? globalThis.RACKDB[name] : null;
    if (v) {
      if (k2.kw_per_gpu == null) k2.kw_per_gpu = v.nameplate_kw / v.gpus_per_rack;
      if (k2.pue == null) k2.pue = v.pue_target;
    }
    return k2;
  }

  // ---------------------------------------------------------------- CAPEX ----
  A.SECTIONS.push({
    id: "capex",
    defaults: A.calcCapex.DEFAULTS,
    // CX-H7 (v3.1): optional platform pick — kw_per_gpu = nameplate/gpus_per_rack
    // and PUE follow it unless the user typed overrides. "" = no platform,
    // page defaults (the 1.889 GB200 nameplate basis) apply. EVERY consumer of
    // the kwargs (compute, sensitivity grid, density table) resolves through
    // THIS function so the hero and the tables can never diverge (antagonist
    // A-04: raw-kw sensitivity contradicted the platform-resolved hero).
    compute: (kw) => A.calcCapex.costs(resolvePlatform(kw)),
    hero: "cost_floor_per_gpu_hr", heroLabel: "cost floor (not a price)", heroSrc: "jll",
    fields: [
      { key: "platform", label: "GPU platform (sets kW/GPU + PUE)", src: "variants", type: "select", value: "",
        options: [["", "(none — set kW/GPU directly)"]].concat(
          ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"]
            .map((n) => [n, globalThis.RACKDB[n].platform])) },
      { key: "it_mw", label: "critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "power_usd_per_kwh", label: "power price", src: "eia", step: 0.005, min: 0 },
      { key: "utilisation", label: "billable utilisation (build basis — tco plans at 0.70)", src: "legend", step: 0.05, min: 0.05, max: 1 },
      { key: "gpus", label: "GPU count (else derived)", src: "legend", step: 8, min: 1, placeholder: "derived" },
      { key: "it_m_per_mw_it", label: "IT capex $M/MW-IT", src: "iren-8k", step: 0.5, min: 0 },
      { key: "spares_pct_of_it", label: "spares/DOA float % of IT", src: "fm-spares", step: 0.5, min: 0 },
      { key: "contingency_pct_of_facility", label: "named-risk contingency % of facility", src: "fm-contingency", step: 0.5, min: 0 },
      { key: "kw_per_gpu", label: "kW per GPU (rack nameplate)", src: "aif-template", step: 0.01, min: 0.1, advanced: true },
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
        (o.gpus.label === "[D]"
          ? "GPUs = IT×1000 ÷ kW/GPU = " + d(i.it_mw.value) + "×1000 ÷ " + d(i.kw_per_gpu.value) +
            " = " + d(o.gpus.value) + " — at " + d(i.kw_per_gpu.value) + " kW/GPU that is " +
            d(1000 / i.kw_per_gpu.value) + " GPUs/MW" +
            (Math.abs(i.kw_per_gpu.value - 1.889) < 1e-9 ? " (the 136 ÷ 72 rack-nameplate basis)" : "") +
            "; support IT + optics excluded"
          : "GPUs = " + d(o.gpus.value) + " (user-supplied — kW/GPU not used)"),
        "capex = shell(" + d(o.capex_colo_m.value) + ") + liquid(" + d(o.capex_liquid_adder_m.value) +
          ") + IT(" + d(o.capex_it_m.value) + ")" +
          (o.capex_substation_m && o.capex_substation_m.value ? " + sub(" + d(o.capex_substation_m.value) + ")" : "") +
          " + spares(" + d(o.capex_spares_pool_m.value) + ") + contingency(" + d(o.capex_contingency_m.value) + ")" +
          " = " + d(o.capex_total_m.value) + " US$M (" + d(o.capex_per_gpu_usd.value) + " $/GPU)",
        "spares float = IT × " + d(i.spares_pct_of_it.value) + "% — DOA ~10% is vendor-RMA-covered [S]; " +
          "the float rides the RMA pipeline: 2.34/1k node-days [S] × ~25% swap [A] × 6-wk RMA [A] ≈ 2.5%",
        "contingency = facility × " + d(i.contingency_pct_of_facility.value) + "% — Σ(P×exposure) over 10 " +
          "NAMED failure classes (FM-RCK-001/002, FM-FIB-001, FM-NET-001, FM-PWR-001/005, FM-PWR-003/008, " +
          "FM-UPS-001, FM-GEN-001/008, FM-LIQ-001/002, FM-LIQ-004, FM-BMS-001/003) = 2.54% → 2.5 default",
        "amortisation = (IT + spares)÷" + d(i.life_years.value) + " + (facility + contingency)÷" +
          d(i.facility_life_years.value) + " = " + d(o.amortisation_m_yr.value) + " US$M/yr",
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
      const platformName = kw.platform;
      kw = resolvePlatform(kw);   // A-04: same resolution as compute
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

      // density basis: the floor at the three GB200 NVL72 density readings —
      // rack nameplate (default), the unverified 120 kW public-quote band, and
      // the SU-TDP basis that folds fabric+mgmt in. Skipped when the GPU count
      // is user-supplied (kW/GPU is not used then).
      if (kw.gpus !== null && kw.gpus !== undefined) { host.replaceChildren(tbl); return; }
      const cur = (kw.kw_per_gpu !== null && kw.kw_per_gpu !== undefined)
        ? Number(kw.kw_per_gpu) : A.calcCapex.DEFAULTS.kw_per_gpu.value;
      const bases = [
        ["136 kW nameplate ÷ 72 [D] — default; rack page reads the same", 1.889],
        ["120 kW public quote ÷ 72 [A] — assumption-verify (no NVIDIA doc)", 1.667],
        ["1.2 MW SU TDP ÷ 576 [D] — SU basis, fabric+mgmt folded in", 1.2 * 1000 / 576],
      ];
      if (!bases.some((b) => Math.abs(b[1] - cur) < 5e-4)) {
        bases.push([platformName
          ? platformName + " nameplate basis (platform pick)"
          : "your kW/GPU input", cur]);
      }
      const dtbl = document.createElement("table");
      dtbl.className = "matrix";
      const dcap = document.createElement("caption");
      dcap.textContent = "cost floor US$/GPU-h — GB200 NVL72 density basis [D]";
      dtbl.appendChild(dcap);
      const dhead = document.createElement("thead");
      const dhr = document.createElement("tr");
      for (const h of ["density basis", "kW/GPU", "GPUs", "floor $/GPU-h"]) {
        const th = document.createElement("th");
        th.textContent = h;
        dhr.appendChild(th);
      }
      dhead.appendChild(dhr);
      dtbl.appendChild(dhead);
      const dtb = document.createElement("tbody");
      for (const [label, v] of bases) {
        const r2 = A.calcCapex.costs(Object.assign({}, kw, { kw_per_gpu: v }));
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        for (const cell of [d(v), d(r2.outputs.gpus.value), d(r2.outputs.cost_floor_per_gpu_hr.value)]) {
          const td = document.createElement("td");
          td.className = "num" + (Math.abs(v - cur) < 5e-4 ? " sens-base" : "");
          td.textContent = cell;
          tr.appendChild(td);
        }
        dtb.appendChild(tr);
      }
      dtbl.appendChild(dtb);
      host.replaceChildren(tbl, dtbl);
    },
  });

  A.boot();
})();
