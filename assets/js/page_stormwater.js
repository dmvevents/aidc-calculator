// Page config: stormwater calculator — the peak-runoff / detention lens. The
// land core sizes the drainage PARCEL live; the hydrology-desk inputs (design
// storm intensity/duration, impervious fraction, runoff coefficients, basin
// depth, unit cost) roll into peak runoff and the detention BALANCE. Renders the
// runoff-to-detention chain from pre-development peak through the required
// detention volume, with the attenuate-vs-none sign called out. Ends with
// A.boot(). parity: assets/js/calc_stormwater.js (the 1:1 core port); the
// arithmetic lives in the engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ------------------------------------------------------------- STORMWATER --
  A.SECTIONS.push({
    id: "stormwater",
    // the hydrology-desk inputs carry their own DEFAULTS/chips; it_mw (which sizes
    // the drainage parcel the site area composes over) borrows the land core's
    // DEFAULT so its field chips + placeholders like the land page.
    defaults: Object.assign({}, { it_mw: A.calcLand.DEFAULTS.it_mw }, A.calcStormwater.DEFAULTS),
    compute: (kw) => A.calcStormwater.stormwater(kw),
    hero: "required_detention_volume_cf",
    heroLabel: "required detention volume (+ attenuate surplus / − none), CF", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (sizes the drainage parcel via calc_land)", src: "legend", step: 0.5, min: 0.1 },
      { key: "design_storm_intensity_in_hr", label: "design storm intensity (in/hr)", src: "legend", step: 0.5, min: 0 },
      { key: "storm_duration_min", label: "storm duration (min)", src: "legend", step: 5, min: 1 },
      { key: "impervious_frac", label: "impervious fraction (rest is pervious)", src: "legend", step: 0.05, min: 0, max: 1 },
      { key: "runoff_coeff_impervious", label: "impervious runoff C", src: "legend", step: 0.01, min: 0, max: 1, advanced: true },
      { key: "runoff_coeff_pervious", label: "pervious runoff C", src: "legend", step: 0.01, min: 0, max: 1, advanced: true },
      { key: "runoff_coeff_pre", label: "pre-development runoff C", src: "legend", step: 0.01, min: 0, max: 1, advanced: true },
      { key: "avg_detention_depth_ft", label: "average detention depth (ft)", src: "legend", step: 0.5, min: 0.1, advanced: true },
      { key: "detention_unit_cost_per_cf", label: "detention unit cost ($/CF)", src: "legend", step: 0.5, min: 0, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "volume = (Q_post − Q_pre) × duration × 60 = (" +
          d(o.peak_runoff_post_cfs.value) + " − " + d(o.peak_runoff_pre_cfs.value) + ") × duration = " +
          d(o.required_detention_volume_cf.value) + " CF (+ attenuate / − none)",
        "C_post = impervious_frac × C_imp + (1 − impervious_frac) × C_perv = " + d(o.runoff_coeff_post.value),
        "Q_pre = C_pre × intensity × area = " + d(o.peak_runoff_pre_cfs.value) + " cfs (allowable release)",
        "Q_post = C_post × intensity × area = " + d(o.peak_runoff_post_cfs.value) + " cfs (developed peak)",
        "peak increase = Q_post − Q_pre = " + d(o.peak_runoff_increase_cfs.value) + " cfs",
        "footprint = volume ÷ depth ÷ 43,560 = " + d(o.detention_footprint_acres.value) + " ac; " +
          "cost = volume × unit / 1e6 = " + d(o.detention_cost_m.value) + " US$M",
      ];
    },
    // the VISUAL: a runoff-to-detention chain from pre-development peak → developed
    // peak → the surplus → the detention volume → the basin footprint. The surplus
    // row is peak_runoff_increase_cfs (the signed identity), highlighted.
    after: (r) => {
      const host = document.getElementById("stormwater-bridge");
      if (!host) return;
      const o = r.outputs;
      const inc = o.peak_runoff_increase_cfs.value;
      const rows = [
        ["Pre-development peak (allowable release)", d(o.peak_runoff_pre_cfs.value), "cfs", false],
        ["Post-development peak (developed)", d(o.peak_runoff_post_cfs.value), "cfs", false],
        ["= Peak increase (+ attenuate / − none)", d(inc), "cfs", true],
        ["× duration × 60 → detention volume", d(o.required_detention_volume_cf.value), "CF", false],
        ["÷ depth ÷ 43,560 → basin footprint", d(o.detention_footprint_acres.value), "acres", false],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "Runoff-to-detention balance — pre/post peak through detention volume [D]";
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

      // attenuate/none + footprint + cost callout under the balance
      const note = document.createElement("p");
      note.className = "preset-note";
      const attenuating = inc > 0;
      note.textContent =
        "Detention: " +
        (attenuating ? "hold " + d(o.required_detention_volume_cf.value) + " CF to attenuate the "
                       + d(inc) + " cfs surplus"
                     : "no detention required — the developed peak (" + d(o.peak_runoff_post_cfs.value)
                       + " cfs) does not exceed the pre-development rate") + ". " +
        "Basin footprint ≈ " + d(o.detention_footprint_acres.value) + " acres at the assumed depth; " +
        "construction ≈ " + d(o.detention_cost_m.value) + " US$M over " +
        d(o.site_area_acres.value) + " drainage acres.";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
