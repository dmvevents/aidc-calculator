// Page config: rack planner — section extracted 1:1 from the v1 single-page bundle
// (sections_core.js); formulas untouched, engine unchanged. Ends with A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  const d = (v) => A.res.disp(v);
  A.SECTIONS = A.SECTIONS || [];

  // ----------------------------------------------------------------- RACK ----
  const VARIANT_ORDER = ["gb200-nvl72", "gb300-nvl72", "b200-liquid", "dgx-b200-aircooled-2su"];
  const rackOf = (name) => {
    const v = globalThis.RACKDB[name];
    return { gpus_per_rack: v.gpus_per_rack, nameplate_kw: v.nameplate_kw,
             liquid_kw: v.liquid_kw || 0, air_kw: v.air_kw || 0, weight_kg: v.weight_kg,
             footprint_m2: v.footprint_m2, racks_per_su: v.racks_per_su, rails: v.rails };
  };
  A.currentVariant = () => {
    const sel = document.getElementById("rack.variant");
    return (sel && sel.value) || "gb200-nvl72";
  };

  A.SECTIONS.push({
    id: "rack",
    defaults: A.calcRack.DEFAULTS,
    compute: (kw) => {
      const name = kw.variant || "gb200-nvl72";
      const k2 = Object.assign({}, kw);
      delete k2.variant;
      return A.calcRack.plan(rackOf(name), k2);
    },
    hero: "it_total_mw", heroLabel: "total IT load", heroSrc: "variants",
    unitToggles: ["area"],
    fields: [
      { key: "variant", label: "rack platform", src: "variants", type: "select", value: "gb200-nvl72",
        options: VARIANT_ORDER.map((n) => [n, globalThis.RACKDB[n].platform]) },
      { key: "gpus", label: "target GPU count", src: "legend", step: 8, min: 1 },
      { key: "support_frac", label: "support-IT frac", src: "refdesign", step: 0.005, min: 0, advanced: true },
      { key: "pue", label: "PUE target", src: "dsx-kpi", step: 0.01, min: 1, advanced: true },
      { key: "m2_per_rack", label: "white space / rack", src: "refdesign", step: 1, min: 1, advanced: true },
      { key: "floor_rating_kpa", label: "floor rating", src: "refdesign", step: 1, min: 1, advanced: true },
      { key: "racks_per_path", label: "racks per busway path", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "dist_v", label: "distribution voltage", src: "aif-template", step: 1, min: 100, advanced: true },
      { key: "pf_rack", label: "rack power factor", src: "gb300-ra", step: 0.01, min: 0.5, max: 1, advanced: true },
      { key: "breaker_factor", label: "continuous factor", src: "nec", step: 0.05, min: 0.5, max: 1, advanced: true },
      { key: "busway_rating_a", label: "busway rating", src: "starline", step: 50, min: 100, advanced: true },
      { key: "busway_product_ceiling_a", label: "busway product ceiling", src: "starline", step: 50, min: 100, advanced: true },
    ],
    derive: (r, kw) => {
      const i = r.inputs, o = r.outputs;
      return [
        "racks = ⌈GPUs ÷ GPUs/rack⌉ = ⌈" + d(i.gpus.value) + " ÷ " + d(i["rack.gpus_per_rack"].value) + "⌉ = " + o.racks.value,
        "IT = racks × kW + support = " + o.racks.value + " × " + d(i["rack.nameplate_kw"].value) + " × " +
          d(1 + i.support_frac.value) + " = " + d(o.it_total_mw.value) + " MW-IT → facility " + d(o.facility_mw.value) + " MW",
        "density = " + d(o.gpus_per_mw.value) + " GPUs/MW · " + d(o.racks_per_mw.value) + " racks/MW · " +
          d(o.kw_per_gpu.value) + " kW/GPU",
        "F17 · I_rack = " + d(i["rack.nameplate_kw"].value) + "×1000 ÷ (1.732×" + d(i.dist_v.value) + "×" +
          d(i.pf_rack.value) + ") = " + d(o.rack_current_a.value) + " A · row ×" + o.racks_per_path_used.value +
          " = " + d(o.busway_continuous_a.value) + " A ÷ 0.8 → ≥" + d(o.busway_min_rating_a.value) + " A " +
          (o.busway_rating_ok.value ? "✓ within " + d(i.busway_rating_a.value) + " A" : "✕ over " + d(i.busway_rating_a.value) + " A"),
        "floor = " + d(i["rack.weight_kg"].value) + " kg × 9.81 ÷ " + d(i["rack.footprint_m2"].value) + " m² = " +
          d(o.floor_pressure_kpa.value) + " kPa vs " + d(i.floor_rating_kpa.value) + " rating",
      ];
    },
    init: () => {
      // comparison matrix (static per page load — the data backbone visualised).
      // Every cell wears the [S]/[D]/[A] chip the variant YAML gives that value
      // (rackdata.js labels, extracted at build time); † marks a value whose
      // label carries a provenance caveat — the footnotes below the table.
      const host = document.getElementById("rack-matrix");
      if (!host) return;
      const weakest = (...ls) => {
        const rank = { "[S]": 0, "[D]": 1, "[A]": 2 };
        let out = null;
        for (const l of ls) if (l && (out === null || rank[l] > rank[out])) out = l;
        return out;
      };
      const uTag = (s) => (s && /\[(S|D|A)\]\s*$/.test(s)) ? "[" + s.match(/\[(S|D|A)\]\s*$/)[1] + "]" : null;
      const uText = (s) => s ? s.replace(/\s*\[(S|D|A)\]\s*$/, "") : s;
      // [row label, value getter, chip getter, field key for footnotes]
      const rows = [
        ["GPUs / rack", (v) => v.gpus_per_rack, (v) => v.labels.gpus_per_rack, "gpus_per_rack"],
        ["kW / rack (nameplate)", (v) => v.nameplate_kw, (v) => v.labels.nameplate_kw, "nameplate_kw"],
        ["Transient ceiling EDPP2 (kW)", (v) => v.edpp2_kw || "—", (v) => v.edpp2_kw ? v.labels.edpp2_kw : null, "edpp2_kw"],
        ["Cooling", (v) => v.cooling, (v) => v.labels.liquid_pct, "liquid_pct"],
        ["Liquid / air per rack (kW)", (v) => (v.liquid_kw || 0) + " / " + v.air_kw,
          (v) => weakest(v.labels.liquid_kw, v.labels.air_kw), "liquid_kw"],
        ["Weight (kg)", (v) => v.weight_kg, (v) => v.labels.weight_kg, "weight_kg"],
        ["Height (mm / U-class)", (v) => v.height_mm + (v.u_class ? " · " + uText(v.u_class) : ""),
          (v) => weakest(v.labels.height_mm, uTag(v.u_class)), "height_mm"],
        ["Floor pressure (kPa)", (v) => v.floor_kpa, () => "[D]", null],
        ["Racks / MW", (v) => v.racks_per_mw, () => "[D]", null],
        ["GPUs / MW", (v) => v.gpus_per_mw, () => "[D]", null],
        ["NVLink domain (GPUs)", (v) => v.nvlink_domain, (v) => v.nvlink_label, null],
        ["Scale-out rails", (v) => v.rails, (v) => v.labels.rails, "rails"],
        ["Fabric", (v) => v.scale_out, (v) => v.labels.scale_out, "scale_out"],
        ["Racks / SU", (v) => v.racks_per_su, (v) => v.labels.racks_per_su, "racks_per_su"],
      ];
      const ROW_LABEL = {};
      for (const [label, , , field] of rows) if (field) ROW_LABEL[field] = label;
      const noted = (v, field) => field && (v.matrix_notes || []).some((n) => n[0] === field);
      const tbl = document.createElement("table");
      tbl.className = "matrix";
      const cap = document.createElement("caption");
      cap.textContent = "variant matrix — every value wears its own label from the " +
        "variant YAML ([S] stated · [D] derived · [A] assumed); † = provenance note below";
      tbl.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.appendChild(document.createElement("th"));
      for (const n of VARIANT_ORDER) {
        const th = document.createElement("th");
        th.textContent = globalThis.RACKDB[n].platform;
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const [label, get, chip, field] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
        for (const n of VARIANT_ORDER) {
          const v = globalThis.RACKDB[n];
          const td = document.createElement("td");
          td.className = "num";
          td.append(String(get(v)));
          const l = chip(v);
          if (l) td.append(" ", A.chipEl(l, "variants"));
          if (noted(v, field)) {
            const sup = document.createElement("sup");
            sup.textContent = "†";
            td.appendChild(sup);
          }
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      // provenance footnotes (†) — the caveats the YAML labels carry, per variant
      const notes = document.createElement("ul");
      notes.className = "notes";
      for (const n of VARIANT_ORDER) {
        const v = globalThis.RACKDB[n];
        for (const [field, text] of v.matrix_notes || []) {
          const li = document.createElement("li");
          const b = document.createElement("strong");
          b.textContent = "† " + v.platform + " · " + (ROW_LABEL[field] || field) + ": ";
          li.append(b, text);
          notes.appendChild(li);
        }
      }
      host.replaceChildren(tbl, notes);
    },
    after: () => {
      // keep the 3D-page link pointed at the chosen variant (viewer is 3d.html)
      const link = document.getElementById("rack-3d-link");
      if (link) link.href = "3d.html#variant=" + A.currentVariant();
    },
  });

  A.boot();
})();
