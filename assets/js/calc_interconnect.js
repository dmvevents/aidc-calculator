// Grid interconnection — utility/ISO queue + study timeline and network-upgrade cost. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_interconnect.py — interconnect() ported 1:1 (same names, inputs,
// outputs, output key order, notes). STUDY SCALE composes over the power core
// (A.calcPower.sizing(...).facility_mw for the same scenario — it_mw x pue, the facility real-power
// load at the utility point of interconnection). METHOD: the standard large-interconnection study
// sequence (FERC Order 2003 LGIP / Order 2023 cluster study, load-side analogue) — queue wait ->
// feasibility -> system impact study (SIS) -> facilities study -> interconnection agreement. The
// load-bearing critical-path identity and the size-driven study tier:
//   study_process_weeks      = feasibility + system_impact_study + facilities + interconnection_agreement
//   total_interconnect_weeks = queue_wait + study_process_weeks
// The SIS term carries the tier escalator, which only BINDS once the composed interconnection MW
// crosses a threshold, so the composition is load-bearing at a NON-default scenario. Pure schedule +
// money arithmetic (no calendar dates), so a run byte-matches the python core.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    queue_wait_weeks: q(26.0, "weeks", "[A]",
                        "queue-position wait from a valid interconnection request to the start " +
                        "of the feasibility study — a sequential first phase; planning band " +
                        "~3-9 months (set from your utility/ISO queue backlog)"),
    feasibility_study_weeks: q(8.0, "weeks", "[A]",
                              "feasibility study (initial screen of the point of " +
                              "interconnection) — a sequential phase; planning band ~4-12 " +
                              "weeks (FERC LGIP feasibility-study window)"),
    system_impact_study_base_weeks: q(16.0, "weeks", "[A]",
                                     "baseline system impact study (SIS) duration at tier 0 " +
                                     "(distribution-level minimal study); planning band ~10-20 " +
                                     "weeks (FERC LGIP SIS window)"),
    system_impact_study_tier_step_weeks: q(12.0, "weeks", "[A]",
                                          "SIS weeks ADDED per study tier — a transmission-level " +
                                          "study adds one step, a large-load cluster study adds " +
                                          "two; planning band ~8-24 weeks per escalation"),
    facilities_study_weeks: q(12.0, "weeks", "[A]",
                             "facilities study (detailed design + cost of the interconnection " +
                             "facilities and network upgrades) after the SIS — a sequential " +
                             "phase; planning band ~8-16 weeks"),
    interconnection_agreement_weeks: q(20.0, "weeks", "[A]",
                                      "interconnection agreement negotiation + execution to " +
                                      "construction start — the sequential final phase before " +
                                      "upgrades are built; planning band ~12-30 weeks"),
    study_tier_1_mw: q(20.0, "MW", "[A]",
                      "interconnection-MW threshold that escalates the study from a " +
                      "distribution-level minimal study to a transmission-level system impact " +
                      "study (tier 0 -> 1) — a planning band for the distribution -> " +
                      "sub-transmission breakpoint (~10-30 MW; set from your utility/ISO tariff)"),
    study_tier_2_mw: q(100.0, "MW", "[A]",
                      "interconnection-MW threshold that escalates the study to a large-load " +
                      "cluster study with broad network upgrades (tier 1 -> 2) — a planning " +
                      "band for the transmission-level breakpoint (~50-150 MW; set from your " +
                      "utility/ISO tariff)"),
    network_upgrade_base_usd_per_kw: q(50.0, "US$/kW", "[A]",
                                      "baseline network-upgrade cost per interconnected kW at " +
                                      "tier 0 (distribution-level ties) — a planning band " +
                                      "~$25-100/kW (set from your utility/ISO cost allocation)"),
    network_upgrade_tier_step_usd_per_kw: q(75.0, "US$/kW", "[A]",
                                           "network-upgrade $/kW ADDED per study tier — a " +
                                           "transmission-level tie adds one step, a large-load " +
                                           "cluster upgrade two; planning band ~$50-150/kW per " +
                                           "escalation"),
    schedule_contingency_frac: q(0.30, "frac", "[A]",
                                "contingency added to the base timeline for restudies, cluster " +
                                "re-shuffles and negotiation delay to give the high end of the " +
                                "planning band; assumption ~0.20-0.50"),
  };

  const MONTHS_PER_YEAR = 12.0;  // [S] exact
  const WEEKS_PER_YEAR = 52.0;   // [S] exact (planning convention; 52 weeks/yr)

  function interconnect(kw) {
    kw = kw || {};
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    // STUDY SCALE composes over the power core (do NOT hardcode interconnection MW) — call
    // calc_power and read facility_mw (it_mw x pue) for the scenario.
    const power = globalThis.AIDC.calcPower.sizing(itGiven ? { it_mw: kw.it_mw } : {});
    const interconnectionMw = power.outputs.facility_mw.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      queue_wait_weeks: kw.queue_wait_weeks,
      feasibility_study_weeks: kw.feasibility_study_weeks,
      system_impact_study_base_weeks: kw.system_impact_study_base_weeks,
      system_impact_study_tier_step_weeks: kw.system_impact_study_tier_step_weeks,
      facilities_study_weeks: kw.facilities_study_weeks,
      interconnection_agreement_weeks: kw.interconnection_agreement_weeks,
      study_tier_1_mw: kw.study_tier_1_mw,
      study_tier_2_mw: kw.study_tier_2_mw,
      network_upgrade_base_usd_per_kw: kw.network_upgrade_base_usd_per_kw,
      network_upgrade_tier_step_usd_per_kw: kw.network_upgrade_tier_step_usd_per_kw,
      schedule_contingency_frac: kw.schedule_contingency_frac,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const queueWait = Number(p.queue_wait_weeks);
    const feasibility = Number(p.feasibility_study_weeks);
    const sisBase = Number(p.system_impact_study_base_weeks);
    const sisStep = Number(p.system_impact_study_tier_step_weeks);
    const facilities = Number(p.facilities_study_weeks);
    const ia = Number(p.interconnection_agreement_weeks);
    const tier1Mw = Number(p.study_tier_1_mw);
    const tier2Mw = Number(p.study_tier_2_mw);
    const upgradeBase = Number(p.network_upgrade_base_usd_per_kw);
    const upgradeStep = Number(p.network_upgrade_tier_step_usd_per_kw);
    const contingency = Number(p.schedule_contingency_frac);
    if (queueWait < 0.0) throw new Error("queue_wait_weeks must be >= 0");
    if (feasibility < 0.0) throw new Error("feasibility_study_weeks must be >= 0");
    if (sisBase < 0.0) throw new Error("system_impact_study_base_weeks must be >= 0");
    if (sisStep < 0.0) throw new Error("system_impact_study_tier_step_weeks must be >= 0");
    if (facilities < 0.0) throw new Error("facilities_study_weeks must be >= 0");
    if (ia < 0.0) throw new Error("interconnection_agreement_weeks must be >= 0");
    if (tier1Mw <= 0.0) throw new Error("study_tier_1_mw must be > 0");
    if (tier2Mw <= 0.0) throw new Error("study_tier_2_mw must be > 0");
    if (tier2Mw < tier1Mw) throw new Error("study_tier_2_mw must be >= study_tier_1_mw");
    if (upgradeBase < 0.0) throw new Error("network_upgrade_base_usd_per_kw must be >= 0");
    if (upgradeStep < 0.0) throw new Error("network_upgrade_tier_step_usd_per_kw must be >= 0");
    if (contingency < 0.0) throw new Error("schedule_contingency_frac must be >= 0");

    // ---- study tier: a three-band step on the interconnection MW --------------------
    //   tier 0 below the tier-1 threshold (distribution-level minimal study), tier 1
    //   at/above it (transmission-level SIS), tier 2 at/above the tier-2 threshold
    //   (large-load cluster study). The tier composes LIVE over the power core, so a
    //   larger project crosses a threshold and adds SIS weeks and network-upgrade cost.
    let studyTier;
    if (interconnectionMw >= tier2Mw) studyTier = 2.0;
    else if (interconnectionMw >= tier1Mw) studyTier = 1.0;
    else studyTier = 0.0;

    // ---- the load-bearing critical-path identity ------------------------------------
    //   the four study phases run SEQUENTIALLY after the queue wait; the SIS carries the
    //   tier escalator. total = queue_wait + (feasibility + SIS(tier) + facilities + IA).
    //   Drop a term, or hardcode the interconnection MW (pinning the tier at 0), and the
    //   golden total pin (or the varying-scenario row) moves.
    const systemImpactStudyWeeks = sisBase + sisStep * studyTier;
    const studyProcessWeeks = feasibility + systemImpactStudyWeeks + facilities + ia;
    const totalInterconnectWeeks = queueWait + studyProcessWeeks;

    // ---- band conversions: months, and a contingency high end -----------------------
    const totalInterconnectMonths = totalInterconnectWeeks * MONTHS_PER_YEAR / WEEKS_PER_YEAR;
    const totalInterconnectWeeksHigh = totalInterconnectWeeks * (1.0 + contingency);

    // ---- network-upgrade cost: $/kW steps on the tier, over the interconnection MW ---
    const networkUpgradeCostPerKw = upgradeBase + upgradeStep * studyTier;
    const networkUpgradeCostM = interconnectionMw * 1000.0 * networkUpgradeCostPerKw / 1.0e6;

    const out = {
      interconnection_mw: q(interconnectionMw, "MW", "[D]",
                            "calc_power facility_mw (it_mw x pue) — the facility real-power " +
                            "load presented at the utility point of interconnection, composed " +
                            "live over the power core (the [D] facility load at the [A] " +
                            "project scale) — drives the study tier"),
      study_tier: q(studyTier, "tier", "[D]",
                    "0 below the tier-1 threshold (distribution-level minimal study), 1 " +
                    "at/above it (transmission-level system impact study), 2 at/above the " +
                    "tier-2 threshold (large-load cluster study) — stepped on the [D] composed " +
                    "interconnection MW vs the [A] MW thresholds"),
      system_impact_study_weeks: q(systemImpactStudyWeeks, "weeks", "[D]",
                                   "system_impact_study_base_weeks + " +
                                   "system_impact_study_tier_step_weeks x study_tier — the SIS " +
                                   "duration; composed live over the power core (a larger " +
                                   "project bumps the tier), rests on the [A] base and " +
                                   "per-tier-step study durations"),
      study_process_weeks: q(studyProcessWeeks, "weeks", "[D]",
                             "feasibility_study_weeks + system_impact_study_weeks + " +
                             "facilities_study_weeks + interconnection_agreement_weeks — the " +
                             "sequential study process after the queue wait; rests on the [A] " +
                             "phase durations over the composed tier"),
      total_interconnect_weeks: q(totalInterconnectWeeks, "weeks", "[D]",
                                  "queue_wait_weeks + study_process_weeks — the end-to-end " +
                                  "interconnection critical path; the load-bearing " +
                                  "sum-of-queue-plus-sequential-studies identity, composed live " +
                                  "over the power core through the study tier, rests on the [A] " +
                                  "phase durations over the composed scale"),
      total_interconnect_months: q(totalInterconnectMonths, "months", "[D]",
                                   "total_interconnect_weeks x 12 / 52 — the timeline in months " +
                                   "(52-week-year [S] planning convention); rests on the [A] " +
                                   "phase durations"),
      total_interconnect_weeks_high: q(totalInterconnectWeeksHigh, "weeks", "[D]",
                                       "total_interconnect_weeks x (1 + schedule_contingency_frac) " +
                                       "— the high end of the planning band with contingency for " +
                                       "restudies, cluster re-shuffles and negotiation delay; " +
                                       "rests on the [A] contingency fraction over the base " +
                                       "timeline"),
      network_upgrade_cost_per_kw: q(networkUpgradeCostPerKw, "US$/kW", "[D]",
                                     "network_upgrade_base_usd_per_kw + " +
                                     "network_upgrade_tier_step_usd_per_kw x study_tier — the " +
                                     "effective network-upgrade unit cost; steps on the [D] " +
                                     "composed study tier, rests on the [A] base and per-tier " +
                                     "$/kW"),
      network_upgrade_cost_m: q(networkUpgradeCostM, "US$M", "[D]",
                                "interconnection_mw x 1000 x network_upgrade_cost_per_kw / 1e6 " +
                                "— the network-upgrade cost band; composed live over the power " +
                                "core through BOTH the interconnection MW and the study tier, " +
                                "rests on the [A] $/kW planning band"),
    };

    const notes = [
      "METHOD — the standard large-interconnection study sequence (FERC Order No. 2003 LGIP, " +
      "carried into the Order No. 2023 cluster-study reform; a utility/ISO large-LOAD " +
      "interconnection process is the load-side analogue): queue-position wait -> feasibility " +
      "study -> system impact study (SIS) -> facilities study -> interconnection agreement / " +
      "construction start. The study tier escalates with the interconnection MW: SIS weeks = " +
      "base + step x tier and network-upgrade $/kW = base + step x tier, tier stepped on the " +
      "interconnection MW vs the tier-1 / tier-2 thresholds.",
      "SIGN CONVENTION — total_interconnect_weeks = queue_wait + (feasibility + " +
      "system_impact_study + facilities + interconnection_agreement), a pure SUM of the queue " +
      "wait plus the four sequential study phases (drop or mis-weight one and the total pin " +
      "moves). The system-impact-study term carries the tier escalator, so it is the summand " +
      "that composes live over the power core: at a small scenario the study is tier 0 (SIS = " +
      "base) and the total does not move with scale; once the interconnection MW crosses the " +
      "tier-1 threshold the SIS weeks (and the total) step up — which is why the composition is " +
      "proven at a NON-default scenario. Hardcode the interconnection MW (pin the tier at 0) and " +
      "the varying-scenario rows for total_interconnect_weeks AND network_upgrade_cost_m fail, " +
      "while every default row still passes.",
      "STUDY SCALE composes over the power core: the interconnection MW is calc_power.sizing(...) " +
      "facility_mw for the same scenario (it_mw x pue — the facility real-power load at the " +
      "utility point of interconnection), so a change in the project scale flows straight into " +
      "the study tier, the SIS weeks, the whole timeline and the network-upgrade cost — nothing " +
      "about the scale is hardcoded here.",
      "PROVENANCE — [A] phase durations (queue wait 26, feasibility 8, SIS base 16 + 12/tier, " +
      "facilities 12, interconnection agreement 20 weeks), [A] tier thresholds (20 / 100 MW " +
      "interconnection), [A] network-upgrade $/kW (50 base + 75/tier), [A] contingency 0.30 — " +
      "planning assumptions, override from your utility/ISO tariff's published study timelines " +
      "and cost allocation. The interconnection MW is [D] composed over calc_power; outputs are " +
      "[D] derived; every output names its [S]/[A] basis in its source.",
      "DETERMINISTIC: pure schedule + money arithmetic over the composed interconnection MW and " +
      "the phase-duration / cost assumptions — no wall clock, no calendar dates, no randomness — " +
      "so a double run is byte-identical and the JS port matches to the week / the dollar. " +
      "DISTINCT from calc_schedule (the physical build/commission lifecycle CPM producing " +
      "energize/gpus-live dates) and calc_entitlements (the land-use approval clock); this is " +
      "the grid-connection clock + cost, a size-driven weeks-and-dollars band on the " +
      "ELECTRICAL interconnection MW.",
      "Scope: a single-snapshot planning ROM, not a utility/ISO-specific interconnection schedule " +
      "or a facilities-study cost estimate. Phase durations are planning-band assumptions, the " +
      "study tier is a three-band step on the interconnection MW (NOT a queue-cluster position " +
      "or a study-deposit schedule), the network-upgrade cost is a $/kW band stepped on the tier " +
      "(NOT a facilities-study cost estimate), and restudies / cluster re-shuffles fold into one " +
      "contingency fraction. No queue-cluster window alignment, deposit / study-cost schedule, " +
      "affected-system study, or transmission-service / capacity-market interplay.",
    ];

    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcPower.DEFAULTS.it_mw.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to calc_power for the interconnection MW " +
               "(facility_mw = it_mw x pue)"),
    };
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "interconnect — grid interconnection queue / study timeline + network-upgrade cost bands",
      "study scale composed over calc_power.sizing (facility_mw = it_mw x pue -> interconnection " +
      "MW -> study tier); total = queue_wait + (feasibility + system_impact_study + facilities + " +
      "interconnection_agreement); network_upgrade_cost_m = interconnection_mw x 1000 x " +
      "(base + step x tier) / 1e6 (pure schedule + money math, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcInterconnect = { DEFAULTS: DEFAULTS, interconnect: interconnect };
})();
