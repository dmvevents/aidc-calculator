# AI Data Center Calculator

**Live site: https://dmvevents.github.io/aidc-calculator/**

A free, static, client-side set of calculators for first-pass AI data center sizing:

- **Power & electrical** — IT load → facility load at a chosen PUE → transformer / UPS / generator sizing.
- **Cooling** — heat load split (liquid vs air), CDU count, and warm-water-class feasibility.
- **Rack planner** — racks, pods, and floor area by GPU platform (GB200 NVL72, GB300 NVL72, liquid-cooled B200 HGX, air-cooled DGX B200).
- **Capex & $/GPU-hour** — order-of-magnitude cost bands from published industry benchmarks; you supply the power price.
- **Fiber & network** — fabric link / transceiver counts and optics power.
- **Commissioning checklist** — a generic deploy → energize → integrated-systems-test → GPU bring-up sequence.
- **3D rack/hall view** — an OpenUSD-derived digital-twin viewer (glTF) of a generic reference hall.

## Provenance discipline

Every default value is labeled:

- **[S] stated** — taken directly from a cited public source (NVIDIA docs, ASHRAE classes, vendor datasheets).
- **[D] derived** — computed from stated values; the formula is shown.
- **[A] assumed** — an engineering assumption you should replace with your own number.

All defaults are **generic, published figures**. Nothing here describes any specific project, site, or commercial deal. Every input can be overridden. See the in-app **Sources** page for the full citation list.

## Disclaimer

This tool produces first-pass, order-of-magnitude estimates for education and early feasibility screening. It is **not** engineering advice; do not use it as a substitute for a qualified MEP/electrical engineering firm, vendor reference designs, or utility studies.

## Development

Plain static HTML/CSS/JS — no build step, no backend, no tracking. Open `index.html` locally or serve the directory with any static file server.

## License

MIT — see [LICENSE](LICENSE).
