// Generic capex + $/GPU-hr cost floor. PURE: object in -> result object out.
// parity: cli/aidc/core/calc_capex.py — costs() ported 1:1 (same names,
// inputs, outputs, notes). Defaults are PUBLISHED, GENERIC benchmarks only
// (JLL global average, SEC-disclosed project actuals, EIA industrial power
// price); GPU street prices and the site tariff are user inputs by design.
// sensitivity() is a site-only grid around the cost floor; no cli counterpart.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const HOURS_PER_YEAR = 8760.0;

  const DEFAULTS = {
    it_mw: q(1.0, "MW-IT", "[A]", "critical IT capacity — set to your project"),
    gpus: q(null, "", "[A]", "GPU count; if omitted, derived from it_mw / kw_per_gpu"),
    kw_per_gpu: q(1.889, "kW/GPU", "[D]",
                  "GB200 NVL72 rack nameplate / GPUs: 136 kW / 72 = 1.889 (3 d.p.) — the " +
                  "same basis as the rack planner (1.89 kW/GPU, 529 GPUs/MW). 136 kW is " +
                  "the GB300-template envelope value; GB200 actuals are <= it. Bare rack " +
                  "only: support IT (+7.7% reference share) and pluggable optics are " +
                  "separate rows in the rack/power calculators, NOT folded into this " +
                  "divisor — supply the GPU count to override. Public 120-140 kW GB200 " +
                  "quotes lack an NVIDIA doc (assumption-verify); 120/72 = 1.667 is the " +
                  "low-density alternative in the density table"),
    colo_m_per_mw: q(11.3, "US$M/MW", "[S]",
                     "JLL 2026 Global Data Center Outlook, global average shell-and-core " +
                     "ex land + IT"),
    liquid_premium_pct: q(10.0, "%", "[S]",
                          "JLL liquid-cooled premium on shell-and-core; Mordor's equipment " +
                          "delta is US$200-400/kW = 0.2-0.4M/MW — state which basis"),
    it_m_per_mw_it: q(28.5, "US$M/MW-IT", "[S]",
                      "Blackwell NCP capex 28-29M/MW-IT: IREN/Dell 8-K actual 29.0M and a " +
                      "bottoms-up GB200 model 28.6M converge to 1.4%"),
    substation_m: q(null, "US$M", "[A]",
                    "substation + interconnection: NO benchmark could be sourced. Carry as " +
                    "a FEED-priced placeholder, never a point estimate"),
    spares_pct_of_it: q(2.5, "%", "[D]",
                        "spares/DOA replacement float on IT capex: DOA ~10% of delivered " +
                        "systems + ~25% PCIe reseats at a documented 4k-GPU bring-up " +
                        "(FM-RCK-001/002, Imbue) are vendor-RMA-covered, so the owned cost " +
                        "is the float that rides the RMA pipeline: 2.34 failures/1,000 " +
                        "node-days steady floor (FM-RCK-003, Meta arXiv:2410.21680) x ~25% " +
                        "needing physical swap [A] x 6-week RMA turnaround [A] = 2.46% of " +
                        "fleet in transit at any instant -> 2.5% (band 1-4.5). Set 0 to " +
                        "reproduce the pre-FMEA floor"),
    contingency_pct_of_facility: q(2.5, "%", "[D]",
                                   "NAMED-RISK contingency on facility capex, sum of P x " +
                                   "cost-exposure over the 10 documented commissioning-window " +
                                   "failure classes: FM-RCK-001/002 arrival quality 1.0x0.4 + " +
                                   "FM-FIB-001/014 end-face contamination 0.9x0.3 + FM-NET-001 " +
                                   "flap under load 0.9x0.2 + FM-PWR-001/005 torque/joints " +
                                   "0.6x0.5 + FM-PWR-003/008 settings/load-bank 0.5x0.4 + " +
                                   "FM-UPS-001 battery under-delivery 0.3x0.7 + FM-GEN-001/008 " +
                                   "gen stability/ATS 0.4x0.5 + FM-LIQ-001/002 TCS " +
                                   "contamination 0.4x1.0 + FM-LIQ-004 loop leaks 0.6x0.3 + " +
                                   "FM-BMS-001/003 controls/sensors 0.5x0.4 = 2.54% -> 2.5 " +
                                   "default. Exposure classes are [A] (verify); base rates are " +
                                   "published postmortems. Set 0 for the pre-FMEA floor"),
    opex_k_per_mw_it_yr: q(940.0, "US$k/MW-IT/yr", "[D]",
                           "cash opex ex-power at 10 MW-IT, band 940-1,140; converges toward " +
                           "780 at >=20 MW-IT as the 24/7 crew amortises"),
    power_usd_per_kwh: q(0.0871, "US$/kWh", "[S]",
                         "US industrial average 8.71 c/kWh (EIA) — " +
                         "REPLACE with the site's tariff"),
    pue: q(1.15, "", "[S]", "NVIDIA DSX facility KPI band 1.15-1.20, low end"),
    load_factor: q(0.85, "frac", "[A]", "IT load factor (average / peak)"),
    utilisation: q(0.85, "frac", "[A]", "billable share of GPU-hours"),
    life_years: q(5.0, "yr", "[A]", "GPU-fleet economic life for straight-line amortisation"),
    facility_life_years: q(20.0, "yr", "[A]", "shell + MEP economic life"),
  };

  function costs(kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];

    const it = Number(p.it_mw);
    const gpus = p.gpus ? Math.trunc(p.gpus) : Math.round(it * 1000.0 / Number(p.kw_per_gpu));

    const colo = it * Number(p.colo_m_per_mw);
    const liquid_adder = colo * Number(p.liquid_premium_pct) / 100.0;
    const it_capex = it * Number(p.it_m_per_mw_it);
    const substation = p.substation_m !== null && p.substation_m !== undefined ? Number(p.substation_m) : 0.0;
    const spares = it_capex * Number(p.spares_pct_of_it) / 100.0;
    const facility = colo + liquid_adder + substation;
    const contingency = facility * Number(p.contingency_pct_of_facility) / 100.0;
    const total = facility + it_capex + spares + contingency;

    const opex_yr = it * Number(p.opex_k_per_mw_it_yr) / 1000.0;
    const energy_kwh_yr = it * 1000.0 * Number(p.pue) * HOURS_PER_YEAR * Number(p.load_factor);
    const energy_yr = energy_kwh_yr * Number(p.power_usd_per_kwh) / 1e6;

    const billable_h = gpus * HOURS_PER_YEAR * Number(p.utilisation);
    const amort_yr = (it_capex + spares) / Number(p.life_years)
                   + (facility + contingency) / Number(p.facility_life_years);
    const per_h = (m_usd) => billable_h ? m_usd * 1e6 / billable_h : null;

    const out = {
      gpus: q(gpus, "", !p.gpus ? "[D]" : "[S]",
              !p.gpus ? "it_mw / kw_per_gpu" : "user-supplied"),
      capex_colo_m: q(colo, "US$M", "[D]", "it_mw x colo_m_per_mw"),
      capex_liquid_adder_m: q(liquid_adder, "US$M", "[D]",
                              "colo x liquid_premium_pct"),
      capex_it_m: q(it_capex, "US$M", "[D]", "it_mw x it_m_per_mw_it"),
      capex_substation_m: q(substation || null, "US$M", "[A]",
                            "0 unless supplied — unsourced by design"),
      capex_spares_pool_m: q(spares, "US$M", "[D]",
                             "it_capex x spares_pct_of_it — the owned replacement float " +
                             "(FM-RCK-001/002/003); vendor RMA covers the parts, the float " +
                             "covers the schedule"),
      capex_contingency_m: q(contingency, "US$M", "[D]",
                             "(colo + liquid + substation) x contingency_pct_of_facility — " +
                             "named-risk sum, not a flat allowance (table on the input row)"),
      capex_total_m: q(total, "US$M", "[D]", "sum of the capex lines"),
      capex_per_mw_it_m: q(total / it, "US$M/MW-IT", "[D]", "capex_total_m / it_mw"),
      capex_per_gpu_usd: q(total * 1e6 / gpus, "US$/GPU", "[D]", "capex_total_m / gpus"),
      opex_ex_power_m_yr: q(opex_yr, "US$M/yr", "[D]", "it_mw x opex_k_per_mw_it_yr"),
      energy_kwh_yr: q(energy_kwh_yr, "kWh/yr", "[D]",
                       "it_mw x pue x 8760 x load_factor"),
      energy_cost_m_yr: q(energy_yr, "US$M/yr", "[D]",
                          "energy_kwh_yr x power_usd_per_kwh"),
      amortisation_m_yr: q(amort_yr, "US$M/yr", "[D]",
                           "IT + spares straight-line over life_years; facility + " +
                           "contingency over facility_life_years"),
      billable_gpu_hours_yr: q(billable_h, "GPU-h/yr", "[D]",
                               "gpus x 8760 x utilisation"),
      cost_amort_per_gpu_hr: q(per_h(amort_yr), "US$/GPU-h", "[D]", "amortisation / billable hours"),
      cost_opex_per_gpu_hr: q(per_h(opex_yr), "US$/GPU-h", "[D]", "opex ex-power / billable hours"),
      cost_energy_per_gpu_hr: q(per_h(energy_yr), "US$/GPU-h", "[D]", "energy / billable hours"),
      cost_floor_per_gpu_hr: q(per_h(amort_yr + opex_yr + energy_yr), "US$/GPU-h", "[D]",
                               "amortisation + opex + energy — a COST FLOOR, not a price"),
      effective_usd_per_it_kwh: q(Number(p.pue) * Number(p.power_usd_per_kwh),
                                  "US$/IT-kWh", "[D]",
                                  "pue_e x energy rate — volumetric part only; a demand " +
                                  "charge adds p_d x PUE_p / (730 x LF x PF) (research/10 §4.3)"),
    };

    const notes = [
      "These are GENERIC published benchmarks. JLL's 11.3M/MW is shell-and-core EXCLUDING " +
      "land and IT; the SEC-disclosed project actuals (Galaxy ~13M/MW, APLD 10-13M/MW) are " +
      "per MW of critical IT delivered — the denominators differ, so cross-read them " +
      "carefully.",
      "Substation + interconnection has NO sourced $/MVA benchmark. It is left at zero " +
      "unless you pass it, and should travel as a FEED-priced range, not a point estimate.",
      "The IREN/Dell 29.0M/MW-IT datapoint is GPU capex only, and whether its '200 MW' is " +
      "critical IT or gross facility load is not stated — at gross load and PUE ~1.2 the " +
      "true figure is ~34.8M/MW-IT. assumption-verify against the 8-K.",
      "Energy cost uses a flat rate. Real tariffs add demand charges, ratchets, class " +
      "thresholds and riders, and PUE enters twice (energy-weighted and at the billing peak) " +
      "— research/10 §4.3 has the mechanics; per-site schedules belong in the project " +
      "manifest, not in a generic calculator.",
      "cost_floor_per_gpu_hr excludes financing, tax, SG&A and any margin.",
      "The spares line is a replacement FLOAT, not a loss provision: DOA hardware is " +
      "vendor-RMA-replaced (documented ~10% initial-boot failures, FM-RCK-001); what you " +
      "buy is the pool that keeps bring-up and steady state on schedule while RMAs cycle. " +
      "The float re-enters service, so it amortises with the fleet.",
      "The contingency line is derived from ten NAMED failure classes with published " +
      "base-rate anchors (Imbue/Meta/Llama-3 bring-up data, AWS/Cloudflare/Google " +
      "postmortems, OCP liquid-cooling commissioning) x assumed cost-exposure classes — " +
      "the exposure classes are the [A] to verify, the class list is not.",
    ];

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
      "capex — generic build cost and $/GPU-hr cost floor",
      "published primary sources (JLL, IREN & APLD 8-Ks, Mordor, EIA) · " +
      "research/10-cooling-power.md §4.3 tariff mechanics · " +
      "research/12-failure-modes.md FM-IDs (spares float + named-risk contingency)",
      inputs, out, notes);
  }

  // ---- site-only: sensitivity grid around the cost floor --------------------
  // 3x3: power price x utilisation, +/- the given steps. Returns rows of
  // {power, util, floor} for the UI table. No cli counterpart.
  function sensitivity(base_kw, price_step_pct, util_step) {
    base_kw = base_kw || {};
    price_step_pct = price_step_pct === undefined ? 20 : price_step_pct;
    util_step = util_step === undefined ? 0.10 : util_step;
    const base_price = Number(base_kw.power_usd_per_kwh !== undefined && base_kw.power_usd_per_kwh !== null
      ? base_kw.power_usd_per_kwh : DEFAULTS.power_usd_per_kwh.value);
    const base_util = Number(base_kw.utilisation !== undefined && base_kw.utilisation !== null
      ? base_kw.utilisation : DEFAULTS.utilisation.value);
    const prices = [-1, 0, 1].map((s) => base_price * (1 + s * price_step_pct / 100));
    const utils = [-1, 0, 1].map((s) => Math.min(1, Math.max(0.05, base_util + s * util_step)));
    const rows = [];
    for (const u of utils) {
      for (const pr of prices) {
        const r = costs(Object.assign({}, base_kw, { power_usd_per_kwh: pr, utilisation: u }));
        rows.push({ power: pr, util: u, floor: r.outputs.cost_floor_per_gpu_hr.value });
      }
    }
    return { prices: prices, utils: utils, rows: rows };
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcCapex = { DEFAULTS: DEFAULTS, HOURS_PER_YEAR: HOURS_PER_YEAR,
                                costs: costs, sensitivity: sensitivity };
})();
