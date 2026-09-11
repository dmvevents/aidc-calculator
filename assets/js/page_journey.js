// Page config: ONE-CLICK GUIDED BUYER JOURNEY — the ordered narrative path
// through the six live calculator stages (GPUs→Land→Hall→Network→TCO→Risk)
// plus Export, seeded with ONE scenario that carries end-to-end. Composition
// only: every number is computed by the engines the per-page calculators run.
"use strict";
(function () {
  const A = globalThis.AIDC;
  const DB = globalThis.RACKDB;
  if (!A || !DB) return;

  const PLATFORM_DEFAULT = "gb200-nvl72";
  const TARGET_DEFAULT = 4608;  // 64 racks, 8 SUs for gb200-nvl72

  // Derive the scenario summary (racks/gpus/MW-IT) from the current scenario
  function scenarioSummary() {
    const scen = A.scenario && A.scenario.current ? A.scenario.current() : null;
    if (!scen || !scen.platform) return null;
    const derived = A.scenario.deriveScenario(scen.platform, scen.driver || "gpus", scen.target || TARGET_DEFAULT);
    return {
      platform: scen.platform,
      driver: scen.driver || "gpus",
      target: scen.target || TARGET_DEFAULT,
      racks: derived.racks,
      gpus: derived.gpus,
      it_mw: derived.it_mw
    };
  }

  function compute(kw) {
    // Route sizing through the canonical A.scenario.deriveScenario seam so ANY
    // driver (gpus | mw | racks) sizes correctly — reading scen.target raw as a
    // GPU count mis-sized every non-gpus scenario (card [162]).
    const scen = A.scenario && A.scenario.current ? A.scenario.current() : null;
    const plat = (scen && scen.platform) || kw.platform || PLATFORM_DEFAULT;
    let driver, target;
    if (scen && scen.target) {
      driver = scen.driver || "gpus";
      target = Number(scen.target);
    } else {
      driver = "gpus";
      target = (kw.gpus !== null && kw.gpus !== undefined) ? Number(kw.gpus) : TARGET_DEFAULT;
    }
    const d = A.scenario.deriveScenario(plat, driver, target);
    const racks = d.racks;
    const gpus_installed = d.gpus;
    const it_mw = d.it_mw;

    return A.res.result(
      "journey — guided buyer path through the six stages",
      "One scenario carried end-to-end: sizing → land → hall → network → TCO → risk → export",
      {
        platform: A.res.q(plat, "", "[S]", "rack-matrix variant"),
        target_gpus: A.res.q(gpus_installed, "", "[S]", "GPUs in this scenario"),
      },
      {
        racks: A.res.q(racks, "", "[D]", "deriveScenario(platform, driver, target)"),
        gpus_installed: A.res.q(gpus_installed, "", "[D]", "racks × GPUs/rack"),
        it_mw: A.res.q(it_mw, "MW-IT", "[D]", "racks × nameplate (compute basis)"),
      },
      [
        "Pick your platform and GPU count using the scenario bar above — your choices carry through every stage.",
        "Each stage opens its full calculator pre-filled with your scenario, so you can explore the details or adjust inputs.",
      ]
    );
  }

  A.SECTIONS = A.SECTIONS || [];
  A.SECTIONS.push({
    id: "journey",
    defaults: {
      platform: A.res.q(PLATFORM_DEFAULT, "", "[A]", "rack-matrix variant"),
      target_gpus: A.res.q(TARGET_DEFAULT, "", "[A]", "target GPU count"),
    },
    compute: compute,
    hero: "gpus_installed", heroLabel: "GPUs in this scenario", heroSrc: "sizing",
    fields: [],  // no editable fields — scenario bar handles input
    init: () => {
      // Journey-page-LOCAL scenario seed: if no scenario is set (out-of-box),
      // seed the recommended demo scenario so hero + links are coherent
      if (A.scenario && !A.scenario.current()) {
        const hashSeed = "s.platform=" + encodeURIComponent(PLATFORM_DEFAULT) +
                        "&s.driver=gpus&s.target=" + TARGET_DEFAULT;
        if (typeof window !== "undefined" && !window.location.hash) {
          window.location.hash = hashSeed;
        }
      }
    },
    derive: (r, kw) => {
      const plat = kw.platform || PLATFORM_DEFAULT;
      const v = DB[plat];
      const racks = r.outputs.racks.value;
      const gpus = r.outputs.gpus_installed.value;
      const it_mw = r.outputs.it_mw.value;
      const d = (val) => A.res.disp(val);
      return [
        "Scenario: " + plat + ", " + gpus + " GPUs",
        "Derived: " + racks + " racks × " + v.nameplate_kw + " kW = " + d(it_mw) + " MW-IT",
      ];
    },
    after: (r, kw) => {
      const plat = kw.platform || PLATFORM_DEFAULT;
      const target = kw.target_gpus || TARGET_DEFAULT;
      const v = DB[plat];
      const racks = r.outputs.racks.value;
      const gpus = r.outputs.gpus_installed.value;
      const it_mw = r.outputs.it_mw.value;
      const d = (val) => A.res.disp(val);

      // Build the scenario-carrying URL fragment
      const enc = encodeURIComponent;
      const hashPairs = A.scenario && A.scenario.hashPairs ? A.scenario.hashPairs() : [
        ["s.platform", plat],
        ["s.driver", "gpus"],
        ["s.target", String(target)]
      ];
      const hash = hashPairs.map(([k, v]) => k + "=" + enc(v)).join("&");
      const link = (page) => page + "#" + hash;

      // Calculate derived values for far-end pins
      const su = Math.max(1, Math.floor(racks / (v.racks_per_su || 8)));
      const packLoaded = !!(A.proposalPack && A.proposalPack.bytes);
      const packStageCount = packLoaded ? A.proposalPack.STAGES.length : 0;

      const steps = [
        {
          num: 1,
          title: "GPUs / Sizing",
          desc: "Define your fleet: " + gpus + " GPUs → " + racks + " racks → " + d(it_mw) + " MW-IT",
          page: null,  // current page, no link
          live: true
        },
        {
          num: 2,
          title: "Land",
          desc: "Site footprint: acres needed for this MW-IT load",
          page: link("land.html"),
          live: true
        },
        {
          num: 3,
          title: "Hall / Designs",
          desc: "3D reference design for " + plat,
          page: link("designs.html"),
          live: true
        },
        {
          num: 4,
          title: "Network / Fiber",
          desc: "Fabric plant: " + su + " scalable units, rails, trays",
          page: link("fiber.html"),
          live: true
        },
        {
          num: 5,
          title: "TCO",
          desc: "Total cost of ownership: levelized $/GPU-hr over 5 years",
          page: link("tco.html"),
          live: true
        },
        {
          num: 6,
          title: "Risk Explorer",
          desc: "116-mode failure-mode matrix and impact grid",
          page: link("risks.html"),
          live: true
        },
        {
          num: null,
          title: "Export",
          desc: "Summary sheet: Excel + PDF of this scenario's sizing (the integrated document is the Proposal Pack below)",
          page: null,  // handled by buttons
          live: true,
          isExport: true
        },
        // S4 (card AIDC#160): the integrated proposal pack — ONE workbook / ONE
        // PDF over every stage, composed by proposal_pack.js from the same
        // engines the stage pages run. Live only when that module is loaded;
        // otherwise the honest stub renders (gates reported, never faked).
        packLoaded ? {
          num: 7,
          title: "Proposal Pack",
          desc: "Integrated proposal document: " + packStageCount + " sections (sizing, land, hall power + cooling, " +
                "network, TCO, risk, capex + schedule appendices) in one workbook and one PDF for this scenario",
          page: null,  // handled by buttons
          live: true,
          isPack: true
        } : {
          num: null,
          title: "Proposal Pack",
          desc: "Integrated proposal document",
          page: null,
          live: false,
          badge: "Coming in S4 — per-page Excel/PDF ships today"
        },
        {
          num: null,
          title: "Schedule",
          desc: "Timeline: site-ready to acceptance",
          page: null,
          live: false,
          badge: "Coming in S5"
        },
      ];

      const host = document.getElementById("journey-steps");
      if (!host) return;

      const frag = document.createDocumentFragment();

      // Stages (hero is handled by the framework)
      for (const step of steps) {
        const div = document.createElement("div");
        div.className = "journey-step" + (!step.live ? " journey-step-stub" : "");

        if (step.num !== null) {
          const num = document.createElement("span");
          num.className = "journey-num";
          num.textContent = step.num;
          div.appendChild(num);
        }

        const content = document.createElement("div");
        content.className = "journey-content";

        const titleEl = document.createElement("h3");
        titleEl.textContent = step.title;
        content.appendChild(titleEl);

        if (step.badge) {
          const badge = document.createElement("span");
          badge.className = "journey-badge";
          badge.textContent = step.badge;
          content.appendChild(badge);
        }

        const descEl = document.createElement("p");
        descEl.textContent = step.desc;
        content.appendChild(descEl);

        if (step.live && step.page) {
          const linkEl = document.createElement("a");
          linkEl.href = step.page;
          linkEl.className = "journey-link";
          linkEl.textContent = "Open →";
          content.appendChild(linkEl);
        } else if (step.isExport) {
          const exportDiv = document.createElement("div");
          exportDiv.className = "journey-export";
          const xlsxBtn = document.createElement("button");
          xlsxBtn.textContent = "Excel";
          xlsxBtn.className = "journey-export-btn";
          xlsxBtn.onclick = () => {
            const bytes = A.exportBytes && A.exportBytes("journey", "xlsx");
            if (bytes && A.download) {
              A.download(bytes, "aidc-journey-pack.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            }
          };
          const pdfBtn = document.createElement("button");
          pdfBtn.textContent = "PDF";
          pdfBtn.className = "journey-export-btn";
          pdfBtn.onclick = () => {
            const bytes = A.exportBytes && A.exportBytes("journey", "pdf");
            if (bytes && A.download) {
              A.download(bytes, "aidc-journey-pack.pdf", "application/pdf");
            }
          };
          exportDiv.appendChild(xlsxBtn);
          exportDiv.appendChild(pdfBtn);
          content.appendChild(exportDiv);
        } else if (step.isPack) {
          const packDiv = document.createElement("div");
          packDiv.className = "journey-export journey-pack";
          const mk = (label, kind, mime) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.className = "btn journey-export-btn journey-pack-btn";
            b.id = "journey-pack-" + kind;
            b.onclick = () => {
              const bytes = A.exportBytes && A.exportBytes("journey-pack", kind);
              if (bytes && A.download) A.download(bytes, A.proposalPack.fileName(kind), mime);
            };
            return b;
          };
          packDiv.appendChild(mk("Proposal pack .xlsx", "xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
          packDiv.appendChild(mk("Proposal pack .pdf", "pdf", "application/pdf"));
          content.appendChild(packDiv);
        }

        div.appendChild(content);
        frag.appendChild(div);
      }

      host.replaceChildren(frag);
    },
  });

  A.boot();
})();
