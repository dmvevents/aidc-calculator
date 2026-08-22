# AI Data Center Calculator

**Live site: https://dmvevents.github.io/aidc-calculator/**

Free, static, client-side calculators for first-pass AI data center sizing — now one page per calculator:

- **[Power & electrical](https://dmvevents.github.io/aidc-calculator/power.html)** — IT load → facility load at a chosen PUE → transformer / UPS / generator sizing, busway amperage check, optics power line item.
- **[Cooling](https://dmvevents.github.io/aidc-calculator/cooling.html)** — liquid/air heat split, CDU count, warm-water-class feasibility with a wet-bulb verdict (dry / wetted / infeasible).
- **[Rack planner](https://dmvevents.github.io/aidc-calculator/rack.html)** — racks, pods, floor area by GPU platform (GB200 NVL72, GB300 NVL72, liquid B200 HGX, air-cooled DGX B200).
- **[Capex](https://dmvevents.github.io/aidc-calculator/capex.html)** — order-of-magnitude cost bands from published benchmarks.
- **[TCO: colo + GPUs](https://dmvevents.github.io/aidc-calculator/tco.html)** — build or lease a colo, buy a GPU fleet: levelized and by-year **$/GPU-hour over time**, cumulative cost curve, refresh/depreciation, utilization and power-price sensitivity, break-even vs a market rental rate.
- **[Fiber & network](https://dmvevents.github.io/aidc-calculator/fiber.html)** — fabric link / transceiver counts and optics power.
- **[Commissioning](https://dmvevents.github.io/aidc-calculator/commissioning.html)** — deploy → energize → integrated-systems-test → GPU bring-up sequence and energy band.
- **[3D view](https://dmvevents.github.io/aidc-calculator/3d.html)** — OpenUSD-derived digital-twin viewer (glTF) of generic reference racks.

## Provenance discipline

Every default value is labeled: **[S] stated** (cited public source) · **[D] derived** (formula shown) · **[A] assumed** (replace with your own number). Each result exposes its full derivation chain. All defaults are generic, published figures — nothing here describes any specific project, site, or commercial deal. See **[Sources](https://dmvevents.github.io/aidc-calculator/sources.html)** for the citation list.

## Disclaimer

First-pass, order-of-magnitude estimates for education and early feasibility screening — **not** engineering advice. Verify with licensed engineers, vendor submittals, and your utility.

## Development

Plain static HTML/CSS/JS — no build step, no backend, no tracking, zero external loads (fonts and the 3D viewer are self-hosted/vendored). Open any page locally or serve the directory with a static file server.

## License

MIT — see [LICENSE](LICENSE).
