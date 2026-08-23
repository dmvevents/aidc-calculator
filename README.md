# AI Data Center Calculator

**Live site: https://dmvevents.github.io/aidc-calculator/**

Free, static, client-side tools for first-pass AI data center sizing — calculators, engineering views, and a 3D reference hall.

## Calculators
- **[Power & electrical](https://dmvevents.github.io/aidc-calculator/power.html)** — IT load → facility load, transformer/UPS/genset sizing, busway amperage check, optics power line item.
- **[Cooling](https://dmvevents.github.io/aidc-calculator/cooling.html)** — liquid/air split, CDU count, warm-water-class feasibility with a wet-bulb verdict.
- **[Rack planner](https://dmvevents.github.io/aidc-calculator/rack.html)** — racks, pods, floor area by GPU platform (GB200/GB300 NVL72, liquid B200, air-cooled DGX).
- **[Capex](https://dmvevents.github.io/aidc-calculator/capex.html)** — cost bands from published benchmarks, with spares & named-risk contingency.
- **[TCO: colo + GPUs](https://dmvevents.github.io/aidc-calculator/tco.html)** — build or lease + GPU fleet: levelized and by-year $/GPU-hour, cumulative curve, refresh, sensitivity, break-even.
- **[Fiber & network](https://dmvevents.github.io/aidc-calculator/fiber.html)** — fabric link/transceiver counts and optics power.
- **[Commissioning](https://dmvevents.github.io/aidc-calculator/commissioning.html)** — deploy → energize → IST → GPU bring-up, with the commissioning-energy band.

## Engineering views
- **[Reference designs](https://dmvevents.github.io/aidc-calculator/designs.html)** — electrical one-line, cooling schematic, hall plan; interactive, downloadable SVG.
- **[Fiber layout](https://dmvevents.github.io/aidc-calculator/fiber-layout.html)** — logical spine-leaf topology with live-computed counts + physical tray routing.
- **[Risks](https://dmvevents.github.io/aidc-calculator/risks.html)** — a filterable explorer over 116 sourced failure modes (system × phase × detection).
- **[3D view](https://dmvevents.github.io/aidc-calculator/3d.html)** — generic reference hall with view presets (site → building → rows → rack → cooling → power), layer toggles, and annotated hotspots.

## Provenance discipline
Every default is labeled **[S] stated** (cited public source) · **[D] derived** (formula shown) · **[A] assumed** (replace it). Results expose their full derivation chain. All defaults are generic, published figures — no project- or deal-specific data. See **[Sources](https://dmvevents.github.io/aidc-calculator/sources.html)**.

## Disclaimer
First-pass, order-of-magnitude estimates for education and early feasibility screening — **not** engineering advice. Verify with licensed engineers, vendor submittals, and your utility.

## Development
Plain static HTML/CSS/JS — no build step, no backend, no tracking, zero external loads (fonts and the 3D viewer are vendored). Open any page locally.

## License
MIT — see [LICENSE](LICENSE).
