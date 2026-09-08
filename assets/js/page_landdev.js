// Page config: land-development calculator — the grading / earthwork lens. The
// land core sizes the disturbed PARCEL live; the grading-desk inputs (cut/fill
// depth, cut-area split, swell/shrink factors, unit cost, production) roll into
// cut, fill and the cut-fill BALANCE. Renders the mass-haul balance from bank cut
// through the net import/export, with export-vs-import called out. Ends with
// A.boot(). parity: assets/js/calc_landdev.js (the 1:1 core port); the arithmetic
// lives in the engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ---------------------------------------------------------- LAND DEVELOPMENT --
  A.SECTIONS.push({
    id: "landdev",
    // the grading-desk inputs carry their own DEFAULTS/chips; it_mw (which sizes
    // the graded parcel the disturbed area composes over) borrows the land core's
    // DEFAULT so its field chips + placeholders like the land page.
    defaults: Object.assign({}, { it_mw: A.calcLand.DEFAULTS.it_mw }, A.calcLanddev.DEFAULTS),
    compute: (kw) => A.calcLanddev.landdev(kw),
    hero: "net_import_export_cy",
    heroLabel: "net cut-fill balance (+ export / − import), loose CY", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (sizes the graded parcel via calc_land)", src: "legend", step: 0.5, min: 0.1 },
      { key: "cut_depth_ft", label: "average cut depth (ft)", src: "legend", step: 0.5, min: 0 },
      { key: "fill_depth_ft", label: "average fill depth (ft)", src: "legend", step: 0.5, min: 0 },
      { key: "cut_area_frac", label: "cut-area fraction (rest is fill)", src: "legend", step: 0.05, min: 0, max: 1 },
      { key: "swell_factor", label: "bank→loose swell factor", src: "legend", step: 0.01, min: 0.1, advanced: true },
      { key: "shrink_compaction_factor", label: "loose→compacted factor", src: "legend", step: 0.01, min: 0.1, advanced: true },
      { key: "earthwork_unit_cost_per_cy", label: "earthwork unit cost ($/CY)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "production_rate_cy_per_day", label: "grading production (CY/day)", src: "legend", step: 100, min: 1, advanced: true },
      { key: "working_days_per_week", label: "working days / week", src: "legend", step: 1, min: 1, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "net = cut_cy × swell − fill_cy ÷ shrink = " +
          d(o.cut_cy.value) + " × swell − " + d(o.fill_cy.value) + " ÷ shrink = " +
          d(o.net_import_export_cy.value) + " loose CY (+ export / − import)",
        "cut_cy = disturbed_sf × cut_area_frac × cut_depth / 27 = " + d(o.cut_cy.value) + " bank CY",
        "fill_cy = disturbed_sf × (1 − cut_area_frac) × fill_depth / 27 = " + d(o.fill_cy.value) + " compacted CY",
        "cut_loose = cut_cy × swell = " + d(o.cut_loose_cy.value) + " loose CY; " +
          "fill_loose_required = fill_cy ÷ shrink = " + d(o.fill_loose_required_cy.value) + " loose CY",
        "earthwork cost = (cut + fill) × unit / 1e6 = " + d(o.graded_volume_cy.value) + " CY → " +
          d(o.earthwork_cost_m.value) + " US$M",
        "grading duration = (cut + fill) / production / days-per-week = " +
          d(o.grading_duration_weeks.value) + " wk",
      ];
    },
    // the VISUAL: a mass-haul balance from bank cut → loose → net import/export.
    // Each step is its quantity; the closing row is net_import_export_cy (the
    // identity), rendered with the export/import sign highlighted.
    after: (r) => {
      const host = document.getElementById("landdev-bridge");
      if (!host) return;
      const o = r.outputs;
      const net = o.net_import_export_cy.value;
      const rows = [
        ["Cut (in-situ, bank)", d(o.cut_cy.value), "bank CY", false],
        ["× swell → loose produced", d(o.cut_loose_cy.value), "loose CY", false],
        ["Fill (placed, compacted)", d(o.fill_cy.value), "compacted CY", false],
        ["÷ shrink → loose required", d(o.fill_loose_required_cy.value), "loose CY", false],
        ["= Net balance (+ export / − import)", d(net), "loose CY", true],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "Cut-fill balance — bank cut through net import/export, loose CY [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const h of ["step", "quantity", "basis"]) {
        const th = document.createElement("th");
        th.textContent = h;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const [label, amt, basis, isNet] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        const tda = document.createElement("td");
        tda.className = "num" + (isNet ? " sens-base" : "");
        tda.textContent = amt;
        const tdb = document.createElement("td");
        tdb.textContent = basis;
        tr.append(tda, tdb);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);

      // export/import + cost + duration callout under the balance
      const note = document.createElement("p");
      note.className = "preset-note";
      const exporting = net >= 0;
      note.textContent =
        "Cut-fill balance: " +
        (exporting ? "EXPORT " + d(net) + " loose CY of surplus off site"
                   : "IMPORT " + d(-net) + " loose CY to make grade") + ". " +
        "Earthwork (cut + fill = " + d(o.graded_volume_cy.value) + " CY) at the blended rate = " +
        d(o.earthwork_cost_m.value) + " US$M; grading duration ≈ " +
        d(o.grading_duration_weeks.value) + " weeks over " +
        d(o.disturbed_area_acres.value) + " graded acres.";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
