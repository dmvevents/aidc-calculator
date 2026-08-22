// Section configs 2/2: capex, fiber, commissioning + 3D twin loader + boot.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);

  // ---------------------------------------------------------------- CAPEX ----
  A.SECTIONS.push({
    id: "capex",
    defaults: A.calcCapex.DEFAULTS,
    compute: (kw) => A.calcCapex.costs(kw),
    hero: "cost_floor_per_gpu_hr", heroLabel: "cost floor (not a price)", heroSrc: "jll",
    fields: [
      { key: "it_mw", label: "critical IT", src: "legend", step: 0.5, min: 0.1 },
      { key: "power_usd_per_kwh", label: "power price", src: "eia", step: 0.005, min: 0 },
      { key: "utilisation", label: "billable utilisation", src: "legend", step: 0.05, min: 0.05, max: 1 },
      { key: "gpus", label: "GPU count (else derived)", src: "legend", step: 8, min: 1, placeholder: "derived" },
      { key: "it_m_per_mw_it", label: "IT capex $M/MW-IT", src: "iren-8k", step: 0.5, min: 0 },
      { key: "kw_per_gpu", label: "kW per GPU (all-in)", src: "aif-template", step: 0.01, min: 0.1, advanced: true },
      { key: "colo_m_per_mw", label: "shell+core $M/MW", src: "jll", step: 0.1, min: 0, advanced: true },
      { key: "liquid_premium_pct", label: "liquid premium %", src: "jll", step: 1, min: 0, advanced: true },
      { key: "substation_m", label: "substation $M (FEED)", src: "legend", step: 1, min: 0, advanced: true },
      { key: "opex_k_per_mw_it_yr", label: "opex ex-power $k/MW-IT/yr", src: "opex-band", step: 10, min: 0, advanced: true },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
      { key: "load_factor", label: "IT load factor", src: "legend", step: 0.05, min: 0.05, max: 1, advanced: true },
      { key: "life_years", label: "GPU life (yr)", src: "legend", step: 0.5, min: 1, advanced: true },
      { key: "facility_life_years", label: "facility life (yr)", src: "legend", step: 1, min: 1, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      return [
        "capex = shell(" + d(o.capex_colo_m.value) + ") + liquid(" + d(o.capex_liquid_adder_m.value) +
          ") + IT(" + d(o.capex_it_m.value) + ")" +
          (o.capex_substation_m && o.capex_substation_m.value ? " + sub(" + d(o.capex_substation_m.value) + ")" : "") +
          " = " + d(o.capex_total_m.value) + " US$M (" + d(o.capex_per_gpu_usd.value) + " $/GPU)",
        "amortisation = IT÷" + d(i.life_years.value) + " + facility÷" + d(i.facility_life_years.value) +
          " = " + d(o.amortisation_m_yr.value) + " US$M/yr",
        "energy = IT × PUE × 8760 × LF × rate = " + d(i.it_mw.value) + "×" + d(i.pue.value) + "×8760×" +
          d(i.load_factor.value) + "×" + d(i.power_usd_per_kwh.value) + " = " + d(o.energy_cost_m_yr.value) + " US$M/yr",
        "floor = (amort + opex + energy) ÷ billable = (" + d(o.amortisation_m_yr.value) + " + " +
          d(o.opex_ex_power_m_yr.value) + " + " + d(o.energy_cost_m_yr.value) + ")×10⁶ ÷ " +
          d(o.billable_gpu_hours_yr.value) + " = " + d(o.cost_floor_per_gpu_hr.value) + " US$/GPU-h",
      ];
    },
    after: (r, kw) => {
      const host = document.getElementById("capex-sens");
      if (!host) return;
      const s = A.calcCapex.sensitivity(kw, 20, 0.10);
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "cost floor US$/GPU-h — power price ±20% × utilisation ±10 pts [D]";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      const c0 = document.createElement("th");
      c0.textContent = "util \\ price";
      hr.appendChild(c0);
      for (const pr of s.prices) {
        const th = document.createElement("th");
        th.textContent = d(pr) + " $/kWh";
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      s.utils.forEach((u, ui) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = (u * 100).toFixed(0) + "%";
        tr.appendChild(th);
        s.prices.forEach((pr, pi) => {
          const td = document.createElement("td");
          td.className = "num" + (ui === 1 && pi === 1 ? " sens-base" : "");
          td.textContent = d(s.rows[ui * 3 + pi].floor);
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
  });

  // ---------------------------------------------------------------- FIBER ----
  A.SECTIONS.push({
    id: "fiber",
    defaults: A.calcFiber.DEFAULTS,
    compute: (kw) => A.calcFiber.plant(kw),
    hero: "links_fabric_total", heroLabel: "compute-fabric links", heroSrc: "gb200-ra",
    fields: [
      { key: "su", label: "scalable units", src: "legend", step: 1, min: 1 },
      { key: "tiers", label: "fabric tiers", src: "dossiers", type: "select", numeric: true,
        options: [[3, "3 (leaf/spine/core)"], [2, "2 (leaf/spine)"]] },
      { key: "rails", label: "rails", src: "gb200-ra", step: 1, min: 1 },
      { key: "w_per_end", label: "optic W per end", src: "cpo-blog", step: 0.5, min: 0 },
      { key: "it_mw", label: "compute IT (share note)", src: "legend", step: 0.1, min: 0.1 },
      { key: "mated_pairs", label: "mated MPO pairs", src: "tia568", step: 1, min: 0 },
      { key: "il_conn_db", label: "IL per mated pair", src: "tia568", step: 0.05, min: 0 },
      { key: "racks_per_su", label: "racks per SU", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "trays_per_rack", label: "compute trays / rack", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "leaves_per_su_rail", label: "leaves / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "spines_per_su_rail", label: "spines / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "links_leaf_spine", label: "links / leaf-spine pair", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "cores_per_rail", label: "cores / rail", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "links_spine_core", label: "links spine→core", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "storage_ports_per_tray", label: "storage ports / tray", src: "gb200-ra", step: 1, min: 0, advanced: true },
      { key: "dx_m", label: "Manhattan Δx", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "dy_m", label: "Manhattan Δy", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "clear_height_m", label: "hall clear height", src: "refdesign", step: 0.1, min: 2, advanced: true },
      { key: "rack_height_m", label: "rack height", src: "aif-template", step: 0.05, min: 1, advanced: true },
      { key: "routing_factor", label: "routing factor", src: "dossiers", step: 0.05, min: 1, advanced: true },
      { key: "service_slack_m", label: "service slack / end", src: "dossiers", step: 0.5, min: 0, advanced: true },
      { key: "fibers_per_parallel_port", label: "fibers / parallel port", src: "cabling-guide", step: 1, min: 1, advanced: true },
      { key: "trunk_size_f", label: "trunk size (F)", src: "cabling-guide", step: 12, min: 12, advanced: true },
      { key: "spares_per_endpoints", label: "endpoints per spare", src: "cabling-guide", step: 10, min: 10, advanced: true },
      { key: "hops", label: "switch hops (worst path)", src: "cabling-guide", step: 1, min: 1, advanced: true },
      { key: "t_switch_ns", label: "switch latency", src: "cabling-guide", step: 10, min: 0, advanced: true },
      { key: "path_fiber_m", label: "worst-path fiber", src: "cabling-guide", step: 5, min: 0, advanced: true },
      { key: "attn_db_per_km", label: "SMF attenuation", src: "itu-g652", step: 0.05, min: 0, advanced: true },
      { key: "loss_budget_media", label: "loss budget", src: "ieee-8023", type: "select",
        options: [["DR", "DR (3.0 dB / 500 m)"], ["FR4", "FR4 (4.0 dB / 2 km)"]], advanced: true },
      { key: "cable_od_mm", label: "jumper OD", src: "cabling-guide", step: 0.1, min: 1, advanced: true },
      { key: "tray_fill_max", label: "max tray fill", src: "dg11301", step: 0.05, min: 0.1, max: 1, advanced: true },
      { key: "cables_per_tray", label: "cables in sized tray", src: "dossiers", step: 8, min: 1, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      return [
        "§6.1 · NIC→leaf = SU×racks×trays×rails = " + i.su.value + "×" + i.racks_per_su.value + "×" +
          i.trays_per_rack.value + "×" + i.rails.value + " = " + d(o.links_nic_leaf.value) +
          " · leaf→spine " + d(o.links_leaf_spine.value) + " · spine→core " + d(o.links_spine_core.value) +
          " → " + d(o.links_fabric_total.value) + " links",
        "§6.4 · optics = 2×links × W/end = " + d(o.port_ends.value) + " × " + d(i.w_per_end.value) + " W = " +
          d(o.optics_power_kw.value) + " kW = " + d(o.optics_share_of_it_pct.value) + "% of IT",
        "§6.2 · length = (Δx+Δy+2×drop)×rf + slack = (" + d(i.dx_m.value) + "+" + d(i.dy_m.value) + "+2×" +
          d(o.rack_to_tray_drop_m.value) + ")×" + d(i.routing_factor.value) + "+2 = " + d(o.link_length_m.value) +
          " m → " + o.link_media_class.value,
        "§6.6 · IL = 0.4×km + pairs×" + d(i.il_conn_db.value) + " = " + d(0.4 * o.link_length_m.value / 1000) +
          " + " + i.mated_pairs.value + "×" + d(i.il_conn_db.value) + " = " + d(o.channel_il_db.value) +
          " dB vs " + d(o.channel_il_budget_db.value) + " dB " + (o.channel_il_pass.value ? "✓" : "✕"),
        "§6.5 · latency = 5 ns/m × " + d(i.path_fiber_m.value) + " + " + i.hops.value + "×" +
          d(i.t_switch_ns.value) + " ns = " + d(o.latency_one_way_us.value) + " µs one-way",
      ];
    },
  });

  // -------------------------------------------------------- COMMISSIONING ----
  A.SECTIONS.push({
    id: "cx",
    defaults: A.calcCx.DEFAULTS,
    compute: (kw) => A.calcCx.ladder(kw),
    hero: "p4_ups_bank_draw_mw", heroLabel: "UPS load-bank draw per path — before any GPU", heroSrc: "dossiers",
    fields: [
      { key: "it_mw", label: "IT load", src: "legend", step: 0.5, min: 0.1 },
      { key: "pue", label: "PUE", src: "dsx-kpi", step: 0.01, min: 1 },
      { key: "scalable_units", label: "scalable units (P7 steps)", src: "gb200-ra", step: 1, min: 1, placeholder: "e.g. 4" },
      { key: "p_e_usd_kwh", label: "energy rate", src: "eia", step: 0.005, min: 0 },
      { key: "genset_installed_mva", label: "installed genset MVA (P3)", src: "legend", step: 0.5, min: 0 },
      { key: "p_d_usd_kva_month", label: "demand rate (ratchet check)", src: "legend", step: 0.5, min: 0 },
      { key: "construction_frac", label: "P0 construction frac", src: "dossiers", step: 0.005, min: 0, advanced: true },
      { key: "house_frac", label: "P1 house frac", src: "dossiers", step: 0.005, min: 0, advanced: true },
      { key: "mech_frac", label: "P2 mech frac", src: "dossiers", step: 0.01, min: 0, advanced: true },
      { key: "mech_on_ups_frac", label: "mech-on-UPS / IT", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "ups_loss_frac", label: "UPS loss frac", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "rack_idle_frac_of_it", label: "idle fleet / IT", src: "aif-template", step: 0.005, min: 0, advanced: true },
      { key: "support_it_frac_of_it", label: "support IT / IT", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "liquid_frac", label: "liquid bank share", src: "aif-template", step: 0.01, min: 0, max: 1, advanced: true },
      { key: "cx_hours_low", label: "test window low (h)", src: "dossiers", step: 10, min: 0, advanced: true },
      { key: "cx_hours", label: "test window mid (h)", src: "dossiers", step: 10, min: 0, advanced: true },
      { key: "cx_hours_high", label: "test window high (h)", src: "dossiers", step: 10, min: 0, advanced: true },
      { key: "pf", label: "billed PF at test peak", src: "refdesign", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "accept_months_low", label: "accept band low (mo)", src: "dossiers", step: 0.5, min: 0, advanced: true },
      { key: "accept_months_high", label: "accept band high (mo)", src: "dossiers", step: 0.5, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      const L = [
        "P4 · bank/path = IT × (1+mech) × (1+UPS loss) = " + d(i.it_mw.value) + " × " +
          d(1 + i.mech_on_ups_frac.value) + " × " + d(1 + i.ups_loss_frac.value) + " = " +
          d(o.p4_ups_bank_draw_mw.value) + " MW = " + d(o.p4_pct_of_facility.value) + "% of facility — no GPUs yet",
        "bank fleet = " + d(o.load_bank_total_mw.value) + " MW, of which LIQUID-side " +
          d(o.load_bank_liquid_mw.value) + " MW (× " + d(i.liquid_frac.value) + ")",
        "Cx energy = facility × window = " + d(o.facility_mw.value) + " MW × " + d(i.cx_hours.value) + " h = " +
          d(o.cx_energy_mwh_mid.value) + " MWh (band " + d(o.cx_energy_mwh_low.value) + "–" +
          d(o.cx_energy_mwh_high.value) + ") → " + d(o.cx_energy_cost_usd_mid.value) + " US$ at tariff",
        "timeline = " + d(o.accept_months_low.value) + "–" + d(o.accept_months_high.value) +
          " months site-ready→accepted [A] · published floor " + d(o.timeline_floor_days ? o.timeline_floor_days.value : 19) +
          " days (Colossus [S])",
      ];
      return L;
    },
    after: (r) => {
      const c = document.getElementById("cx-steps");
      if (c) A.diagrams.cxLadder(c, r, A.calcCx.ladderSteps(r));
    },
    init: () => {
      const host = document.getElementById("cx-levels");
      if (!host) return;
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "commissioning level ladder L0–L6 (industry tag taxonomy) [S]";
      tbl.appendChild(cap);
      const tb = document.createElement("tbody");
      for (const [id, name, what, tag] of A.calcCx.CX_LEVELS) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = id + " · " + name;
        const td1 = document.createElement("td");
        td1.textContent = what;
        const td2 = document.createElement("td");
        td2.textContent = tag;
        td2.className = "unit-cell";
        tr.append(th, td1, td2);
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      host.replaceChildren(tbl);
    },
  });

  // ------------------------------------------------------------- 3D TWIN ----
  function init3d() {
    const btn = document.getElementById("load3d");
    const stage = document.getElementById("twin-stage");
    const sel = document.getElementById("twin-variant");
    if (!btn || !stage || !sel) return;
    let loaded = false;
    function mount(variant) {
      const mv = document.createElement("model-viewer");
      mv.setAttribute("src", "assets/models/" + variant + ".glb");
      mv.setAttribute("poster", "assets/img/hero-" + variant + ".webp");
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("touch-action", "pan-y");
      mv.setAttribute("shadow-intensity", "0.6");
      mv.setAttribute("exposure", "1.05");
      mv.setAttribute("camera-orbit", "35deg 68deg 110%");
      mv.setAttribute("alt", "Procedural 3D model of one " + variant +
        " row group: compute racks, in-row CDUs and fabric racks generated from the generic variant data.");
      stage.replaceChildren(mv);
    }
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Loading viewer…";
      const s = document.createElement("script");
      s.src = "assets/vendor/model-viewer-umd.min.js";
      s.onload = () => {
        loaded = true;
        btn.textContent = "Interactive 3D loaded";
        btn.hidden = true;
        mount(sel.value);
      };
      s.onerror = () => { btn.textContent = "Viewer failed to load"; btn.disabled = false; };
      document.body.appendChild(s);
    });
    sel.addEventListener("change", () => {
      const img = document.getElementById("twin-hero-img");
      if (img) img.src = "assets/img/hero-" + sel.value + ".webp";
      if (loaded) mount(sel.value);
    });
  }

  // ------------------------------------------------------------------ BOOT ----
  function boot() {
    init3d();
    A.registerSections(A.SECTIONS);
    const yr = document.getElementById("footer-note");
    if (yr) yr.textContent = "Static client-side estimator · state lives in your URL fragment · " +
      "built from public sources accessed 2026-08-22";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
