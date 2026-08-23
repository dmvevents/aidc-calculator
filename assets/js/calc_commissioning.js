// Commissioning load steps + commissioning energy. PURE: object in -> result out.
// parity: cli/aidc/core/calc_commissioning.py — ladder() ported 1:1
// (research/08-deployment-commissioning.md §6: the "when do you need how many
// MW?" ladder P0-P8, the bank fleet split, the Cx-energy pro-forma line and
// the site-ready -> accepted band).
// CX_LEVELS and ladderSteps() are site-only additions for the checklist table
// and the SVG ladder; they add no arithmetic of their own.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    it_mw: q(1.0, "MW-IT", "[A]",
             "generic 1 MW-IT reference block — set to your project"),
    pue: q(1.15, "", "[S]",
           "NVIDIA DSX facility KPI band 1.15-1.20, low end"),
    construction_frac: q(0.05, "frac", "[A]",
                         "P0 temp construction power / facility (dossier §6 A8.14: 0.2-0.5 MW on 6.0 MW)"),
    house_frac: q(0.025, "frac", "[D]",
                  "P1 house load / facility, mid of the 2-3% band (dossier §6: 0.10 MW house + margin)"),
    mech_frac: q(0.15, "frac", "[D]",
                 "P2 mech plant electrical / facility (dossier §6: 0.92 / 6.0 — chiller 0.738 + FWS 0.08 " +
                 "+ CDU 0.055 + CRAH 0.042). Re-derive per site with the cooling calculator"),
    mech_on_ups_frac: q(0.039, "frac", "[D]",
                        "share of IT that is UPS-backed mechanical — same input as the power calculator"),
    ups_loss_frac: q(0.024, "frac", "[D]",
                     "UPS losses added to the bank draw at the per-path test (dossier §6 P4: 0.13 / 5.4)"),
    rack_idle_frac_of_it: q(0.251, "frac", "[D]",
                            "P6 idle-booted racks / IT (dossier §6: 32 racks x 40.8 kW = 1.31 MW on 5.2 MW IT; " +
                            "rack idle is 30% of nameplate [S])"),
    support_it_frac_of_it: q(0.077, "frac", "[D]",
                             "P6 fabric + storage + mgmt / IT (dossier §6: 0.4 on 5.2 MW IT)"),
    scalable_units: q(null, "", "[A]",
                      "optional SU count — unlocks the P7 per-SU step ladder"),
    liquid_frac: q(0.87, "frac", "[S]",
                   "heat fraction leaving on the liquid loop (NVL72-class 87% [S]) — sets how much of the " +
                   "bank fleet must be LIQUID-side, not air"),
    genset_installed_mva: q(null, "MVA", "[A]",
                            "optional installed genset capacity for the P3 row — take it from " +
                            "the power calculator (F15 genset_units_installed x genset_unit_mva)"),
    cx_hours_low: q(150.0, "h", "[A]",
                    "low end of the P4+P5 test-window total (dossier §6 A8.16)"),
    cx_hours: q(200.0, "h", "[D]", "midpoint test-window total (dossier §6: 6.0 MW x 200 h = 1.2 GWh)"),
    cx_hours_high: q(250.0, "h", "[A]", "high end of the P4+P5 test-window total (dossier §6 A8.16)"),
    p_e_usd_kwh: q(0.0871, "US$/kWh", "[S]",
                   "energy rate: US industrial average 8.71 c/kWh (EIA) " +
                   "— REPLACE with the site's tariff"),
    p_d_usd_kva_month: q(null, "US$/kVA/mo", "[A]",
                         "optional demand rate — the commissioning peak can SET a 12-month ratchet before " +
                         "any revenue exists (research/10 §4.3)"),
    pf: q(0.98, "", "[A]", "billed power factor at the test peak"),
    accept_months_low: q(3.0, "months", "[A]",
                         "site-ready -> accepted, fast end (dossier §6/§8 A8.13: 3-4.5 months for a " +
                         "4-SU hall with an experienced integrator)"),
    accept_months_high: q(4.5, "months", "[A]", "site-ready -> accepted, slow end (same A8.13 band)"),
    accept_basis_su: q(4, "", "[A]",
                       "SU count the A8.13 band was observed at — the band does NOT scale linearly, " +
                       "IT lanes overlap facility Cx"),
  };

  // Site-only: the commissioning-level gate ladder (research/08 §3.1,
  // paraphrased industry taxonomy; tags are the industry tag colors).
  const CX_LEVELS = [
    ["L0", "Design & planning", "Cx team formed; design + single-point-of-failure reviews; FAT requirements agreed", "—"],
    ["L1", "Factory witness testing", "equipment tested at vendor works to approved procedures", "red tag"],
    ["L2", "Delivery, installation & pre-start", "receipt checks; static tests: pressure, pipework cleaning, rotation, megger, earthing", "yellow tag"],
    ["L3", "Start-up / pre-functional", "methodical first energization of each system; settings input + validated", "green tag"],
    ["L4", "Functional performance testing", "each system across operating modes INCLUDING failure scenarios; load testing", "blue tag"],
    ["L5", "Integrated systems test (IST)", "all systems together at design load via load banks; pull-the-plug scripts", "white tag"],
    ["L6", "Closeout / turnover", "handover docs, deep clean, settings verification, final Cx report", "—"],
  ];

  function ladder(kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];

    const it = Number(p.it_mw);
    const facility = it * Number(p.pue);

    const p0 = facility * Number(p.construction_frac);
    const p1 = facility * Number(p.house_frac);
    const p2 = facility * Number(p.mech_frac);
    const p4 = it * (1 + Number(p.mech_on_ups_frac)) * (1 + Number(p.ups_loss_frac));
    const p5 = facility;
    const p6_it = it * (Number(p.rack_idle_frac_of_it) + Number(p.support_it_frac_of_it));
    const p6 = p6_it + facility * Number(p.mech_frac);
    const p8 = facility;

    const pct = (x) => facility ? 100.0 * x / facility : null;

    const out = {
      facility_mw: q(facility, "MW", "[D]", "it_mw x pue — the 100% reference for every step"),
      p0_construction_mw: q(p0, "MW", "[A]", "facility_mw x construction_frac (temp service)"),
      p1_house_mw: q(p1, "MW", "[D]", "facility_mw x house_frac — controls/BMS live gates EVERYTHING"),
      p1_pct_of_facility: q(pct(p1), "%", "[D]", "p1_house_mw / facility_mw"),
      p2_mech_plant_mw: q(p2, "MW", "[D]", "facility_mw x mech_frac (chillers + FWS + CDU + CRAH at test load)"),
      p2_pct_of_facility: q(pct(p2), "%", "[D]", "p2_mech_plant_mw / facility_mw"),
      p3_genset_bank_mva: q(p.genset_installed_mva ? Number(p.genset_installed_mva) : null,
                            "MVA", "[D]",
                            "yard-bank capacity to exercise = installed genset MVA; facility draw unchanged"),
      p4_ups_bank_draw_mw: q(p4, "MW", "[D]",
                             "it_mw x (1 + mech_on_ups_frac) x (1 + ups_loss_frac) — ONE PATH at a time"),
      p4_pct_of_facility: q(pct(p4), "%", "[D]",
                            "p4_ups_bank_draw_mw / facility_mw — the ~92% surprise: near-full load, no GPUs"),
      p5_ist_mw: q(p5, "MW", "[D]", "whole facility at design load (pull-the-plug scripts, dossier §3.2)"),
      p5_pct_of_facility: q(100.0, "%", "[D]", "by definition"),
      p6_gpu_install_mw: q(p6, "MW", "[D]",
                           "it_mw x (rack_idle_frac_of_it + support_it_frac_of_it) + " +
                           "facility_mw x mech_frac — idle-booted racks + support IT + the " +
                           "mech plant carrying them (v3.1 CX-H1: the label said pro-rata " +
                           "mech, the code now includes it)"),
      p6_it_only_mw: q(p6_it, "MW", "[D]",
                       "the IT-side share of P6 alone: it_mw x (rack_idle_frac_of_it + " +
                       "support_it_frac_of_it)"),
      p6_pct_of_facility: q(pct(p6), "%", "[D]", "p6_gpu_install_mw / facility_mw"),
      p8_soak_mw: q(p8, "MW", "[D]", "acceptance soak at 100% — the ramp/EDPP witness window"),
      load_bank_total_mw: q(p4, "MW", "[D]",
                            "sized by the PER-PATH test (p4), not by average load (dossier §6 consequence 2)"),
      load_bank_liquid_mw: q(p4 * Number(p.liquid_frac), "MW", "[D]",
                             "load_bank_total_mw x liquid_frac — air-only banks CANNOT commission a DLC hall"),
      load_bank_air_mw: q(p4 * (1 - Number(p.liquid_frac)), "MW", "[D]",
                          "load_bank_total_mw x (1 - liquid_frac)"),
    };

    if (p.scalable_units) {
      const su = Math.trunc(p.scalable_units);
      const step = it / su;
      out.p7_su_step_mw = q(step, "MW-IT", "[D]", "it_mw / scalable_units — one controlled step per SU");
      out.p7_first_su_facility_mw = q(step * Number(p.pue), "MW", "[D]", "p7_su_step_mw x pue");
      out.p7_last_su_facility_mw = q(facility, "MW", "[D]", "all SUs live = facility_mw");
      out.p7_steps_n = q(su, "", "[D]", "one row/busway MOP set per step, no facility re-work");
    }

    // --- commissioning energy + what it costs -------------------------------
    const e_low = p4 * Number(p.cx_hours_low);
    const e_mid = p5 * Number(p.cx_hours);
    const e_high = p5 * Number(p.cx_hours_high);
    const rate = Number(p.p_e_usd_kwh);
    out.cx_energy_mwh_low = q(e_low, "MWh", "[D]", "p4_ups_bank_draw_mw x cx_hours_low");
    out.cx_energy_mwh_mid = q(e_mid, "MWh", "[D]", "p5_ist_mw x cx_hours (dossier midpoint)");
    out.cx_energy_mwh_high = q(e_high, "MWh", "[D]", "p5_ist_mw x cx_hours_high");
    out.cx_energy_cost_usd_low = q(e_low * 1000.0 * rate, "US$", "[D]", "cx_energy_mwh_low x 1000 x p_e_usd_kwh");
    out.cx_energy_cost_usd_mid = q(e_mid * 1000.0 * rate, "US$", "[D]", "cx_energy_mwh_mid x 1000 x p_e_usd_kwh");
    out.cx_energy_cost_usd_high = q(e_high * 1000.0 * rate, "US$", "[D]", "cx_energy_mwh_high x 1000 x p_e_usd_kwh");
    const peak_mva = p5 / Number(p.pf);
    out.cx_peak_mva = q(peak_mva, "MVA", "[D]", "p5_ist_mw / pf — the demand the meter sees during Cx");
    if (p.p_d_usd_kva_month !== null && p.p_d_usd_kva_month !== undefined) {
      const pd_ = Number(p.p_d_usd_kva_month);
      out.cx_demand_charge_usd_month = q(peak_mva * 1000.0 * pd_, "US$/mo", "[D]",
                                         "cx_peak_mva x 1000 x p_d_usd_kva_month");
      out.cx_ratchet_exposure_usd = q(peak_mva * 1000.0 * pd_ * 12.0, "US$", "[D]",
                                      "12 months of the Cx peak — the exposure IF the tariff ratchets " +
                                      "(research/10 §4.3); zero if it does not");
    }

    // --- site-ready -> accepted timeline band -------------------------------
    out.accept_months_low = q(Number(p.accept_months_low), "months", "[A]",
                              "P0 site-ready to P8 accepted, fast end (dossier §8 A8.13)");
    out.accept_months_high = q(Number(p.accept_months_high), "months", "[A]",
                               "P0 site-ready to P8 accepted, slow end (dossier §8 A8.13)");
    out.accept_weeks_high = q(Number(p.accept_months_high) * 4.345, "weeks", "[D]",
                              "accept_months_high x 4.345 — the schedule figure to hand a GC");

    const notes = [
      "cx_energy band mixes bases deliberately: LOW = p4 (UPS-bank draw, pre-IST " +
      "exit) x cx_hours_low, MID/HIGH = p5 (full IST load) x their hours — a " +
      "cheapest-credible vs full-load-anchor band, not a single-power sweep " +
      "(v3.1 CX-M1 documentation).",
      "The accept_months_* band is [A] and quoted for a " + Math.trunc(p.accept_basis_su) +
      "-SU hall with an experienced " +
      "integrator (dossier §8 A8.13). It is NOT scaled to this it_mw: facility Cx P1-P5 is " +
      "the critical path and the IT lanes overlap it, so a bigger hall lengthens P6-P8 far " +
      "less than proportionally. Re-baseline it against the integrator's own schedule.",
      "Full utility capacity must be live, metered and TARIFF-ACTIVE at P4/P5 — near-100% " +
      "load weeks before the first GPU boots. Utilities that stage capacity releases need " +
      "the load-bank schedule inside the interconnect agreement (dossier §6 consequence 1, A8.15).",
      "Load banks are the biggest temporary mobilisation and are sized by the per-path test " +
      "(load_bank_total_mw), not by average load. load_bank_liquid_mw of it must be liquid-side " +
      "(or server emulators): air-only heat load cannot prove CDU/TCS behaviour at design delta-T " +
      "[A8.10].",
      "cx_energy_* is a pro-forma line item, not a rounding error — bill it at the site tariff " +
      "in the model's construction period, before revenue [A8.16].",
      "Facility Cx P1-P5 is the critical path; the IT lanes overlap it, but GPU burn-in must not " +
      "start before P5 white tags unless the owner explicitly accepts commissioning risk on live " +
      "GPUs [A8.17].",
      "P7/P8 are when the transient story gets witnessed: EDPP excursions per rack and the site " +
      "ramp rate (power calculator with a GPU count, F16) are commissioning OBSERVABLES — breaker " +
      "margins and flicker at the PCC — and the record doubles as twin-calibration data.",
      "The ratios default to the reference 6.0 MW worked example. mech_frac in particular is " +
      "climate- and design-specific: re-derive it from the cooling calculator " +
      "(pue_l_cool_design_hour) before quoting P2 for a tropical site.",
    ];
    if (p.genset_installed_mva === null || p.genset_installed_mva === undefined) {
      notes.push("P3 row blank: enter genset_installed_mva (from the power calculator, F15) to size " +
                 "the yard load-bank campaign.");
    }
    if (p.p_d_usd_kva_month === null || p.p_d_usd_kva_month === undefined) {
      notes.push("Demand exposure not priced: enter p_d_usd_kva_month. It matters here because a " +
                 "commissioning peak can SET a ratchet that then bills for 12 months against a " +
                 "site with no revenue yet (research/10 §4.3).");
    }

    const inputs = {};
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (p[k] !== DEFAULTS[k].value)
        ? q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }
    for (const k of Object.keys(inputs)) {
      if (inputs[k].value === null || inputs[k].value === undefined) delete inputs[k];
    }

    return result(
      "commissioning — load-step ladder P0-P8, bank fleet, Cx energy",
      "research/08-deployment-commissioning.md §6 (load steps + consequences 1-5) · " +
      "reference power-budget ratios · " +
      "research/10-cooling-power.md §4.3 (demand/ratchet mechanics) · " +
      "the commissioning-runbook ladder as gates",
      inputs, out, notes);
  }

  // Site-only: turn a ladder() result into bars for the SVG load-step chart.
  function ladderSteps(res) {
    const o = res.outputs;
    const fac = o.facility_mw.value;
    const steps = [
      { id: "P1", name: "House energization", mw: o.p1_house_mw.value },
      { id: "P2", name: "Mechanical plant Cx", mw: o.p2_mech_plant_mw.value },
      { id: "P4", name: "UPS load-bank / path", mw: o.p4_ups_bank_draw_mw.value },
      { id: "P5", name: "IST — pull the plug", mw: o.p5_ist_mw.value },
      { id: "P6", name: "GPU install / provision", mw: o.p6_gpu_install_mw.value },
    ];
    if (o.p7_steps_n) {
      const n = o.p7_steps_n.value;
      for (let i = 1; i <= n; i++) {
        steps.push({ id: "P7." + i, name: "Burn-in SU " + i + "/" + n,
                     mw: o.p6_gpu_install_mw.value + (fac - o.p6_gpu_install_mw.value) * i / n });
      }
    }
    steps.push({ id: "P8", name: "Acceptance soak", mw: o.p8_soak_mw.value });
    for (const s of steps) s.frac = fac ? s.mw / fac : 0;
    return steps;
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcCx = { DEFAULTS: DEFAULTS, CX_LEVELS: CX_LEVELS,
                             ladder: ladder, ladderSteps: ladderSteps };
})();
