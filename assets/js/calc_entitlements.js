// Entitlements / permitting timeline — land-use approval sub-domain. PURE, DETERMINISTIC (no wall clock).
// parity: cli/aidc/core/calc_entitlements.py — entitlements() ported 1:1 (same names, inputs,
// outputs, output key order, notes). REVIEW SCALE composes over the land core
// (A.calcLand.footprint(...).parcel_m2 for the same scenario — the disturbed graded parcel).
// METHOD: the standard US entitlement sequence — pre-application -> discretionary rezoning ->
// environmental review (NEPA/EA/EIS) -> site-plan approval -> permit issuance. The load-bearing
// critical-path identity and the size-driven environmental tier:
//   parallel_review_weeks   = max(rezoning_weeks, environmental_review_weeks)
//   total_entitlement_weeks = (pre_application + site_plan + permit) + parallel_review_weeks
// The environmental track only BINDS the max once the composed disturbed acreage crosses a
// threshold, so the composition is load-bearing at a NON-default scenario. Pure weeks arithmetic
// (no calendar dates), so a run byte-matches the python core.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const DEFAULTS = {
    pre_application_weeks: q(8.0, "weeks", "[A]",
                            "pre-application / conceptual review with planning staff before a " +
                            "formal filing — a sequential first phase; planning band ~4-12 " +
                            "weeks (set from your municipality's intake practice)"),
    rezoning_weeks: q(26.0, "weeks", "[A]",
                      "discretionary rezoning / PUD / special-use-permit track (staff review, " +
                      "planning-commission and governing-body hearings, public notice) — the " +
                      "legislative approval pole; planning band ~4-9 months"),
    environmental_review_base_weeks: q(6.0, "weeks", "[A]",
                                      "baseline environmental-review duration at tier 0 " +
                                      "(categorical-exclusion-class minimal review); planning " +
                                      "band ~4-8 weeks (NEPA / state SEQRA-CEQA equivalent)"),
    environmental_review_tier_step_weeks: q(24.0, "weeks", "[A]",
                                           "review weeks ADDED per environmental tier — an " +
                                           "Environmental Assessment adds one step, a full " +
                                           "Environmental Impact Statement adds two; planning " +
                                           "band ~12-36 weeks per escalation"),
    ea_threshold_acres: q(1.0, "acres", "[S]",
                         "disturbed-area threshold that escalates review from minimal to an " +
                         "Environmental Assessment (tier 0 -> 1) — the EPA Construction General " +
                         "Permit (CWA sec 402 NPDES) 1-acre land-disturbance trigger"),
    eis_threshold_acres: q(10.0, "acres", "[A]",
                          "disturbed-area threshold that escalates review to a full " +
                          "Environmental Impact Statement (tier 1 -> 2) — a planning band for " +
                          "elevated review (~5-20 acres; set from your jurisdiction)"),
    site_plan_approval_weeks: q(12.0, "weeks", "[A]",
                               "administrative site-plan / subdivision approval after the " +
                               "discretionary and environmental tracks close — a sequential " +
                               "phase; planning band ~8-16 weeks"),
    permit_issuance_weeks: q(6.0, "weeks", "[A]",
                            "building-permit plan check and issuance — the sequential final " +
                            "phase before construction can start; planning band ~4-10 weeks"),
    schedule_contingency_frac: q(0.25, "frac", "[A]",
                                "contingency added to the base timeline for re-submittals, " +
                                "hearing continuances and appeals to give the high end of the " +
                                "planning band; assumption ~0.15-0.40"),
  };

  const MONTHS_PER_YEAR = 12.0;  // [S] exact
  const WEEKS_PER_YEAR = 52.0;   // [S] exact (planning convention; 52 weeks/yr)

  function entitlements(kw) {
    kw = kw || {};
    const itGiven = kw.it_mw !== null && kw.it_mw !== undefined;
    // REVIEW SCALE composes over the land core (do NOT hardcode disturbed area) — call
    // calc_land and read the graded parcel (the disturbed land) for the scenario.
    const land = globalThis.AIDC.calcLand.footprint(itGiven ? { it_mw: kw.it_mw } : {});
    const parcelM2 = land.outputs.parcel_m2.value;

    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    const lay = {
      pre_application_weeks: kw.pre_application_weeks,
      rezoning_weeks: kw.rezoning_weeks,
      environmental_review_base_weeks: kw.environmental_review_base_weeks,
      environmental_review_tier_step_weeks: kw.environmental_review_tier_step_weeks,
      ea_threshold_acres: kw.ea_threshold_acres,
      eis_threshold_acres: kw.eis_threshold_acres,
      site_plan_approval_weeks: kw.site_plan_approval_weeks,
      permit_issuance_weeks: kw.permit_issuance_weeks,
      schedule_contingency_frac: kw.schedule_contingency_frac,
    };
    for (const k of Object.keys(lay)) if (lay[k] !== null && lay[k] !== undefined) p[k] = lay[k];

    const preApp = Number(p.pre_application_weeks);
    const rezoning = Number(p.rezoning_weeks);
    const envBase = Number(p.environmental_review_base_weeks);
    const envStep = Number(p.environmental_review_tier_step_weeks);
    const eaThresh = Number(p.ea_threshold_acres);
    const eisThresh = Number(p.eis_threshold_acres);
    const sitePlan = Number(p.site_plan_approval_weeks);
    const permit = Number(p.permit_issuance_weeks);
    const contingency = Number(p.schedule_contingency_frac);
    if (preApp < 0.0) throw new Error("pre_application_weeks must be >= 0");
    if (rezoning < 0.0) throw new Error("rezoning_weeks must be >= 0");
    if (envBase < 0.0) throw new Error("environmental_review_base_weeks must be >= 0");
    if (envStep < 0.0) throw new Error("environmental_review_tier_step_weeks must be >= 0");
    if (eaThresh <= 0.0) throw new Error("ea_threshold_acres must be > 0");
    if (eisThresh <= 0.0) throw new Error("eis_threshold_acres must be > 0");
    if (eisThresh < eaThresh) throw new Error("eis_threshold_acres must be >= ea_threshold_acres");
    if (sitePlan < 0.0) throw new Error("site_plan_approval_weeks must be >= 0");
    if (permit < 0.0) throw new Error("permit_issuance_weeks must be >= 0");
    if (contingency < 0.0) throw new Error("schedule_contingency_frac must be >= 0");

    // ---- disturbed area composes over the land core (parcel_m2 -> acres) -------------
    const disturbedAreaAcres = parcelM2 / globalThis.AIDC.calcLand.ACRE_M2;

    // ---- environmental-review tier: a three-band step on the disturbed acreage -------
    //   tier 0 below the EA threshold (minimal), tier 1 at/above it (EA), tier 2 at/above
    //   the EIS threshold (full EIS). The tier composes LIVE over the land core, so a
    //   larger project crosses a threshold and adds review weeks.
    let envTier;
    if (disturbedAreaAcres >= eisThresh) envTier = 2.0;
    else if (disturbedAreaAcres >= eaThresh) envTier = 1.0;
    else envTier = 0.0;
    const environmentalReviewWeeks = envBase + envStep * envTier;

    // ---- the load-bearing critical-path identity ------------------------------------
    //   the rezoning and environmental tracks are CONCURRENT (binding = the longer);
    //   pre-application, site-plan and permit are SEQUENTIAL. Total = sequential sum +
    //   the binding parallel branch. Replace max with min/sum, drop a sequential term,
    //   or hardcode the disturbed area, and the golden total pin (or the varying row) moves.
    const parallelReviewWeeks = Math.max(rezoning, environmentalReviewWeeks);
    const sequentialPhasesWeeks = preApp + sitePlan + permit;
    const totalEntitlementWeeks = sequentialPhasesWeeks + parallelReviewWeeks;

    // ---- band conversions: months, and a contingency high end -----------------------
    const totalEntitlementMonths = totalEntitlementWeeks * MONTHS_PER_YEAR / WEEKS_PER_YEAR;
    const totalEntitlementWeeksHigh = totalEntitlementWeeks * (1.0 + contingency);

    const out = {
      disturbed_area_acres: q(disturbedAreaAcres, "acres", "[D]",
                              "calc_land parcel_m2 / 4,046.856 — the graded parcel (the land " +
                              "the project disturbs) that drives the environmental-review " +
                              "tier, composed live over the land core (the [D] parcel geometry " +
                              "at the [A] project scale)"),
      environmental_review_tier: q(envTier, "tier", "[D]",
                                   "0 below the EA threshold (minimal), 1 at/above it " +
                                   "(Environmental Assessment), 2 at/above the EIS threshold " +
                                   "(Environmental Impact Statement) — stepped on the [D] " +
                                   "composed disturbed acreage vs the [S]/[A] thresholds"),
      environmental_review_weeks: q(environmentalReviewWeeks, "weeks", "[D]",
                                    "environmental_review_base_weeks + " +
                                    "environmental_review_tier_step_weeks x tier — the " +
                                    "environmental track duration; composed live over the " +
                                    "land core (a larger project bumps the tier), rests on " +
                                    "the [A] base and per-tier-step review durations"),
      parallel_review_weeks: q(parallelReviewWeeks, "weeks", "[D]",
                               "max(rezoning_weeks, environmental_review_weeks) — the binding " +
                               "concurrent review branch (the longer of the discretionary " +
                               "rezoning track and the environmental track); rests on the [A] " +
                               "rezoning duration and the [D] composed environmental weeks"),
      sequential_phases_weeks: q(sequentialPhasesWeeks, "weeks", "[D]",
                                 "pre_application_weeks + site_plan_approval_weeks + " +
                                 "permit_issuance_weeks — the sequential phases outside the " +
                                 "concurrent review branch; rests on the [A] phase durations"),
      total_entitlement_weeks: q(totalEntitlementWeeks, "weeks", "[D]",
                                 "sequential_phases_weeks + parallel_review_weeks — the " +
                                 "end-to-end entitlement critical path; the load-bearing " +
                                 "sum-of-sequential-plus-max-of-parallel identity, composed " +
                                 "live over the land core through the environmental tier, " +
                                 "rests on the [A] phase durations over the composed scale"),
      total_entitlement_months: q(totalEntitlementMonths, "months", "[D]",
                                  "total_entitlement_weeks x 12 / 52 — the timeline in months " +
                                  "(52-week-year [S] planning convention); rests on the [A] " +
                                  "phase durations"),
      total_entitlement_weeks_high: q(totalEntitlementWeeksHigh, "weeks", "[D]",
                                      "total_entitlement_weeks x (1 + schedule_contingency_frac) " +
                                      "— the high end of the planning band with contingency for " +
                                      "re-submittals, hearing continuances and appeals; rests " +
                                      "on the [A] contingency fraction over the base timeline"),
    };

    const notes = [
      "METHOD — the standard US entitlement sequence (ULI 'Real Estate Development: Principles " +
      "and Process'; APA planning practice): pre-application -> discretionary rezoning / PUD / " +
      "special-use permit -> environmental review (NEPA 40 CFR 1500-1508 categorical exclusion " +
      "/ EA / EIS, or a state SEQRA/CEQA equivalent) -> administrative site-plan / subdivision " +
      "approval -> building-permit issuance. Environmental-review depth escalates with land " +
      "disturbance: review weeks = base + step x tier, tier stepped on the disturbed acreage.",
      "SIGN CONVENTION — total_entitlement_weeks = (pre_application + site_plan + permit) + " +
      "max(rezoning, environmental_review). The sequential phases are an independent SUM (drop " +
      "or mis-weight one and the total pin moves); the two review tracks are CONCURRENT so the " +
      "binding branch is their MAX. At a small scenario the rezoning track binds and the " +
      "environmental term does not move the total; at a larger it_mw the disturbed area crosses " +
      "a threshold, the environmental tier (and weeks) rises above the rezoning track and " +
      "becomes binding, so the total changes — which is why the composition is proven at a " +
      "NON-default scenario. Replace the max with a min or a sum, or hardcode the disturbed " +
      "area, and the varying-scenario golden row fails.",
      "REVIEW SCALE composes over the land core: the disturbed area is calc_land.footprint(...) " +
      "parcel_m2 for the same scenario (the graded parcel — the land the project disturbs), so " +
      "a change in the site scale flows straight into the environmental-review tier and the " +
      "whole entitlement timeline — nothing about the scale is hardcoded here.",
      "PROVENANCE — [S] ea_threshold_acres 1.0 (EPA Construction General Permit CWA sec 402 " +
      "NPDES land-disturbance trigger). [A] phase durations (pre-application 8, rezoning 26, " +
      "environmental base 6 + 24/tier, site-plan 12, permit 6 weeks), [A] EIS threshold 10.0 " +
      "acres, [A] contingency 0.25 — planning assumptions, override from your jurisdiction's " +
      "published review timelines. Outputs are [D] derived; every output names its [S]/[A] " +
      "basis in its source.",
      "DETERMINISTIC: pure schedule arithmetic in weeks over the composed disturbed area and " +
      "the phase-duration assumptions — no wall clock, no calendar dates, no randomness — so a " +
      "double run is byte-identical and the JS port matches to the week. DISTINCT from " +
      "calc_schedule (the physical build/commission lifecycle CPM producing energize/gpus-live " +
      "dates); this is the pre-construction entitlement clock, a size-driven weeks band.",
      "Scope: a single-snapshot planning ROM, not a jurisdiction-specific entitlement schedule. " +
      "Phase durations are planning-band assumptions, the environmental tier is a three-band " +
      "step on disturbed acreage (NOT a significance determination), the review tracks are " +
      "taken as concurrent (NOT a dependency network), and appeals / re-submittals fold into " +
      "one contingency fraction (NOT a probabilistic risk model). No hearing-calendar " +
      "alignment, agency-backlog queueing, conditions-of-approval / development-agreement " +
      "negotiation, impact-fee schedule, or CEQA/NEPA litigation timeline.",
    ];

    const itMwEcho = itGiven ? Number(kw.it_mw) : globalThis.AIDC.calcLand.DEFAULTS.it_mw.value;
    const inputs = {
      it_mw: q(itMwEcho, "MW-IT", itGiven ? "[S]" : "[A]",
               "project scale — forwarded to calc_land for the disturbed parcel area"),
    };
    for (const k of Object.keys(DEFAULTS)) {
      inputs[k] = (lay[k] !== null && lay[k] !== undefined)
        ? q(lay[k], DEFAULTS[k].unit, "[S]", "user-supplied")
        : DEFAULTS[k];
    }

    return result(
      "entitlements — permitting / land-use approval timeline planning bands (entitlement CPM)",
      "review scale composed over calc_land.footprint (parcel_m2 -> disturbed acres -> " +
      "environmental tier); total = (pre_application + site_plan + permit) + " +
      "max(rezoning, environmental_review) (pure schedule math in weeks, no wall clock)",
      inputs, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcEntitlements = { DEFAULTS: DEFAULTS, entitlements: entitlements };
})();
