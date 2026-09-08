// Page config: entitlements calculator — the permitting / land-use approval
// timeline lens. The land core sizes the disturbed PARCEL live; that composed
// acreage steps the environmental-review tier, and the entitlement-desk inputs
// (the phase durations, the review thresholds, the contingency) roll into the
// critical-path timeline. Renders the critical-path chain from the sequential
// phases and the two concurrent review tracks through the binding max to the
// total timeline, with the binding branch called out. Ends with A.boot().
// parity: assets/js/calc_entitlements.js (the 1:1 core port); the arithmetic
// lives in the engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ---------------------------------------------------------- ENTITLEMENTS --
  A.SECTIONS.push({
    id: "entitlements",
    // the entitlement-desk inputs carry their own DEFAULTS/chips; it_mw (which
    // sizes the disturbed parcel the environmental tier composes over) borrows
    // the land core's DEFAULT so its field chips + placeholders like the land page.
    defaults: Object.assign({}, { it_mw: A.calcLand.DEFAULTS.it_mw }, A.calcEntitlements.DEFAULTS),
    compute: (kw) => A.calcEntitlements.entitlements(kw),
    hero: "total_entitlement_weeks",
    heroLabel: "end-to-end entitlement critical path (pre-app → permit), weeks", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (sizes the disturbed parcel via calc_land)", src: "legend", step: 0.5, min: 0.1 },
      { key: "pre_application_weeks", label: "pre-application / conceptual review (weeks)", src: "legend", step: 1, min: 0 },
      { key: "rezoning_weeks", label: "discretionary rezoning / PUD track (weeks)", src: "legend", step: 1, min: 0 },
      { key: "site_plan_approval_weeks", label: "site-plan / subdivision approval (weeks)", src: "legend", step: 1, min: 0 },
      { key: "permit_issuance_weeks", label: "building-permit issuance (weeks)", src: "legend", step: 1, min: 0 },
      { key: "environmental_review_base_weeks", label: "environmental review base, tier 0 (weeks)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "environmental_review_tier_step_weeks", label: "environmental review per-tier step (weeks)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "ea_threshold_acres", label: "EA disturbed-area threshold (acres)", src: "legend", step: 0.5, min: 0.1, advanced: true },
      { key: "eis_threshold_acres", label: "EIS disturbed-area threshold (acres)", src: "legend", step: 1, min: 0.1, advanced: true },
      { key: "schedule_contingency_frac", label: "schedule contingency (fraction)", src: "legend", step: 0.05, min: 0, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "disturbed area = calc_land parcel_m2 ÷ 4,046.856 = " +
          d(o.disturbed_area_acres.value) + " acres (composed live over calc_land)",
        "environmental tier = step on disturbed acres vs EA/EIS thresholds → tier " +
          d(o.environmental_review_tier.value),
        "environmental review = base + step × tier = " + d(o.environmental_review_weeks.value) + " weeks",
        "sequential phases = pre-app + site-plan + permit = " + d(o.sequential_phases_weeks.value) + " weeks",
        "parallel branch = max(rezoning, environmental) = " + d(o.parallel_review_weeks.value) +
          " weeks (the binding concurrent track)",
        "total = sequential + parallel = " + d(o.total_entitlement_weeks.value) + " weeks (≈ " +
          d(o.total_entitlement_months.value) + " months)",
        "high band = total × (1 + contingency) = " + d(o.total_entitlement_weeks_high.value) + " weeks",
      ];
    },
    // the VISUAL: a critical-path chain — the three sequential phases → their sum
    // (the load-bearing sequential total, highlighted) → the two concurrent review
    // tracks → the binding max (highlighted) → the end-to-end total (highlighted).
    // The total row is total_entitlement_weeks (the headline critical path).
    after: (r) => {
      const host = document.getElementById("entitlements-bridge");
      if (!host) return;
      const o = r.outputs;
      const preApp = r.inputs.pre_application_weeks.value;
      const sitePlan = r.inputs.site_plan_approval_weeks.value;
      const permit = r.inputs.permit_issuance_weeks.value;
      const rezoning = r.inputs.rezoning_weeks.value;
      const env = o.environmental_review_weeks.value;
      const parallel = o.parallel_review_weeks.value;
      const envBinds = env >= rezoning;
      const rows = [
        ["Pre-application (sequential)", d(preApp), "weeks", false],
        ["+ Site-plan approval (sequential)", d(sitePlan), "weeks", false],
        ["+ Permit issuance (sequential)", d(permit), "weeks", false],
        ["= Sequential phases", d(o.sequential_phases_weeks.value), "weeks", true],
        ["Rezoning / discretionary track (concurrent)", d(rezoning), "weeks", false],
        ["Environmental review track (concurrent)", d(env), "weeks", false],
        ["= Binding parallel branch max(rezoning, env)", d(parallel), "weeks", true],
        ["Total entitlement critical path (sequential + parallel)", d(o.total_entitlement_weeks.value), "weeks", true],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "Entitlement critical path — the sequential phases and the concurrent review tracks through the binding max to the total timeline [D]";
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

      // binding-track + months + contingency callout under the chain
      const note = document.createElement("p");
      note.className = "preset-note";
      note.textContent =
        "Critical path: " +
        (envBinds
          ? "the environmental-review track (" + d(env) + " wks, tier " +
            d(o.environmental_review_tier.value) + " on the composed " +
            d(o.disturbed_area_acres.value) + "-acre disturbance) OVERTAKES the rezoning track (" +
            d(rezoning) + " wks) and binds the concurrent branch"
          : "the discretionary rezoning track (" + d(rezoning) + " wks) binds the concurrent branch — the " +
            "environmental track (" + d(env) + " wks, tier " + d(o.environmental_review_tier.value) +
            ") does not yet move the total at this scale") + ". " +
        "Total ≈ " + d(o.total_entitlement_weeks.value) + " weeks (≈ " +
        d(o.total_entitlement_months.value) + " months); with contingency the high band is ≈ " +
        d(o.total_entitlement_weeks_high.value) + " weeks.";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
