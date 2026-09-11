// Colo + GPUs: total cost per GPU over time. PURE: object in -> result object out.
// parity: cli/aidc/core/calc_tco.py (frozen core) — gpuValueFrac, ledger and
// tco ported 1:1 (same input names, output names and order, formulas, notes).
// Model T1-T8 (from the core's header):
//   T1 fleet     racks = ceil(gpus / gpus_per_rack) ; it_kw = racks x rack_kw
//   T2 hours     gpu_hours_m = gpus x 730 x utilization
//   T3 energy    lf_energy = util + (1 - util) x idle_power_frac ;
//                kwh_m = it_kw x pue x 730 x lf_energy   (idle racks still burn)
//   T4 GPU value straight: V(m) linear to salvage at gpu_life, flat after
//                resale:   V(m) = P x max(floor, (1 - d)^(m/12))
//   T5 facility  BUILD: amortise build_usd_per_w_it over facility_life;
//                LEASE: it_kw x lease_usd_per_kw_month, no facility capex
//   T6 levelized [C0 - TV.df_N + sum cash_m.df_m] / sum h_m.df_m,
//                df_m = (1+i)^-m, i = (1+wacc)^(1/12)-1; at wacc=0 this reduces
//                EXACTLY to (capital consumed + cash costs) / hours
//   T7 cumulative cash out the door: C0 + running costs, NO terminal credit
//   T8 break-even first month where market_rate x delivered hours >= T7
// Defaults are GENERIC and published or reference-derived — no site, tariff or
// deal values. This is a COST estimator: no ROI, no IRR, no payback promises.
"use strict";
(function () {
  const { q, result } = globalThis.AIDC.res;

  const HOURS_PER_MONTH = 730.0; // 8760 / 12, same basis as calc_power F12
  const MODES = ["build", "lease"];
  const LEASE_TIERS = ["retail", "wholesale"];
  const DEPRECIATION = ["straight", "resale"];

  // GPU acquisition, US$/GPU ALL-IN IT (rack content + scale-out fabric/storage
  // share). Published estimate bands; each row states its provenance honestly.
  const GPU_PRICE_USD = {
    "gb200-nvl72": q(
      47700.0, "US$/GPU", "[D]",
      "GB200 NVL72 rack ~$3.0M widely reported (original not retrieved) / 72 " +
      "+ $6,000 fabric+storage share; cross-checks the IREN/Dell 8-K actual 29.0 $M/MW-IT " +
      "($5.8bn/200MW): at the adopted 136/72 density 1.889 kW/GPU the 8-K spreads to " +
      "$54.8k (~15% above); the 120 kW-rack reading 1.667 gives $48.3k, ~1.3% above " +
      "(see the Sources page; v3.1 TCO-H2)"),
    "gb300-nvl72": q(
      47700.0, "US$/GPU", "[A]",
      "NO public GB300 NVL72 price estimate exists — " +
      "GB200 basis carried as a PLACEHOLDER; replace with a vendor quote"),
    "b200-liquid": q(
      41000.0, "US$/GPU", "[A]",
      "vendor CEO public statement (Mar-2024, widely republished; original " +
      "behind 403) put B200 at $30-40k/GPU — mid $35k + $6,000 fabric+storage " +
      "share; HGX integrator-system basis, not DGX"),
    "dgx-b200-aircooled-2su": q(
      64400.0, "US$/GPU", "[A]",
      "DGX B200 8-GPU system reseller list ~$515k widely cited (Mar-2024, " +
      "original listing unreachable) / 8 — DGX premium includes the " +
      "fabric-ready networking share"),
  };

  const DEFAULTS = {
    mode: q("build", "", "[A]",
            "build = own the facility ($/W-IT capex); lease = colo space at " +
            "$/kW-month. GPUs are owned in BOTH modes"),
    platform: q("gb200-nvl72", "", "[A]",
                "rack-matrix variant — sets GPUs/rack, kW/rack and the GPU " +
                "acquisition default (see the rack planner page)"),
    racks: q(16, "", "[A]",
             "generic 16-rack reference fleet (1,152 GPUs at 72/rack) — set " +
             "with the racks or GPUs input"),
    gpus: q(null, "", "[A]",
            "optional GPU count; racks = ceil(gpus / gpus_per_rack) wins over " +
            "the racks input when given"),
    gpus_per_rack: q(72, "", "[S]",
                     "GB200 NVL72 single 72-GPU NVLink domain (variant data, " +
                     "NVIDIA public specs) — follows the platform"),
    rack_kw: q(136.0, "kW", "[S]",
               "GB200/GB300 NVL72 nameplate 136 kW (variant data [S]) " +
               "— follows the platform"),
    gpu_price_usd: q(null, "US$/GPU", "[A]",
                     "all-in IT capex per GPU (rack content + fabric/storage " +
                     "share); default = the platform's published-estimate band"),
    build_usd_per_w_it: q(12.43, "US$/W-IT", "[D]",
                          "JLL 2026 global shell-and-core 11.3 $/W x 1.10 liquid " +
                          "premium (capex calculator generic band; published range " +
                          "10-13 $/W)"),
    facility_life_years: q(20.0, "yr", "[A]",
                           "shell + MEP economic life (same convention as the capex calculator)"),
    lease_tier: q("retail", "", "[A]",
                  "retail = published asking-rate basis; wholesale = multi-MW " +
                  "leases that price below it"),
    lease_usd_per_kw_month: q(null, "US$/kW/mo", "[A]",
                              "colo rate incl. space/cooling/facility O&M, EXCL. " +
                              "metered energy; default = the chosen tier's band"),
    power_usd_per_kwh: q(0.0871, "US$/kWh", "[S]",
                         "US industrial average 8.71 c/kWh (EIA) " +
                         "— REPLACE with the site's tariff"),
    pue: q(1.15, "", "[S]",
           "NVIDIA DSX facility KPI band 1.15-1.20, low end"),
    utilization: q(0.70, "frac", "[A]",
                   "billable share of GPU-hours — DELIBERATELY conservative vs " +
                   "the 85%+ in optimistic operator models; utilization is the " +
                   "single biggest lever in the stack"),
    idle_power_frac: q(0.30, "frac", "[S]",
                       "idle rack draw ~30% of nameplate (NVL72-class rack spec " +
                       "[S], same basis as the commissioning P6 step) — unsold hours " +
                       "still burn power"),
    horizon_years: q(5.0, "yr", "[A]",
                     "1-6 years, monthly resolution; default matches the 5-yr " +
                     "GPU life below"),
    gpu_life_years: q(5.0, "yr", "[S]",
                      "AWS discloses servers at 5-6 yr (shortened a subset back " +
                      "to 5 eff. 2025-01-01), CoreWeave at 6 (both SEC 10-Ks) " +
                      "— 5 is the conservative pick"),
    salvage_frac: q(0.10, "frac", "[A]",
                    "straight-line residual at end of gpu_life"),
    depreciation: q("straight", "", "[A]",
                    "straight = linear to salvage over gpu_life; resale = " +
                    "published-estimate decay curve (see resale_decline_pct_yr)"),
    resale_decline_pct_yr: q(30.0, "%/yr", "[A]",
                             "resale-value decline band 25-40 %/yr — consistent " +
                             "with the 5-6 yr SEC book lives and H100 street " +
                             "history; NO vendor publishes a " +
                             "curve, so this is an estimate band"),
    resale_floor_frac: q(0.10, "frac", "[A]",
                         "resale curve floor as a fraction of acquisition"),
    opex_usd_per_kw_yr: q(null, "US$/kW-IT/yr", "[A]",
                          "staff + maintenance ex-power; default 940 in BUILD " +
                          "(published band), 235 in LEASE (tenant-side share — " +
                          "the landlord's O&M is inside the lease rate)"),
    consumables_usd_per_kw_yr: q(null, "US$/kW-IT/yr", "[A]",
                                 "maintenance-consumables anchor, OFF by default because the " +
                                 "940 published opex band already carries maintenance — enable " +
                                 "it on top of a staff-only opex, or to price the FMEA slice " +
                                 "explicitly. FM-derived band ~30-60 (mid 45): optics " +
                                 "replacement at 1-2%/yr AFR [A anchored on FM-NET-001 flap + " +
                                 "burn-in evidence] x ~3.25 pluggables/GPU [D 4-SU NDR " +
                                 "reference] x $500-1,319 published optic prices [S] + " +
                                 "break-fix remote-hands labor [A $100-250/hr class] + " +
                                 "filters/fluids/UPS-consumable classes (FM-UPS-007, " +
                                 "FM-AIR-004, FM-LIQ-002)"),
    availability_pct: q(null, "%", "[A]",
                        "delivered-hours availability haircut, OFF by default (billable " +
                        "utilization is the headline lever; this prices the residual). " +
                        "Expected-downtime band [D] 0.5-1.5% of fleet-hours -> 98.5-99.5% " +
                        "available: 2.34 failures/1,000 node-days steady floor (Meta " +
                        "arXiv:2410.21680) x reseat/swap restore times + facility events " +
                        "(Uptime 2022/2026: power 43% of significant outages; networking " +
                        "the biggest cause of IT-service incidents) + planned windows. " +
                        "Llama-3 ran >90% effective training time WITH 419 unexpected " +
                        "interruptions in 54 days (arXiv:2407.21783) — the band prices " +
                        "residual downtime, not bad ops"),
    wacc_pct: q(0.0, "%/yr", "[A]",
                "cost of capital for the levelized-with-WACC variant; 0 = " +
                "undiscounted (the default). Formula: T6 in the page header"),
    market_usd_per_gpu_hr: q(null, "US$/GPU-h", "[A]",
                             "optional market rental rate to break-even against " +
                             "— published anchors: CoreWeave GB200 $10.50 / B200 " +
                             "$8.60 / H100 $6.16, Nebius B200 $7.15 / H100 $3.85, " +
                             "AWS Capacity Blocks GB200 $10.58 (public price pages, " +
                             "observed 2026-08-20)"),
  };

  // Mode/tier-dependent defaults, resolved when the user leaves the input null.
  const OPEX_DEFAULT = {
    build: q(940.0, "US$/kW-IT/yr", "[D]",
             "cash opex ex-power at 10 MW-IT, published band 940-1,140 $k/MW-IT/yr " +
             "— same basis as the capex calculator"),
    lease: q(235.0, "US$/kW-IT/yr", "[A]",
             "tenant-side fleet ops + remote hands ~25% of the 940 build band " +
             "— facility staff/maintenance sits inside the lease rate; no " +
             "published tenant-only benchmark exists"),
  };
  const LEASE_DEFAULT = {
    retail: q(217.30, "US$/kW/mo", "[S]",
              "CBRE Global Data Center Trends 2025: global average asking rate " +
              "$217.30/kW/mo, +3.3% YoY Q1-2025; " +
              "regional band $140-470"),
    wholesale: q(140.0, "US$/kW/mo", "[A]",
                 "multi-MW wholesale leases price BELOW published retail asking; " +
                 "no public wholesale benchmark was sourced — band anchored on " +
                 "the CBRE regional low end (Sydney $140-215). Get quotes"),
  };

  // parity: Python round() (round-half-to-even) for the months roll-up.
  function pyround(x) {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff < 0.5) return f;
    if (diff > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }
  const fmt0 = (x) => Math.round(x).toLocaleString("en-US"); // "{:,.0f}"

  // T4: GPU value at end of `month`, as a fraction of acquisition price.
  // Plain numbers in, plain numbers out, so the curve lives in exactly ONE
  // place: the levelized number, the by-year rows and the SVG all read it.
  function gpuValueFrac(month, mode, gpu_life_years, salvage_frac,
                        resale_decline_pct_yr, resale_floor_frac) {
    if (mode === "straight") {
      const life_m = gpu_life_years * 12.0;
      return Math.max(salvage_frac, 1.0 - (1.0 - salvage_frac) * (month / life_m));
    }
    const d = resale_decline_pct_yr / 100.0;
    return Math.max(resale_floor_frac, Math.pow(1.0 - d, month / 12.0));
  }

  // T1-T8 for one (utilization, power price) point. Pure; called once for the
  // headline and re-called for every sensitivity cell so the grid can never
  // drift from the main arithmetic. Returns plain numbers (monthly series
  // included) — tco() wraps them in labelled quantities.
  function ledger(p, utilization, power_usd_per_kwh) {
    const gpus_per_rack = Math.trunc(p.gpus_per_rack);
    const racks = p.gpus ? Math.ceil(Number(p.gpus) / gpus_per_rack) : Math.trunc(p.racks);
    const gpus = racks * gpus_per_rack;
    const it_kw = racks * Number(p.rack_kw);
    const months = pyround(Number(p.horizon_years) * 12.0);

    const gpu_capex = gpus * Number(p.gpu_price_usd);
    const facility_capex = p.mode === "build"
      ? Number(p.build_usd_per_w_it) * it_kw * 1000.0 : 0.0;
    const upfront = gpu_capex + facility_capex;

    const avail = (p.availability_pct !== null && p.availability_pct !== undefined)
      ? Number(p.availability_pct) / 100.0 : 1.0;
    const hours_m = gpus * HOURS_PER_MONTH * utilization * avail;
    const lf_energy = utilization + (1.0 - utilization) * Number(p.idle_power_frac);
    const kwh_m = it_kw * Number(p.pue) * HOURS_PER_MONTH * lf_energy;
    const power_m = kwh_m * power_usd_per_kwh;
    const opex_m = it_kw * Number(p.opex_usd_per_kw_yr) / 12.0;
    const consumables_m = (p.consumables_usd_per_kw_yr !== null && p.consumables_usd_per_kw_yr !== undefined)
      ? it_kw * Number(p.consumables_usd_per_kw_yr) / 12.0 : 0.0;
    const lease_m = p.mode === "lease" ? it_kw * Number(p.lease_usd_per_kw_month) : 0.0;
    const cash_m = power_m + opex_m + consumables_m + lease_m;

    const fac_amort_m = p.mode === "build"
      ? facility_capex / (Number(p.facility_life_years) * 12.0) : 0.0;

    const v = (m) => gpu_capex * gpuValueFrac(m, p.depreciation,
                                              Number(p.gpu_life_years),
                                              Number(p.salvage_frac),
                                              Number(p.resale_decline_pct_yr),
                                              Number(p.resale_floor_frac));

    const i = Math.pow(1.0 + Number(p.wacc_pct) / 100.0, 1.0 / 12.0) - 1.0;
    let cum_cash = upfront, num_pv = 0.0, den_pv = 0.0;
    const cum = [];
    const year_cost = new Array(Math.ceil(months / 12.0)).fill(0.0);
    for (let m = 1; m <= months; m++) {
      const df = Math.pow(1.0 + i, -m);
      num_pv += cash_m * df;
      den_pv += hours_m * df;
      cum_cash += cash_m;
      cum.push(cum_cash);
      year_cost[Math.floor((m - 1) / 12)] += (v(m - 1) - v(m)) + fac_amort_m + cash_m;
    }

    const gpu_residual = v(months);
    const fac_residual = facility_capex - fac_amort_m * months;
    const tv = gpu_residual + fac_residual;
    const df_n = Math.pow(1.0 + i, -months);

    const lev_pv = den_pv ? (upfront - tv * df_n + num_pv) / den_pv : null;
    const total_cost = (gpu_capex - gpu_residual) + fac_amort_m * months + cash_m * months;
    const hours_total = hours_m * months;
    const lev = hours_total ? total_cost / hours_total : null;

    return {
      racks: racks, gpus: gpus, it_kw: it_kw, months: months,
      gpu_capex: gpu_capex, facility_capex: facility_capex,
      upfront: upfront, hours_m: hours_m, hours_total: hours_total,
      lf_energy: lf_energy, kwh_m: kwh_m, power_m: power_m,
      opex_m: opex_m, consumables_m: consumables_m, lease_m: lease_m,
      fac_amort_m: fac_amort_m, avail: avail,
      gpu_residual: gpu_residual, fac_residual: fac_residual, tv: tv,
      levelized: lev, levelized_pv: lev_pv, total_cost: total_cost,
      year_cost: year_cost, cum_cash: cum,
    };
  }

  function tco(kw) {
    kw = kw || {};
    const p = {};
    for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k].value;
    for (const k of Object.keys(kw)) {
      if (kw[k] !== null && kw[k] !== undefined) p[k] = kw[k];
    }
    if (!MODES.includes(p.mode)) {
      throw new Error("mode must be one of " + MODES.join(", "));
    }
    if (!LEASE_TIERS.includes(p.lease_tier)) {
      throw new Error("lease_tier must be one of " + LEASE_TIERS.join(", "));
    }
    if (!DEPRECIATION.includes(p.depreciation)) {
      throw new Error("depreciation must be one of " + DEPRECIATION.join(", "));
    }
    if (!(1.0 <= Number(p.horizon_years) && Number(p.horizon_years) <= 6.0)) {
      throw new Error("horizon_years must be within 1-6");
    }
    if (!(0.0 < Number(p.utilization) && Number(p.utilization) <= 1.0)) {
      throw new Error("utilization must be within (0, 1]");
    }

    // mode/tier/platform-dependent defaults, resolved only when left null
    const resolved = {};
    if (p.gpu_price_usd === null || p.gpu_price_usd === undefined) {
      if (!(p.platform in GPU_PRICE_USD)) {
        throw new Error("no GPU price band for platform '" + p.platform + "' — pass " +
                        "gpu_price_usd (known: " +
                        Object.keys(GPU_PRICE_USD).sort().join(", ") + ")");
      }
      resolved.gpu_price_usd = GPU_PRICE_USD[p.platform];
      p.gpu_price_usd = resolved.gpu_price_usd.value;
    }
    if (p.opex_usd_per_kw_yr === null || p.opex_usd_per_kw_yr === undefined) {
      resolved.opex_usd_per_kw_yr = OPEX_DEFAULT[p.mode];
      p.opex_usd_per_kw_yr = resolved.opex_usd_per_kw_yr.value;
    }
    if (p.mode === "lease" &&
        (p.lease_usd_per_kw_month === null || p.lease_usd_per_kw_month === undefined)) {
      resolved.lease_usd_per_kw_month = LEASE_DEFAULT[p.lease_tier];
      p.lease_usd_per_kw_month = resolved.lease_usd_per_kw_month.value;
    }

    const util = Number(p.utilization);
    const rate = Number(p.power_usd_per_kwh);
    const L = ledger(p, util, rate);
    const months = L.months, years = Math.ceil(L.months / 12.0);
    const build = p.mode === "build";

    const out = {
      racks: q(L.racks, "", "[D]",
               p.gpus ? "T1: ceil(gpus / gpus_per_rack)" : "user fleet size"),
      gpus_installed: q(L.gpus, "", "[D]", "T1: racks x gpus_per_rack"),
      it_mw: q(L.it_kw / 1000.0, "MW-IT", "[D]", "T1: racks x rack_kw"),
      gpu_capex_usd: q(L.gpu_capex, "US$", "[D]",
                       "gpus_installed x gpu_price_usd = " + L.gpus + " x " +
                       Number(p.gpu_price_usd).toFixed(0)),
    };
    if (build) {
      out.facility_capex_usd = q(
        L.facility_capex, "US$", "[D]",
        "T5: build_usd_per_w_it x it_kw x 1000 = " + Number(p.build_usd_per_w_it).toFixed(2) +
        " x " + fmt0(L.it_kw * 1000.0));
    }
    out.upfront_usd = q(L.upfront, "US$", "[D]",
                        build ? "gpu_capex_usd + facility_capex_usd"
                              : "gpu_capex_usd (lease mode: no facility capex)");
    if (p.availability_pct !== null && p.availability_pct !== undefined) {
      out.gpu_hours_month = q(L.hours_m, "GPU-h/mo", "[D]",
                              "T2: gpus x 730 x utilization x availability = " +
                              L.gpus + " x 730 x " + util.toFixed(2) + " x " +
                              L.avail.toFixed(3));
    } else {
      out.gpu_hours_month = q(L.hours_m, "GPU-h/mo", "[D]",
                              "T2: gpus x 730 x utilization = " + L.gpus + " x 730 x " +
                              util.toFixed(2));
    }
    out.gpu_hours_horizon = q(L.hours_total, "GPU-h", "[D]",
                              "T2: gpu_hours_month x " + months + " months");
    if (p.availability_pct !== null && p.availability_pct !== undefined) {
      out.gpu_hours_lost_to_downtime = q(
        L.gpus * HOURS_PER_MONTH * util * (1.0 - L.avail) * months,
        "GPU-h", "[D]",
        "billable hours removed by the availability haircut: gpus x 730 x " +
        "utilization x (1 - " + L.avail.toFixed(3) + ") x " + months + " months — the " +
        "expected-downtime band (hardware floor + facility events + planned windows) " +
        "priced on delivered hours");
    }
    out.energy_load_factor = q(L.lf_energy, "frac", "[D]",
                               "T3: util + (1 - util) x idle_power_frac = " +
                               util.toFixed(2) + " + " + (1 - util).toFixed(2) + " x " +
                               Number(p.idle_power_frac).toFixed(2));
    out.energy_kwh_month = q(L.kwh_m, "kWh/mo", "[D]",
                             "T3: it_kw x pue x 730 x energy_load_factor");
    out.power_cost_usd_month = q(L.power_m, "US$/mo", "[D]",
                                 "energy_kwh_month x " + rate.toFixed(4) + " $/kWh");
    out.opex_usd_month = q(L.opex_m, "US$/mo", "[D]",
                           "it_kw x opex_usd_per_kw_yr / 12");
    if (p.consumables_usd_per_kw_yr !== null && p.consumables_usd_per_kw_yr !== undefined) {
      out.consumables_usd_month = q(
        L.consumables_m, "US$/mo", "[D]",
        "it_kw x consumables_usd_per_kw_yr / 12 — the maintenance-consumables " +
        "anchor (optics AFR replacement + break-fix labor + filter/fluid/" +
        "UPS-consumable classes), on top of the opex line");
    }
    if (!build) {
      out.lease_usd_month = q(L.lease_m, "US$/mo", "[D]",
                              "T5: it_kw x lease_usd_per_kw_month = " + fmt0(L.it_kw) +
                              " x " + Number(p.lease_usd_per_kw_month).toFixed(2));
    }

    const fac_used = L.fac_amort_m * months;
    const parts = [
      ["gpu", L.gpu_capex - L.gpu_residual],
      [build ? "facility" : "lease", build ? fac_used : L.lease_m * months],
      ["power", L.power_m * months],
      ["opex", (L.opex_m + L.consumables_m) * months],
    ];
    out.levelized_usd_per_gpu_hr = q(
      L.levelized, "US$/GPU-h", "[D]",
      "T6 at wacc=0: (GPU value consumed " + fmt0(parts[0][1]) + " + " +
      parts[1][0] + " " + fmt0(parts[1][1]) + " + power " + fmt0(parts[2][1]) +
      " + opex " + fmt0(parts[3][1]) + ") / " + fmt0(L.hours_total) + " GPU-h");
    if (Number(p.wacc_pct) > 0.0) {
      out.levelized_wacc_usd_per_gpu_hr = q(
        L.levelized_pv, "US$/GPU-h", "[D]",
        "T6 at wacc=" + Number(p.wacc_pct).toFixed(1) + "%: [upfront - TV.df_N + " +
        "sum cash_m.df_m] / sum hours_m.df_m, i = (1+wacc)^(1/12)-1");
    }
    for (let y = 0; y < years; y++) {
      const hrs = L.hours_m * (Math.min(months, (y + 1) * 12) - y * 12);
      out["year" + (y + 1) + "_usd_per_gpu_hr"] = q(
        hrs ? L.year_cost[y] / hrs : null, "US$/GPU-h", "[D]",
        "year " + (y + 1) + " (value consumed + facility/lease + power + opex) / " +
        "delivered GPU-h — undiscounted");
    }

    const total = L.total_cost;
    for (const [name, usd] of parts) {
      out["cost_" + name + "_usd"] = q(usd, "US$", "[D]",
                                       name + " share of the horizon cost");
    }
    out.cost_total_usd = q(total, "US$", "[D]",
                           "sum of the four shares — capital CONSUMED, not spent");
    for (const [name, usd] of parts) {
      out["split_" + name + "_pct"] = q(total ? 100.0 * usd / total : null,
                                        "%", "[D]", "cost_" + name + "_usd / cost_total_usd");
    }
    out.gpu_residual_usd = q(L.gpu_residual, "US$", "[D]",
                             "T4 " + p.depreciation + " value at month " + months);
    if (build) {
      out.facility_residual_usd = q(L.fac_residual, "US$", "[D]",
                                    "facility book value at month " + months +
                                    " (straight-line over " +
                                    Math.trunc(p.facility_life_years) + " yr)");
    }
    out.terminal_value_usd = q(L.tv, "US$", "[D]",
                               "gpu_residual + facility_residual — credited in " +
                               "T6, NOT in the cumulative cash curve");

    out.cum_cash_month1_usd = q(L.cum_cash[0], "US$", "[D]",
                                "T7: upfront + month-1 cash costs");
    for (let y = 1; y <= years; y++) {
      const m = Math.min(y * 12, months);
      out["cum_cash_eoy" + y + "_usd"] = q(L.cum_cash[m - 1], "US$", "[D]",
                                           "T7 cumulative cash at month " + m +
                                           " (no terminal credit)");
    }

    const notes = [
      "ESTIMATOR, not a quote or an offer: generic published defaults, no " +
      "financing fees, tax, SG&A or margin — and deliberately NO ROI/IRR/payback " +
      "arithmetic. For the static cost-floor view see the capex page.",
      "utilization " + (100.0 * util).toFixed(0) + "% [A] is DELIBERATELY conservative — " +
      "sold-out operators run 85-95%, merchant fleets materially lower. It is the " +
      "single biggest lever: see the sensitivity rows before quoting any headline.",
      "T3 energy floor: unsold hours still burn idle_power_frac " +
      (100.0 * Number(p.idle_power_frac)).toFixed(0) + "% of " +
      "nameplate, so the power bill does NOT fall linearly with utilization — " +
      "calculators that scale energy by utilization alone flatter idle fleets.",
      "gpu_price_usd is ALL-IN IT per GPU (rack content + fabric/storage share), " +
      "published estimate bands with stated provenance — REPLACE with a real " +
      "quote before relying on it; memory-price inflation makes these more " +
      "likely to move up than down.",
      "T6/T7 read differently by design: the levelized number consumes capital " +
      "(residuals credited back), the cumulative curve is cash out the door " +
      "(no credit until you actually sell). Both formulas are in the page header.",
    ];
    if (build) {
      notes.push(
        "BUILD charges the horizon's " + months + " months of a " +
        Math.trunc(p.facility_life_years) + "-year facility " +
        "amortisation (" + fmt0(L.fac_amort_m) + " US$/mo) — the cumulative cash curve carries the FULL " +
        "facility capex up front, which is what a builder actually spends.");
    } else {
      notes.push(
        "LEASE " + p.lease_tier + " tier: the rate covers space/cooling/facility O&M; metered " +
        "energy is billed separately at power_usd_per_kwh x PUE. Wholesale " +
        "multi-MW rates are quote-only — no public benchmark exists, so the " +
        "wholesale default is an [A] band anchored on the CBRE regional low end.");
    }
    if (p.platform === "gb300-nvl72" && "gpu_price_usd" in resolved) {
      notes.push(
        "GB300 WARNING: no public GB300 NVL72 price estimate exists. " +
        "The default is the GB200 basis carried as a " +
        "PLACEHOLDER — treat every $ output as provisional until quoted.");
    }
    if (p.depreciation === "straight" && months > Number(p.gpu_life_years) * 12.0) {
      notes.push(
        "horizon exceeds gpu_life: straight-line capital charge is ZERO after " +
        "month " + Math.trunc(Number(p.gpu_life_years) * 12.0) + ", flattering the tail years. Use depreciation=resale for a " +
        "long horizon, or model a refresh explicitly.");
    }
    if (p.depreciation === "resale") {
      notes.push(
        "resale curve is an ESTIMATE band (25-40 %/yr decline, floor " +
        (100.0 * Number(p.resale_floor_frac)).toFixed(0) + "%): " +
        "no vendor publishes one. It front-loads cost into the early years — " +
        "compare the by-year rows against straight-line before quoting either.");
    }
    if (p.consumables_usd_per_kw_yr !== null && p.consumables_usd_per_kw_yr !== undefined) {
      notes.push(
        "consumables anchor ON: check for double-count against opex_usd_per_kw_yr " +
        "— the published 940 build band already carries maintenance, so pair this " +
        "line with a staff-only opex or treat it as the visible FMEA slice of the " +
        "same total. Basis: optics AFR + break-fix labor + consumable classes " +
        "(FM-NET-001/FM-UPS-007/FM-AIR-004 evidence; band ~30-60 $/kW-IT/yr).");
    }
    if (p.availability_pct !== null && p.availability_pct !== undefined) {
      notes.push(
        "availability haircut ON: delivered hours scaled by " +
        Number(p.availability_pct).toFixed(1) + "%. Energy is " +
        "conservatively NOT scaled (failed/serviced nodes still draw, and the " +
        "idle floor dominates); the haircut compounds with utilization, so do " +
        "not also bury downtime inside a lowered utilization input.");
    }

    if (p.market_usd_per_gpu_hr !== null && p.market_usd_per_gpu_hr !== undefined) {
      const mkt = Number(p.market_usd_per_gpu_hr);
      const rental_m = mkt * L.hours_m;
      let be = null;
      for (let m = 1; m <= months; m++) {
        if (rental_m * m >= L.cum_cash[m - 1]) { be = m; break; }
      }
      out.rental_cum_horizon_usd = q(rental_m * months, "US$", "[D]",
                                     "T8: market rate x delivered GPU-h = " +
                                     mkt.toFixed(2) + " x " + fmt0(L.hours_total));
      out.breakeven_month = q(be ? be : "never (within horizon)", "",
                              "[D]",
                              "T8: first month cumulative rental >= " +
                              "cumulative cash cost (no resale credit)");
      notes.push(
        "break-even compares YOUR estimated cash cost against a rental rate " +
        "YOU entered — both sides are estimates, market rates reprice " +
        "continuously, and renting delivers zero residual asset. Published " +
        "anchors and dates are on the market_usd_per_gpu_hr input row.");
    }

    const sens = [
      ["sens_util_minus10pt", Math.min(1.0, Math.max(0.05, util - 0.10)), rate,
       "utilization " + (100.0 * Math.min(1.0, Math.max(0.05, util - 0.10))).toFixed(0) + "%"],
      ["sens_util_plus10pt", Math.min(1.0, Math.max(0.05, util + 0.10)), rate,
       "utilization " + (100.0 * Math.min(1.0, Math.max(0.05, util + 0.10))).toFixed(0) + "%"],
      ["sens_power_minus25", util, rate * 0.75,
       "power " + (rate * 0.75).toFixed(4) + " $/kWh"],
      ["sens_power_plus25", util, rate * 1.25,
       "power " + (rate * 1.25).toFixed(4) + " $/kWh"],
      ["sens_worst", Math.min(1.0, Math.max(0.05, util - 0.10)), rate * 1.25,
       "utilization -10pt AND power +25%"],
      ["sens_best", Math.min(1.0, Math.max(0.05, util + 0.10)), rate * 0.75,
       "utilization +10pt AND power -25%"],
    ];
    for (const [key, u2, r2, what] of sens) {
      out[key] = q(ledger(p, u2, r2).levelized, "US$/GPU-h", "[D]",
                   "levelized at " + what +
                   (p.wacc_pct ? " (UNDISCOUNTED basis — the headline uses WACC "
                    + Number(p.wacc_pct).toFixed(1) + "%; compare like with like)" : ""));
    }

    let inputs = {};
    for (const k of Object.keys(DEFAULTS)) inputs[k] = DEFAULTS[k];
    for (const k of Object.keys(inputs)) {
      if (k in resolved && p[k] === resolved[k].value) {
        inputs[k] = resolved[k];
      } else if (p[k] !== DEFAULTS[k].value) {
        inputs[k] = q(p[k], DEFAULTS[k].unit, "[S]", "user-supplied");
      }
    }
    const inputs2 = {};
    for (const k of Object.keys(inputs)) {
      if (inputs[k].value !== null && inputs[k].value !== undefined) inputs2[k] = inputs[k];
    }

    return result(
      "tco — colo + GPUs, total cost per GPU-hour over time",
      "page header T1-T8 (fleet, hours, energy floor, GPU value curve, " +
      "facility/lease, levelization, cash curve, break-even) · published " +
      "benchmarks per input row: JLL/CBRE/EIA build-cost, colo-rate and power " +
      "benchmarks, GPU capex estimate bands, SEC-disclosed depreciation lives, " +
      "published rental anchors, NVIDIA DSX PUE band · rack data: variant matrix",
      inputs2, out, notes);
  }

  globalThis.AIDC = globalThis.AIDC || {};
  globalThis.AIDC.calcTco = {
    DEFAULTS: DEFAULTS, GPU_PRICE_USD: GPU_PRICE_USD, OPEX_DEFAULT: OPEX_DEFAULT,
    LEASE_DEFAULT: LEASE_DEFAULT, HOURS_PER_MONTH: HOURS_PER_MONTH,
    MODES: MODES, LEASE_TIERS: LEASE_TIERS, DEPRECIATION: DEPRECIATION,
    gpuValueFrac: gpuValueFrac, ledger: ledger, tco: tco,
  };
})();
