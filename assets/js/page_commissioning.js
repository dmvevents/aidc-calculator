// Page config: commissioning calculator — section extracted 1:1 from the v1 single-page bundle
// (sections_more.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // -------------------------------------------------------- COMMISSIONING ----
  A.SECTIONS.push({
    id: "cx",
    defaults: A.calcCx.DEFAULTS,
    compute: (kw) => A.calcCx.ladder(kw),
    hero: "p4_ups_bank_draw_mw", heroLabel: "UPS load-bank draw per path — before any GPU", heroSrc: "dossiers",
    fields: [
      { key: "it_mw", label: "IT load", src: "legend", step: 0.5, min: 0.1 },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1 },
      { key: "scalable_units", label: "scalable units (P7 steps)", src: "gb200-ra", step: 1, min: 1, placeholder: "e.g. 4" },
      { key: "p_e_usd_kwh", label: "energy rate", src: "eia", step: 0.005, min: 0 },
      { key: "genset_installed_mva", label: "installed genset MVA (P3)", src: "legend", step: 0.5, min: 0 },
      { key: "p_d_usd_kva_month", label: "demand rate (ratchet check)", src: "legend", step: 0.5, min: 0 },
      { key: "construction_frac", label: "P0 construction frac", src: "dossiers", step: 0.005, min: 0, advanced: true },
      { key: "house_frac", label: "P1 house frac", src: "dossiers", step: 0.005, min: 0, advanced: true },
      { key: "mech_frac", label: "P2 mech frac", src: "dossiers", step: 0.01, min: 0, advanced: true },
      { key: "mech_on_ups_frac", label: "mech-on-UPS / IT", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "ups_loss_frac", label: "UPS loss frac", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "rack_idle_frac_of_it", label: "idle fleet / IT", src: "aif-template", step: 0.005, min: 0, advanced: true },
      { key: "support_it_frac_of_it", label: "support IT / IT", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "liquid_frac", label: "liquid bank share", src: "aif-template", step: 0.01, min: 0, max: 1, advanced: true },
      { key: "cx_hours_low", label: "test window low (h)", src: "dossiers", step: 10, min: 0, advanced: true },
      { key: "cx_hours", label: "test window mid (h)", src: "dossiers", step: 10, min: 0, advanced: true },
      { key: "cx_hours_high", label: "test window high (h)", src: "dossiers", step: 10, min: 0, advanced: true },
      { key: "pf", label: "billed PF at test peak", src: "refdesign", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "accept_months_low", label: "accept band low (mo)", src: "dossiers", step: 0.5, min: 0, advanced: true },
      { key: "accept_months_high", label: "accept band high (mo)", src: "dossiers", step: 0.5, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      const L = [
        "P4 · bank/path = IT × (1+mech) × (1+UPS loss) = " + d(i.it_mw.value) + " × " +
          d(1 + i.mech_on_ups_frac.value) + " × " + d(1 + i.ups_loss_frac.value) + " = " +
          d(o.p4_ups_bank_draw_mw.value) + " MW = " + d(o.p4_pct_of_facility.value) + "% of facility — no GPUs yet",
        "bank fleet = " + d(o.load_bank_total_mw.value) + " MW, of which LIQUID-side " +
          d(o.load_bank_liquid_mw.value) + " MW (× " + d(i.liquid_frac.value) + ")",
        "Cx energy = facility × window = " + d(o.facility_mw.value) + " MW × " + d(i.cx_hours.value) + " h = " +
          d(o.cx_energy_mwh_mid.value) + " MWh (band " + d(o.cx_energy_mwh_low.value) + "–" +
          d(o.cx_energy_mwh_high.value) + ") → " + d(o.cx_energy_cost_usd_mid.value) + " US$ at tariff",
        "timeline = " + d(o.accept_months_low.value) + "–" + d(o.accept_months_high.value) +
          " months site-ready→accepted [A] · published floor " + d(o.timeline_floor_days ? o.timeline_floor_days.value : 19) +
          " days (Colossus [S])",
      ];
      return L;
    },
    after: (r) => {
      const c = document.getElementById("cx-steps");
      if (c) A.diagrams.cxLadder(c, r, A.calcCx.ladderSteps(r));
    },
    init: () => {
      const host = document.getElementById("cx-levels");
      if (!host) return;
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "commissioning level ladder L0–L6 (industry tag taxonomy) [S]";
      tbl.appendChild(cap);
      const tb = document.createElement("tbody");
      for (const [id, name, what, tag] of A.calcCx.CX_LEVELS) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = id + " · " + name;
        const td1 = document.createElement("td");
        td1.textContent = what;
        const td2 = document.createElement("td");
        td2.textContent = tag;
        td2.className = "unit-cell";
        tr.append(th, td1, td2);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
  });

  A.boot();
})();
