// Page config: topology-designer.html — the leaf-spine(/core) fabric designed
// and exported. Registers a section on the SAME calc_fiber engine (id
// "topology"), renders the per-rail diagram + §6.8 oversubscription dials +
// legend from topologyviews.js, and wires the two deal-free downloads (JSON /
// CSV) built from the live engine run. Counts recompute live; ends with
// A.boot().
"use strict";
(function () {
  const A = globalThis.AIDC;
  A.SECTIONS = A.SECTIONS || [];

  // deal-free download: read the CURRENT engine run at click time, build the
  // structural artifact, ship it as a Blob + <a download> (no SVG palette to
  // preserve — this is a JSON/CSV graph, not a drawing).
  function wireExport(btnId, kind) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const st = A.appState && A.appState.results && A.appState.results["topology"];
      if (!st) return;
      const o = st.res.outputs, i = st.res.inputs, TV = A.topologyviews;
      const base = TV.exportTitle(i);
      let text, type, name;
      if (kind === "json") {
        text = JSON.stringify(TV.topologyJSON(o, i), null, 2);
        type = "application/json"; name = base + ".json";
      } else {
        text = TV.topologyCSV(o, i);
        type = "text/csv"; name = base + ".csv";
      }
      const url = URL.createObjectURL(new Blob([text], { type: type }));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }

  A.SECTIONS.push({
    id: "topology",
    defaults: A.calcFiber.DEFAULTS,
    compute: (kw) => A.calcFiber.plant(kw),
    hero: "links_fabric_total", heroLabel: "compute-fabric links", heroSrc: "gb200-ra",
    fields: [
      { key: "su", label: "scalable units", src: "legend", step: 1, min: 1 },
      { key: "tiers", label: "fabric tiers", src: "dossiers", type: "select", numeric: true,
        options: [[3, "3 (leaf/spine/core)"], [2, "2 (leaf/spine)"]] },
      { key: "rails", label: "rails", src: "gb200-ra", step: 1, min: 1 },
      { key: "racks_per_su", label: "racks per SU", src: "gb200-ra", step: 1, min: 1 },
      { key: "trays_per_rack", label: "compute trays / rack", src: "gb200-ra", step: 1, min: 1 },
      { key: "leaves_per_su_rail", label: "leaves / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "spines_per_su_rail", label: "spines / SU / rail", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "links_leaf_spine", label: "links / leaf-spine pair", src: "gb200-ra", step: 1, min: 1, advanced: true },
      { key: "cores_per_rail", label: "cores / rail", src: "dossiers", step: 1, min: 0, advanced: true },
      { key: "links_spine_core", label: "links spine→core", src: "dossiers", step: 1, min: 0, advanced: true },
    ],
    derive: (r, kw) => {
      const d = (v) => A.res.disp(v);
      const i = r.inputs, o = r.outputs;
      return [
        "§6.1 · switches = SU×rails×(leaves|spines) + rails×cores = " +
          i.su.value + "×" + i.rails.value + "×" + i.leaves_per_su_rail.value + " leaf = " +
          d(o.switches_leaf.value) + " · " + i.su.value + "×" + i.rails.value + "×" +
          i.spines_per_su_rail.value + " spine = " + d(o.switches_spine.value) +
          (Math.trunc(Number(i.tiers.value)) >= 3
            ? " · " + i.rails.value + "×" + i.cores_per_rail.value + " core = " + d(o.switches_core.value)
            : " · no core (2-tier)"),
        "§6.8 · oversub leaf " + d(o.oversub_leaf.value) + " · spine " + d(o.oversub_spine.value) +
          " · fabric " + d(o.oversub_fabric.value) + ":1 → delivered bisection " +
          d(o.bisection_ratio.value) + "× ideal · 1:1 non-blocking " + d(o.fabric_non_blocking.value),
      ];
    },
    after: (r) => {
      const dg = document.getElementById("tp-diagram");
      if (dg) A.topologyviews.topologyDiagram(dg, r);
      const dl = document.getElementById("tp-dials");
      if (dl) A.topologyviews.topologyDials(dl, r);
      const lg = document.getElementById("tp-legend");
      if (lg) A.topologyviews.topologyLegend(lg, r);
      A.designs.liveLink("tp-open-fiber", "fiber.html");
    },
  });

  wireExport("tp-dl-json", "json");
  wireExport("tp-dl-csv", "csv");
  A.boot();
})();
