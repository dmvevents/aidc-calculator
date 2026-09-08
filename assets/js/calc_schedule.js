// Critical-path schedule: stage-gate ladder + long-lead register -> energize
// and GPUs-live dates. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_schedule.py — schedule() ported 1:1 (same names,
// inputs, outputs, output key order, notes count). An 8-stage lifecycle ladder
// (concept -> ... -> operate) run as a CPM forward pass against a 50-item
// long-lead register: each item is ordered at one stage and must ARRIVE before a
// later stage can start, so the long pole PUSHES the milestone. ENERGIZE =
// finish of commission (gated by the electrical long-leads), GPUS LIVE = finish
// of operate (gated by the GPU-rack lead). Dates are the NTP epoch + the
// critical-path weeks (UTC date math, never Date.now()), so a run is
// reproducible to the day and byte-matches the python core.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const NTP_DEFAULT = "2026-09-01"; // [A] Notice-to-Proceed epoch — fixed input, never the wall clock
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  // Stage-gate ladder: [key, baseline_weeks, label, source]. Sequential
  // baseline; the CPM pass lets long-lead arrivals push a stage's start.
  const STAGES = [
    ["concept", 8, "[A]", "feasibility + siting study"],
    ["site", 16, "[A]", "land control, geotech, initial permits"],
    ["utility", 26, "[A]", "interconnect application -> utility study -> will-serve (often the long pole)"],
    ["design", 20, "[A]", "SD/DD/CD to IFC drawings"],
    ["procure", 6, "[A]", "PO placement window — long-leads are ordered here"],
    ["build", 40, "[A]", "civil, structural, MEP rough-in and fit-out"],
    ["commission", 12, "[A]", "L1-L5 + IST electrical/mechanical Cx -> ENERGIZE (research/08 §6)"],
    ["operate", 6, "[A]", "GPU install, burn-in and go-live -> GPUS LIVE"],
  ];
  const STAGE_INDEX = {};
  STAGES.forEach(([k], i) => { STAGE_INDEX[k] = i; });

  // Long-lead register (top items). Each row: [key, category, lead_weeks,
  // order_gate, gates_stage, source]. order_gate is always earlier than
  // gates_stage; the item must ARRIVE before its gated stage can start.
  const _S = "[A]"; // every lead time is an OEM-quote planning band (2024-2026 supply market)
  const LONG_LEAD = [
    // electrical: gate `commission` (energize)
    ["main_transformer", "transformers", 60, "procure", "commission", _S],
    ["mv_switchgear", "MV switchgear", 50, "procure", "commission", _S],
    ["lv_switchgear", "LV switchgear", 40, "procure", "commission", _S],
    ["generators", "gensets", 52, "procure", "commission", _S],
    ["genset_paralleling_gear", "switchgear", 46, "procure", "commission", _S],
    ["ups_modules", "UPS", 34, "procure", "commission", _S],
    ["ups_batteries", "UPS+battery", 30, "procure", "commission", _S],
    ["ats_transfer_switches", "ATS", 28, "procure", "commission", _S],
    ["pdus", "PDUs", 24, "procure", "commission", _S],
    ["busway", "busway", 26, "procure", "commission", _S],
    ["dry_type_transformers", "transformers", 30, "procure", "commission", _S],
    ["surge_protection", "electrical", 16, "procure", "commission", _S],
    ["utility_metering", "electrical", 20, "procure", "commission", _S],
    ["medium_voltage_cable", "cable", 22, "procure", "commission", _S],
    ["grounding_system", "electrical", 12, "procure", "commission", _S],
    // mechanical / cooling: gate `commission` (energize)
    ["chillers", "chillers", 48, "procure", "commission", _S],
    ["crah_units", "CRAH", 30, "procure", "commission", _S],
    ["cdus", "cooling", 36, "procure", "commission", _S],
    ["cooling_towers", "cooling towers", 40, "procure", "commission", _S],
    ["dry_coolers", "cooling", 34, "procure", "commission", _S],
    ["pumps_primary", "cooling", 24, "procure", "commission", _S],
    ["pumps_secondary", "cooling", 22, "procure", "commission", _S],
    ["bms_controls", "controls", 26, "procure", "commission", _S],
    ["leak_detection", "controls", 12, "procure", "commission", _S],
    ["water_treatment_skid", "water", 22, "procure", "commission", _S],
    ["tes_tank", "water", 28, "procure", "commission", _S],
    ["fuel_day_tanks", "gensets", 24, "procure", "commission", _S],
    ["pipe_spool_fab", "cooling", 18, "procure", "commission", _S],
    ["valves_actuators", "cooling", 20, "procure", "commission", _S],
    ["makeup_water_storage", "water", 20, "procure", "commission", _S],
    // structural / building envelope: gate `build`
    ["structural_steel", "structural steel", 24, "design", "build", _S],
    ["precast_concrete", "structural", 20, "design", "build", _S],
    ["roofing_system", "building", 16, "procure", "build", _S],
    ["curtain_wall", "building", 18, "procure", "build", _S],
    ["overhead_doors", "building", 12, "procure", "build", _S],
    ["access_flooring", "building", 14, "procure", "build", _S],
    ["containment_system", "cooling", 12, "procure", "commission", _S],
    ["fire_suppression", "life safety", 20, "procure", "commission", _S],
    // network / fabric: gate `commission`
    ["network_spine_switches", "network", 24, "procure", "commission", _S],
    ["network_leaf_switches", "network", 20, "procure", "commission", _S],
    ["optical_transceivers", "optics", 26, "procure", "commission", _S],
    ["dci_routers", "network", 18, "procure", "commission", _S],
    ["fiber_trunk_cabling", "network", 16, "procure", "commission", _S],
    ["management_switches", "network", 14, "procure", "commission", _S],
    ["structured_cabling", "network", 12, "procure", "commission", _S],
    // compute / IT: gate `operate` (GPUs live)
    ["gpu_racks", "GPU racks", 40, "build", "operate", _S],
    ["gpu_servers", "GPU servers", 30, "build", "operate", _S],
    ["storage_arrays", "IT storage", 22, "build", "operate", _S],
    ["rack_pdus_intelligent", "PDUs", 18, "build", "operate", _S],
    ["nvlink_cabling", "GPU racks", 12, "build", "operate", _S],
  ];

  const DEFAULTS = {
    ntp_date: q(NTP_DEFAULT, "date", "[A]",
                "Notice-to-Proceed epoch (project week 0) — fixed input; the " +
                "milestone dates are NTP + critical-path weeks, never the wall clock"),
    it_mw: q(5.2, "MW-IT", "[A]",
             "project scale for context — the critical path here is lead-time bound " +
             "and size-independent at this planning altitude (see notes)"),
  };

  // Parse ISO YYYY-MM-DD to a UTC epoch (ms), validating like python's date().
  function parseNtp(s) {
    const parts = String(s).split("-");
    const y = Number(parts[0]), mo = Number(parts[1]), da = Number(parts[2]);
    const bad = parts.length !== 3 ||
      !Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(da);
    if (bad) throw new Error("ntp_date must be ISO YYYY-MM-DD, got " + JSON.stringify(s));
    const ms = Date.UTC(y, mo - 1, da);
    const d = new Date(ms);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
      throw new Error("ntp_date must be ISO YYYY-MM-DD, got " + JSON.stringify(s));
    }
    return ms;
  }

  function isoDate(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + mo + "-" + da;
  }

  function schedule(kw) {
    kw = kw || {};
    const leadWeeks = kw.lead_weeks || {};
    const stageWeeks = kw.stage_weeks || {};
    const ntpGiven = kw.ntp_date !== null && kw.ntp_date !== undefined;
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    const ntpMs = parseNtp(ntpGiven ? kw.ntp_date : NTP_DEFAULT);
    const it = itGiven ? Number(kw.it_mw) : DEFAULTS.it_mw.value;
    if (!(it > 0)) throw new Error("it_mw must be > 0");

    const leadKeys = new Set(LONG_LEAD.map((r) => r[0]));
    const dur = {};
    for (const [k, w] of STAGES) dur[k] = Math.trunc(k in stageWeeks ? stageWeeks[k] : w);
    for (const k in stageWeeks) if (!(k in STAGE_INDEX)) throw new Error("unknown stage " + JSON.stringify(k));
    for (const k in leadWeeks) if (!leadKeys.has(k)) throw new Error("unknown long-lead item " + JSON.stringify(k));

    const leadOf = {};
    for (const [key, , base] of LONG_LEAD) leadOf[key] = Math.trunc(key in leadWeeks ? leadWeeks[key] : base);

    const gating = {}; // stage -> [[key, order_gate], ...]
    for (const [key, , , orderGate, gatesStage] of LONG_LEAD) {
      (gating[gatesStage] = gating[gatesStage] || []).push([key, orderGate]);
    }

    const finish = {};
    const binding = {}; // stage -> item key that set its start (or null)
    let prev = 0;
    for (const [k] of STAGES) {
      let start = prev, who = null;
      for (const [key, orderGate] of (gating[k] || [])) {
        const arrival = finish[orderGate] + leadOf[key]; // order_gate finishes earlier
        if (arrival > start) { start = arrival; who = key; }
      }
      finish[k] = start + dur[k];
      binding[k] = who;
      prev = finish[k];
    }

    let baseline = 0;
    for (const k in dur) baseline += dur[k];
    const energizeWk = finish.commission;
    const gpusLiveWk = finish.operate;

    function traceCritical(stage) {
      let k = stage;
      while (k !== null && k !== undefined) {
        if (binding[k] !== null) return binding[k];
        const idx = STAGE_INDEX[k];
        k = idx > 0 ? STAGES[idx - 1][0] : null;
      }
      return null;
    }

    const energizeItem = traceCritical("commission");
    const gpusLiveItem = traceCritical("operate");
    let onCp = 0;
    for (const k in binding) if (binding[k] !== null) onCp += 1;

    const dt = (weeks) => isoDate(ntpMs + Math.trunc(weeks) * MS_PER_WEEK);
    const ntpIso = isoDate(ntpMs);

    const out = {};
    for (const [k, , , src] of STAGES) {
      out["stage_" + k + "_finish_wk"] = q(finish[k], "wk", "[D]",
        "CPM finish of `" + k + "` (" + src + ")");
    }
    out.baseline_weeks = q(baseline, "wk", "[D]",
      "sum of the 8 stage durations — the un-gated sequential floor");
    out.energize_weeks = q(energizeWk, "wk", "[D]",
      "finish of `commission` — facility power available (gated by the electrical long-leads)");
    out.energize_date = q(dt(energizeWk), "date", "[D]", "ntp_date + energize_weeks (ISO)");
    out.energize_critical_item = q(energizeItem, "", "[D]",
      "the long-lead binding `commission` (transformers/switchgear/gensets class)");
    out.gpus_live_weeks = q(gpusLiveWk, "wk", "[D]",
      "finish of `operate` — compute operational (energize + GPU-rack lead overhang + install + Cx)");
    out.gpus_live_date = q(dt(gpusLiveWk), "date", "[D]",
      "ntp_date + gpus_live_weeks (ISO) — the headline delivery date");
    out.gpus_live_critical_item = q(gpusLiveItem, "", "[D]",
      "the long-lead on the critical path to GPUs-live — remove its gating edge and this date moves earlier");
    out.long_lead_count = q(LONG_LEAD.length, "", "[D]", "items in the long-lead register");
    out.long_lead_on_critical_path = q(onCp, "", "[D]",
      "count of stages whose start a long-lead arrival set");

    const notes = [
      "PLANNING-BAND critical path, not a construction schedule: lead times are an " +
      "OEM-quote band for the 2024-2026 supply market [A] and stage durations are a " +
      "greenfield planning band [A] (research/08 §6 for the Cx ladder) — a specific " +
      "project re-quotes both and re-runs this.",
      "Lead-time bound and therefore SIZE-INDEPENDENT at this altitude: the critical " +
      "path runs through equipment manufacturing lead (here `" + gpusLiveItem + "` for " +
      "GPUs-live, `" + energizeItem + "` for energize), not through IT_MW — a 5 MW and a " +
      "50 MW greenfield face the same transformer/genset/GPU lead. it_mw (" +
      fmtG(it) + " MW) is carried for context only.",
      "DETERMINISTIC dates: every date is ntp_date (" + ntpIso + ") + the critical-path " +
      "weeks via date+timedelta, formatted ISO — no wall clock, so a double run and the " +
      "JS port agree to the day.",
      "The register holds " + LONG_LEAD.length + " long-lead items across the named " +
      "categories (gensets, MV/LV switchgear, transformers, chillers/CRAH, GPU " +
      "racks/servers, UPS+battery, cooling towers, ATS, PDUs/busway, structural steel, " +
      "network optics, ...). Items are ordered at `procure` (most) or `build` (compute) " +
      "and gate `build`, `commission` or `operate`.",
      "Excluded: weather/float contingency, permitting appeals, utility queue position " +
      "beyond the study window, phased energization, and any owner-caused delay — a real " +
      "schedule carries a risk register and a P50/P80 band on top of this deterministic spine.",
    ];

    const inputs = {
      ntp_date: q(ntpIso, "date", ntpGiven ? "[S]" : "[A]", "project week-0 epoch"),
      it_mw: q(it, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale (context only — schedule is lead-time bound)"),
    };

    return result(
      "schedule — stage-gate ladder + long-lead register to energize and GPUs-live",
      "8-stage CPM forward pass (concept->operate) against a " + LONG_LEAD.length +
      "-item long-lead register; milestone dates = ntp_date + critical-path weeks " +
      "(research/08 §6 Cx ladder; lead times an OEM-quote planning band)",
      inputs, out, notes);
  }

  // Match python's "%g" for the it_mw note (5.2 -> "5.2", 12.0 -> "12").
  function fmtG(x) {
    if (Number.isInteger(x)) return String(x);
    return String(Number(x.toPrecision(6)));
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcSchedule = { NTP_DEFAULT: NTP_DEFAULT, STAGES: STAGES,
                                   LONG_LEAD: LONG_LEAD, DEFAULTS: DEFAULTS,
                                   schedule: schedule };
})();
