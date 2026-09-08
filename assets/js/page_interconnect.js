// Page config: interconnect calculator — the grid-interconnection queue / study
// timeline lens. The power core sizes the interconnection MW live (facility_mw =
// it_mw x pue); that composed MW steps the study tier, and the interconnection-desk
// inputs (the phase durations, the study thresholds, the network-upgrade $/kW, the
// contingency) roll into the critical-path timeline and the network-upgrade cost
// band. Renders the critical-path chain from the queue wait and the four sequential
// study phases through the summed total, with the tier-stepped system impact study
// called out. Ends with A.boot().
// parity: assets/js/calc_interconnect.js (the 1:1 core port); the arithmetic lives
// in the engine, this file only presents it.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ---------------------------------------------------------- INTERCONNECT --
  A.SECTIONS.push({
    id: "interconnect",
    // the interconnection-desk inputs carry their own DEFAULTS/chips; it_mw (which
    // sizes the interconnection MW the study tier composes over) borrows the power
    // core's DEFAULT so its field chips + placeholders like the power page.
    defaults: Object.assign({}, { it_mw: A.calcPower.DEFAULTS.it_mw }, A.calcInterconnect.DEFAULTS),
    compute: (kw) => A.calcInterconnect.interconnect(kw),
    hero: "total_interconnect_weeks",
    heroLabel: "end-to-end interconnection critical path (queue → agreement), weeks", heroSrc: "legend",
    fields: [
      { key: "it_mw", label: "critical IT (sizes the interconnection MW via calc_power)", src: "legend", step: 0.5, min: 0.1 },
      { key: "queue_wait_weeks", label: "queue-position wait (weeks)", src: "legend", step: 1, min: 0 },
      { key: "feasibility_study_weeks", label: "feasibility study (weeks)", src: "legend", step: 1, min: 0 },
      { key: "facilities_study_weeks", label: "facilities study (weeks)", src: "legend", step: 1, min: 0 },
      { key: "interconnection_agreement_weeks", label: "interconnection agreement (weeks)", src: "legend", step: 1, min: 0 },
      { key: "system_impact_study_base_weeks", label: "system impact study base, tier 0 (weeks)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "system_impact_study_tier_step_weeks", label: "system impact study per-tier step (weeks)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "study_tier_1_mw", label: "tier-1 interconnection-MW threshold (MW)", src: "legend", step: 5, min: 0.1, advanced: true },
      { key: "study_tier_2_mw", label: "tier-2 interconnection-MW threshold (MW)", src: "legend", step: 10, min: 0.1, advanced: true },
      { key: "network_upgrade_base_usd_per_kw", label: "network-upgrade base, tier 0 ($/kW)", src: "legend", step: 5, min: 0, advanced: true },
      { key: "network_upgrade_tier_step_usd_per_kw", label: "network-upgrade per-tier step ($/kW)", src: "legend", step: 5, min: 0, advanced: true },
      { key: "schedule_contingency_frac", label: "schedule contingency (fraction)", src: "legend", step: 0.05, min: 0, advanced: true },
    ],
    derive: (r) => {
      const o = r.outputs;
      return [
        "interconnection MW = calc_power facility_mw (it_mw × pue) = " +
          d(o.interconnection_mw.value) + " MW (composed live over calc_power)",
        "study tier = step on interconnection MW vs tier-1/tier-2 thresholds → tier " +
          d(o.study_tier.value),
        "system impact study = base + step × tier = " + d(o.system_impact_study_weeks.value) + " weeks",
        "study process = feasibility + system impact study + facilities + interconnection agreement = " +
          d(o.study_process_weeks.value) + " weeks",
        "total = queue wait + study process = " + d(o.total_interconnect_weeks.value) + " weeks (≈ " +
          d(o.total_interconnect_months.value) + " months)",
        "high band = total × (1 + contingency) = " + d(o.total_interconnect_weeks_high.value) + " weeks",
        "network-upgrade cost = interconnection MW × 1000 × (base + step × tier) $/kW ÷ 1e6 = $" +
          d(o.network_upgrade_cost_m.value) + "M (at " + d(o.network_upgrade_cost_per_kw.value) + " $/kW)",
      ];
    },
    // the VISUAL: a critical-path chain — the queue wait → the four sequential study
    // phases (the tier-stepped system impact study highlighted when the tier binds) →
    // their summed study process (highlighted) → the end-to-end total (highlighted).
    // The total row is total_interconnect_weeks (the headline critical path).
    after: (r) => {
      const host = document.getElementById("interconnect-bridge");
      if (!host) return;
      const o = r.outputs;
      const queueWait = r.inputs.queue_wait_weeks.value;
      const feasibility = r.inputs.feasibility_study_weeks.value;
      const sis = o.system_impact_study_weeks.value;
      const facilities = r.inputs.facilities_study_weeks.value;
      const ia = r.inputs.interconnection_agreement_weeks.value;
      const tier = o.study_tier.value;
      const tierBinds = tier > 0;
      const rows = [
        ["Queue-position wait (sequential)", d(queueWait), "weeks", false],
        ["+ Feasibility study (sequential)", d(feasibility), "weeks", false],
        ["+ System impact study (tier-stepped)", d(sis), "weeks", tierBinds],
        ["+ Facilities study (sequential)", d(facilities), "weeks", false],
        ["+ Interconnection agreement (sequential)", d(ia), "weeks", false],
        ["= Study process (feasibility + SIS + facilities + agreement)", d(o.study_process_weeks.value), "weeks", true],
        ["Total interconnection critical path (queue + study process)", d(o.total_interconnect_weeks.value), "weeks", true],
      ];

      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "Interconnection critical path — the queue wait and the four sequential study phases summed to the total timeline, with the tier-stepped system impact study called out [D]";
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

      // study-tier + months + contingency + network-upgrade cost callout under the chain
      const note = document.createElement("p");
      note.className = "preset-note";
      note.textContent =
        "Study tier: " +
        (tierBinds
          ? "the composed " + d(o.interconnection_mw.value) + "-MW interconnection is at tier " +
            d(tier) + ", so the system impact study is escalated to " + d(sis) +
            " wks (base + step × tier) and the network-upgrade cost steps up with the tier"
          : "the composed " + d(o.interconnection_mw.value) + "-MW interconnection is below the tier-1 " +
            "threshold (tier 0), so the system impact study stays at its base " + d(sis) +
            " wks and does not yet move the total with scale") + ". " +
        "Total ≈ " + d(o.total_interconnect_weeks.value) + " weeks (≈ " +
        d(o.total_interconnect_months.value) + " months); with contingency the high band is ≈ " +
        d(o.total_interconnect_weeks_high.value) + " weeks. Network-upgrade cost ≈ $" +
        d(o.network_upgrade_cost_m.value) + "M (at " + d(o.network_upgrade_cost_per_kw.value) + " $/kW).";

      host.replaceChildren(tbl, note);
    },
  });

  A.boot();
})();
