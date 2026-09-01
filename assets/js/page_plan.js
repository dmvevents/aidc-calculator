// Page config: the END-TO-END PLANNER — GPUs + platform in, the whole design
// out: racks/rows, power chain, cooling, fabric, capex, $/GPU-hr, the colo
// view and LAND/ACRES with a parametric site plan. Composition only: every
// number below is computed by the SAME engines the per-page calculators run
// (loaded on this page), and every card deep-links into its page carrying the
// scenario, where the full input set and derivation chains live. Ends A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  const { q, result } = A.res;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  const PLATFORMS = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];

  // ONE chain used by compute() and after() — the single-resolution rule
  // (antagonist A-04 class): hero, table and cards can never diverge.
  function chain(kw) {
    const plat = kw.platform || "gb200-nvl72";
    const gpus = (kw.gpus !== null && kw.gpus !== undefined) ? Number(kw.gpus) : 512;
    const v = DB[plat];

    const rack = A.calcRack.plan(v, {
      gpus: gpus, pue: v.pue_target, dist_v: v.distribution_voltage_v,
      racks_per_path: (v.row_plan && v.row_plan.compute) || null,
    });
    // COMPUTE-basis MW for every downstream engine — exactly what the scenario
    // bar feeds those pages (deriveScenario it_mw = racks x nameplate), so each
    // card equals its linked page under the same inputs. Support IT (+7.7%) is
    // the rack page's own roll-up line, stated there.
    const itMw = rack.outputs.racks.value * v.nameplate_kw / 1000.0;

    const power = A.calcPower.sizing({
      it_mw: itMw, pue: v.pue_target, dist_v: v.distribution_voltage_v,
      rack_kw: v.nameplate_kw, rack_edpp_kw: v.edpp2_kw,
      gpus: rack.outputs.gpus_installed.value,
      racks_per_path: (v.row_plan && v.row_plan.compute) || null,
    });

    const coolKw = { it_kw: itMw * 1000.0, liquid_frac: (v.liquid_pct || 0) / 100.0 };
    if (v.liquid_pct > 0) {
      coolKw.rack_liquid_kw = v.liquid_kw;
      coolKw.cdu_kw = v.cdu_nominal_kw;
      coolKw.tcs_inlet_c = v.design_inlet_c;
      if (v.liquid_flow_curve) coolKw.flow_basis = "vendor";
    }
    const cooling = A.calcCooling.loads(coolKw);

    const rps = v.racks_per_su || 8;
    const racksN = rack.outputs.racks.value;
    const su = Math.max(1, Math.floor(racksN / rps));
    const fiber = A.calcFiber.plant({
      su: su, racks_per_su: rps, rails: v.rails, trays_per_rack: v.trays_per_rack,
      ib_twin_modules: String(v.scale_out || "").indexOf("infiniband") === 0,
    });

    const capex = A.calcCapex.costs({
      it_mw: itMw, kw_per_gpu: v.nameplate_kw / v.gpus_per_rack, pue: v.pue_target,
    });
    const tco = A.calcTco.tco({
      platform: plat, gpus_per_rack: v.gpus_per_rack, rack_kw: v.nameplate_kw,
      pue: v.pue_target, gpus: gpus,
    });
    const colo = A.calcColo.costs({ it_mw: itMw });
    const land = A.calcLand.footprint({ it_mw: itMw });

    return { plat: plat, gpus: gpus, v: v, su: su, rps: rps, itMw: itMw,
             rack: rack, power: power, cooling: cooling, fiber: fiber,
             capex: capex, tco: tco, colo: colo, land: land };
  }

  function compute(kw) {
    const c = chain(kw);
    const O = (r, k) => r.outputs[k];
    const out = {
      racks: q(O(c.rack, "racks").value, "", "[D]", "ceil(gpus / gpus_per_rack) — rack page"),
      gpus_installed: q(O(c.rack, "gpus_installed").value, "", "[D]", "racks × GPUs/rack — rack page"),
      it_mw: q(c.itMw, "MW-IT", "[D]",
               "racks × nameplate, COMPUTE basis — the same feed the scenario bar gives "
               + "every page; the rack page adds +7.7% support IT as its own line"),
      facility_mw: q(O(c.power, "facility_mw").value, "MW", "[D]",
                     "compute IT × the platform's PUE — power page F13"),
      utility_service_mva: q(O(c.power, "utility_service_mva").value, "MVA", "[D]",
                             "service at PF + growth margin — power page F13"),
      ups_modules_n: q(O(c.power, "ups_modules_n").value, "", "[D]",
                       "UPS modules per path at the peak share — power page F14"),
      genset_units_installed: q(O(c.power, "genset_units_installed").value, "", "[D]",
                                "standby gensets incl. redundancy — power page F15"),
      liquid_load_kw: q(O(c.cooling, "liquid_load_kw").value, "kW", "[D]",
                        "IT × the platform's liquid capture — cooling page"),
      cdu_units_installed: q(O(c.cooling, "cdu_units_installed").value, "", "[D]",
                             "CDU ladder incl. N+1 — cooling page F4"),
      air_flow_cfm: q(O(c.cooling, "air_flow_cfm").value, "CFM", "[D]",
                      "residual air at 157 CFM/kW — cooling page F9"),
      scalable_units: q(c.su, "", "[D]",
                        "floor(racks / racks-per-SU) — fiber models whole SUs"),
      links_fabric_total: q(O(c.fiber, "links_fabric_total").value, "", "[D]",
                            "fabric links, all tiers — fiber page"),
      pluggables_total: q(O(c.fiber, "pluggables_total").value, "", "[D]",
                          "transceivers (fabric counting basis) — fiber page"),
      capex_total_m: q(O(c.capex, "capex_total_m").value, "US$M", "[D]",
                       "shell + IT + spares + contingency — capex page"),
      cost_floor_per_gpu_hr: q(O(c.capex, "cost_floor_per_gpu_hr").value, "US$/GPU-h", "[D]",
                               "amortisation + opex + energy — capex page (0.85 basis)"),
      tco_levelized_usd_per_gpu_hr: q(O(c.tco, "levelized_usd_per_gpu_hr").value, "US$/GPU-h", "[D]",
                                      "5-yr build-mode levelized — TCO page (0.70 basis)"),
      colo_cost_floor_usd_per_kw_month: q(O(c.colo, "cost_floor_usd_per_kw_month").value,
                                          "US$/kW/mo", "[D]",
                                          "landlord cost floor at 0.85 occupancy — colo page"),
      colo_yield_on_cost_pct: q(O(c.colo, "yield_on_cost_pct").value, "%", "[D]",
                                "NOI / capex at the retail asking anchor — colo page"),
      site_acres: q(O(c.land, "site_acres").value, "acres", "[D]",
                    "parcel incl. setbacks (zero expansion reserve) — land page"),
      mw_it_per_acre: q(O(c.land, "mw_it_per_acre").value, "MW-IT/acre", "[D]",
                        "density at this parcel — land page"),
    };

    const rem = O(c.rack, "racks").value - c.su * c.rps;
    const notes = [
      "COMPOSITION page: every number is computed client-side by the same engines the " +
      "per-page calculators run, seeded with this platform's published values — open any " +
      "card to see the full input set, derivation chain and notes for that domain.",
      "Basis mix is stated per row: the capex floor amortises at 0.85 utilisation " +
      "(build context), the TCO levelized at 0.70 (deliberately conservative), the colo " +
      "view at 0.85 occupancy on the retail asking anchor — quote the basis with the number.",
      (rem > 0
        ? "Fabric models WHOLE scalable units: " + O(c.rack, "racks").value + " racks = " +
          c.su + " SU × " + c.rps + " + " + rem + " remainder — the fiber counts cover " +
          (c.su * c.rps) + " racks."
        : "Fabric counts cover " + c.su + " whole scalable unit(s) of " + c.rps + " racks."),
      "Land is a single-story greenfield PLANNING band (factor band 1.5–2.5 alone is " +
      "−21%/+32%) with ZERO expansion reserve here — the land page adds the reserve knob " +
      "and the priced-land row.",
      "The cooling rows use the platform's liquid split at the generic climate defaults; " +
      "the cooling page carries the site-climate feasibility verdict (dry / wetted / " +
      "infeasible) — run it with your design temperatures before believing any PUE.",
      "For the buildable-vs-buy decision at these numbers: TCO page (GPU owner) vs colo " +
      "page (landlord). For a certified engineering package (USD digital twin, drawing " +
      "set, network configs) these same parameters drive the private toolkit's " +
      "generator pipeline — this site carries its generic reference twin on the 3D page.",
    ];

    const inputs = {
      platform: q(c.plat, "", "[S]", "rack-matrix variant (see the rack page's matrix)"),
      gpus: q(c.gpus, "", "[S]", "target GPU count — the whole plan derives from this"),
    };
    return result(
      "plan — one GPU count to racks, power, cooling, fabric, cost and land",
      "composition of the eight page engines (rack, power F13–F18, cooling F1–F11, " +
      "fiber, capex, tco T1–T8, colo, land) — each row names its page; engines are " +
      "cli-parity-locked",
      inputs, out, notes);
  }

  A.SECTIONS.push({
    id: "plan",
    defaults: {
      platform: q("gb200-nvl72", "", "[A]", "rack-matrix variant"),
      gpus: q(512, "", "[A]", "target GPU count — the whole plan derives from this"),
    },
    compute: compute,
    hero: "site_acres", heroLabel: "land needed (planning band)", heroSrc: "land-model",
    fields: [
      { key: "platform", label: "GPU platform", src: "variants", type: "select",
        value: "gb200-nvl72",
        options: PLATFORMS.map((n) => [n, DB[n].platform]) },
      { key: "gpus", label: "target GPU count", src: "legend", step: 8, min: 1 },
    ],
    derive: (r, kw) => {
      const c = chain(kw);
      const O = (x, k) => x.outputs[k].value;
      return [
        "fleet: " + d(c.gpus) + " GPUs ÷ " + c.v.gpus_per_rack + "/rack = " +
          d(O(c.rack, "racks")) + " racks (" + d(O(c.rack, "gpus_installed")) +
          " installed) → " + d(c.itMw) + " MW-IT compute (+7.7% support on the rack page)",
        "power: " + d(c.itMw) + " MW-IT × PUE " + d(c.v.pue_target) + " = " +
          d(O(c.power, "facility_mw")) + " MW facility → " +
          d(O(c.power, "utility_service_mva")) + " MVA service, " +
          d(O(c.power, "genset_units_installed")) + " gensets",
        "cooling: " + d(O(c.cooling, "liquid_load_kw")) + " kW liquid (" +
          d(c.v.liquid_pct || 0) + "% capture) → " +
          d(O(c.cooling, "cdu_units_installed")) + " CDUs installed",
        "fabric: " + d(c.su) + " SU → " + d(O(c.fiber, "links_fabric_total")) +
          " fabric links, " + d(O(c.fiber, "pluggables_total")) + " pluggables",
        "cost: capex " + d(O(c.capex, "capex_total_m")) + " US$M → floor " +
          d(O(c.capex, "cost_floor_per_gpu_hr")) + " $/GPU-h (0.85) · TCO levelized " +
          d(O(c.tco, "levelized_usd_per_gpu_hr")) + " $/GPU-h (0.70, 5-yr build)",
        "land: " + d(O(c.land, "developed_m2")) + " m² developed × " +
          d(c.land.inputs.circulation_setback_factor.value) + " = " +
          d(O(c.land, "site_acres")) + " acres (" + d(O(c.land, "mw_it_per_acre")) +
          " MW-IT/acre)",
      ];
    },
    after: (r, kw) => {
      const c = chain(kw);
      const O = (x, k) => A.res.disp(x.outputs[k].value);
      const link = (page) => page + "#s.platform=" + encodeURIComponent(c.plat) +
        "&s.driver=gpus&s.target=" + c.gpus;

      // domain cards, each deep-linking into its page WITH the scenario
      const cards = [
        ["Racks & floor", "rack.html", [
          [O(c.rack, "racks") + " racks", d(c.itMw) + " MW-IT"],
          ["floor " + O(c.rack, "floor_pressure_kpa") + " kPa", O(c.rack, "rack_footprint_m2") + " m² racks"]]],
        ["Power chain", "power.html", [
          [O(c.power, "facility_mw") + " MW facility", O(c.power, "utility_service_mva") + " MVA service"],
          [O(c.power, "ups_modules_n") + " UPS modules/path", O(c.power, "genset_units_installed") + " gensets"]]],
        ["Cooling", "cooling.html", [
          [O(c.cooling, "liquid_load_kw") + " kW liquid", O(c.cooling, "cdu_units_installed") + " CDUs (N+1)"],
          [O(c.cooling, "air_flow_cfm") + " CFM residual air", (c.v.liquid_pct || 0) + "% liquid capture"]]],
        ["Network fabric", "fiber.html", [
          [c.su + " scalable units", O(c.fiber, "links_fabric_total") + " fabric links"],
          [O(c.fiber, "pluggables_total") + " pluggables", O(c.fiber, "optics_power_kw") + " kW optics"]]],
        ["Capex", "capex.html", [
          [O(c.capex, "capex_total_m") + " US$M total", O(c.capex, "capex_per_gpu_usd") + " $/GPU"],
          ["floor " + O(c.capex, "cost_floor_per_gpu_hr") + " $/GPU-h", "@0.85 utilisation"]]],
        ["TCO (own the GPUs)", "tco.html", [
          ["levelized " + O(c.tco, "levelized_usd_per_gpu_hr") + " $/GPU-h", "5-yr build mode"],
          ["upfront " + O(c.tco, "upfront_usd") + " US$", "@0.70 utilisation"]]],
        ["Colo (lease the kW)", "colo.html", [
          ["floor " + O(c.colo, "cost_floor_usd_per_kw_month") + " $/kW·mo", O(c.colo, "yield_on_cost_pct") + "% yield-on-cost"],
          ["NOI " + O(c.colo, "noi_m_yr") + " US$M/yr", "@0.85 occupancy, retail anchor"]]],
        ["Neocloud (sell GPU-hours)", "neocloud.html", [
          ["break-even " + O(c.capex, "cost_floor_per_gpu_hr") + " $/GPU-h", "= the cost floor"],
          ["your sell rate prices margin + payback", "@0.85 utilisation basis"]]],
        ["Land", "land.html", [
          [O(c.land, "site_acres") + " acres", O(c.land, "site_hectares") + " ha"],
          [O(c.land, "mw_it_per_acre") + " MW-IT/acre", "zero expansion reserve"]]],
      ];
      const host = document.getElementById("plan-cards");
      if (host) {
        const frag = document.createDocumentFragment();
        for (const [title, page, rows] of cards) {
          const a = document.createElement("a");
          a.className = "plan-card";
          a.href = link(page);
          const h = document.createElement("span");
          h.className = "plan-card-t";
          h.textContent = title;
          a.appendChild(h);
          for (const pair of rows) {
            const p = document.createElement("p");
            const b = document.createElement("strong");
            b.textContent = pair[0];
            p.appendChild(b);
            p.appendChild(document.createTextNode(" · " + pair[1]));
            a.appendChild(p);
          }
          const open = document.createElement("span");
          open.className = "plan-open";
          open.textContent = "Open with these inputs →";
          a.appendChild(open);
          frag.appendChild(a);
        }
        host.replaceChildren(frag);
      }
      const sp = document.getElementById("plan-siteplan");
      if (sp && A.siteplan) A.siteplan.render(sp, c.land);
      const tw = document.getElementById("plan-3d-link");
      if (tw) tw.href = "3d.html#variant=" + encodeURIComponent(c.plat);
    },
  });

  A.boot();
})();
