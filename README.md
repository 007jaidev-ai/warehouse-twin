# Picking Floor Digital Twin: 3D Warehouse Slotting Game (PS 4.2)

A browser-based 3D digital twin of a picking floor, driven by **real orders** from the
Online Retail II dataset (UCI, CC BY 4.0). The player re-slots products and the twin
**replays exactly the same month of orders** to measure how much walking is saved.

## Run it

```bash
# 1. data (only needed once; output is already committed in web/public/data)
cd preprocess
pip install pandas openpyxl
python preprocess.py --month 2010-11 --top 100

# 2. reference layouts (Original, ABC, Affinity, Optimized)
cd ../web
npm install
npm run optimize            # ~1 min, writes public/data/layouts.json

# 3. app
npm run dev                 # development
npm run build && npm run preview   # offline demo build -> http://localhost:4173
```

On Windows you can double-click `start-demo.bat`, which builds and serves the app offline.

URL presets for the demo screen: `?view=affinity&batch=1&traffic=1&play=1&speed=60`.
Keyboard: `Space` play/pause · `1`–`5` layouts · `H` floor heatmap · `B` batch mode · `I` IoT mode · `O` optimizer · `Esc` deselect.

## Data pre-processing (`preprocess/preprocess.py`)

| Step | Lines |
|---|---|
| Order lines in Nov 2010 | 76,584 |
| Cancelled invoices (`C…`) removed | −1,192 |
| Non-product codes (POST, DOT, M, BANK CHARGES, AMAZONFEE, gift_…) removed | −282 |
| Qty ≤ 0, price ≤ 0 or missing description removed | −353 |
| Clean lines / distinct products | 74,757 / 3,018 |
| **Top 100 products** (by number of pick lines) | 22.1% of all picks |
| **Orders replayed** (lines on the top 100) | **2,293 orders, 16,225 lines, 7.1 lines/order** |

Outputs `web/public/data/products.json` (code, name, picks, units), `orders.json`
(invoice, timestamp, [product, qty] lines) and `stats.json`.

## Warehouse layout (our design)

| Parameter | Value |
|---|---|
| Aisles | 5, racks on both sides |
| Slots | 5 aisles × 2 sides × 10 bays = **100 slots** (one product each) |
| Bay width / rack depth / height | 2.0 m / 1.0 m / 2.2 m |
| Aisle width | 3.0 m |
| Cross-aisles | front and back, 3.0 m |
| Packing dock | front centre, in line with aisle 3 |
| Walking speed | 1.2 m/s |
| Pick time | 10 s per order line |
| Batch picking | 4 consecutive orders per trip |

**Routing follows aisles, never through racks.** The floor is a graph (aisle points, aisle
ends, dock). All-pairs shortest paths come from Floyd–Warshall. Each trip is dock → picks → dock,
ordered by nearest-neighbour and improved with 2-opt. The same deterministic code (`web/src/sim/`)
scores layouts in the browser and in the offline optimizer, so the numbers match exactly.

## The layout ladder

| Layout | Idea |
|---|---|
| **Original** | Products shelved in stock-code order: the "as received" starting point |
| **ABC** (intuition) | Most-picked products in the slots nearest the dock |
| **Affinity** (data insight) | Slots filled nearest-first; each slot's product chosen by `picks + w · co-picks with products already in that aisle`, so items bought together share an aisle. `w` is tuned by replay. |
| **Optimized** (algorithm) | Simulated annealing over slot swaps; objective = exact replay distance; only orders containing a swapped product are re-routed (delta evaluation) |
| **You** | Click two racks to swap; scoreboard updates instantly |

### Results: full month, one order per trip

| Layout | km / month | m / order | time / order | walking saved |
|---|---|---|---|---|
| Original | 218.1 | 95.1 | 2:30 | – |
| ABC | 212.7 | 92.8 | 2:28 | 2.5% |
| Affinity | 193.4 | 84.3 | 2:21 | 11.3% |
| Optimized | 183.7 | 80.1 | 2:18 | 15.8% |

With batch picking (4 orders/trip), total walking drops from 218 km to 88 km. Slotting
then matters less (Optimized −6.3%), because one trip already sweeps most of the floor.

**Smart batching** (layout-aware): each trip takes the next order plus the 3 orders, from the next 12
waiting, whose aisles overlap it most. Same orders, 12–15% less walking than consecutive batches:

| Layout | Batch of 4 (km) | Smart batch (km) | vs Original, 1 order/trip |
|---|---|---|---|
| Original | 88.2 | 77.6 | −64.4% |
| Optimized | 82.7 | 70.1 | **−67.9%** |

Slotting and batching stack: the best layout plus smart batching walks 70 km instead of 218 km.

**Hold-out check.** We built the layouts only from orders before 22 Nov (1,527 orders) and tested
them on the final week (766 orders) they never saw. Results vs Original: ABC −1.9%,
Affinity −11.2%, Optimized −13.9%. The gains carry over to future orders.

**Key finding.** ABC, the textbook intuition, saves only ~2.5% here. Orders average 7 lines,
so the picker still visits most aisles. Using *which products are bought together* saves 4–5× more.

## Features

- 3D floor: racks, aisles, dock, animated picker with cart, live distance, time and order counters
- Real order card: invoice number, timestamp and lines, ticked off as they are picked
- Live comparison: "same orders on Original" counter during replay
- Rack-visit heatmap (rack colours) and floor-traffic heatmap (walking passes per aisle section)
- Batch-picking mode
- Game mode with swap, undo, "beats ABC / Affinity / optimizer" badges, and co-purchase hints (◆)
- Local leaderboard (saved in the browser; click an entry to load that layout)
- **Live optimizer**: simulated annealing runs in a Web Worker on *your* layout (24,000 swaps, ~15 s);
  racks recolour and the scoreboard updates as it improves, with a convergence chart against ABC / Affinity / Optimized.
  Shares `src/sim/anneal.js` with the offline optimizer.
- **Smart batching** mode (see above)
- **IoT sensor mode**: the replay emits the events real devices would stream: RFID dock gate (cart out/in),
  UWB cart tag positions, pick-to-light ON/OFF per slot (green lamps on the racks), barcode pick confirmations.
  Live feed on screen; download the log as JSON Lines.

URL: `?iot=1`, `?batch=smart`, `?view=player&opt=1`.

**Planned:** several pickers with aisle congestion.

## Design

One visual system across the app, the deck and the poster: a **"warehouse ledger"** light theme.
Bone-paper background (`#F1EADB` / `#F3EEE3`), graphite ink, a single signal red (`#E0442A`) for the
number that matters, cobalt for routes, moss for savings. Type is **Bahnschrift** (Windows' DIN signage
face, so it is on every presenter laptop) with Cascadia Mono for data. Panels are hairline-ruled index
cards with a hard offset shadow, the order card is a perforated pick ticket, and the IoT stream reads
like printed tape. Rack colour uses one sequential ramp everywhere (sand → sage → teal → amber → red,
rare → very frequent), so a product keeps its colour across layouts, slides and print.

## Blender pipeline (`build/blender/`)

The 3D floor is modelled in Blender from **the same geometry and layout data** as the simulation:

```bash
node build/blender/dump_scene.mjs        # slots, aisles, per-layout visit counts, one sample order route -> scene.json
# in Blender (5.x): exec(open(r"build/blender/scene.py").read()); build(); bake_floor(); render_all()
python build/blender/post.py             # floor bake -> web/public/tex/floor.jpg (159 KB)
python build/prep_assets.py              # renders + app shots -> build/img, data-drawn plan diagrams
```

- **Baked floor** (`bake_floor`): a top-down Cycles render in which racks, cartons and the dock cast
  contact shadows and AO onto the floor but are invisible to the camera. Aisle numbers, safety lines,
  bay ticks and the dock hatching are baked in too. The app draws it as one unlit textured quad, so it
  needs **no realtime shadow maps** and ~20 fewer floor meshes.
- **Hero renders** (`render_all`): axonometric renders of every layout, a close-up, and one real order
  (invoice 532964, 9 lines) routed on Original vs Optimized: 143 m through 5 aisles vs 62 m through 2.

## Performance and robustness

- **Render on demand**: the WebGL loop only draws when something changes (camera, replay, hover,
  flashes). Measured: 0 draw calls while idle (was a full frame every vsync).
- Baked lighting, instanced racks/beams/decks/cartons, Lambert materials, pixel ratio capped at 1.75,
  hover raycasts throttled to one per frame, shared geometry/materials for the 100 lamp/marker meshes.
- The replay snapshots its trip list and layout, so the live optimizer, mode changes or swaps can never
  desync a trip in progress. Manual swaps and undo are refused while the optimizer runs; worker errors
  stop it cleanly. Leaderboard entries from `localStorage` and URL parameters are validated.
- Stress test (headless Edge via puppeteer): full month at 300× in all three trip modes, layout/mode/
  overlay switching mid-replay, 40 random rack clicks, optimizer during playback, start/stop/reset,
  corrupt leaderboard data, hostile URL params: **0 JS errors**, and the replay totals match the
  scoreboard to the metre (218.1 / 88.2 / 77.6 km).

## Deck and poster

```bash
python build/prep_assets.py
python build/build_deck.py      # -> ElectroSolve_2026_Warehouse_Digital_Twin.pptx (11 slides, Morph transitions)
powershell -File build/render.ps1   # optional: PNG of every slide via PowerPoint
msedge --headless --no-pdf-header-footer --print-to-pdf=ElectroSolve_2026_A3_Poster.pdf build/poster.html
```

## Stack

Python + pandas (pre-processing) · Node (optimizer) · Three.js 0.169 + Vite 5 (app) · Blender 5 /
Cycles (floor bake and renders) · python-pptx (deck). The app runs fully offline.
