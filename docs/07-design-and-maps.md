# 07 — Design System, Mascots, Maps

## Design language: "Sunlit Greenhouse"
Bright, optimistic, botanical, and precise: warm daylight backgrounds, leafy greens, citrus accents, soft shadows, rounded-but-confident shapes. Not pastel-mush, not corporate gov, not dark newsroom.

**Color**
- Canvas: warm cream `#FFFBF2`; ink: deep forest `#16302B`.
- Brand: sunrise coral/amber + leaf green + sky teal.
- **Party/outcome colors** are deliberately separate from brand and *never carry meaning alone*: Democratic = blue family, Republican = red family, Other/Independent = purple, Uncalled = warm gray, plus **pattern + label + icon** encodings (stripes/dots/solid) for color-vision safety. Forecast vs Endorsement are distinguished by *shape language* (solid fill vs outlined ring/hatch), not hue.
- Light theme default; considered dark theme ("moonlit greenhouse") later. All text ≥ AA contrast.

**Type:** a characterful display face for headings (e.g., a rounded/humanist serif or soft grotesk) + a highly legible UI sans; tabular numerals for polling data. Final faces chosen after contrast/performance testing (self-hosted subsets, `font-display: swap`).

**Motion:** leaves sway only on idle hero/empty states; cards swipe/settle; map transitions are eased fly-tos; all gated by reduced-motion and the Lite performance tier.

## Mascot & illustration system
A small ecosystem so mascots feel like *product*, not stock:
- **Sprig** (the guide): a sprouting seedling with expressive leaves — tour, first-visit, onboarding.
- **Tally** (the counter): a friendly bee/ladybug-like character for loading, counting, saved/complete moments.
- **Dusk** (the closer): a gentle owl for post-shutdown / results-night states.
Characters are built from a shared shape kit (leaf, petal, circle, curve) as inline SVG with a handful of poses and states, so they're light, themeable, animatable, and bundle-cheap. Used in: tour, loading, empty states, "come back later" (Sprig tucks a leaf-bookmark), forecast complete (celebration), closed state (Dusk), About. Not on every screen.

## Page families
- **2026 app:** dense but airy command-center layout.
- **About:** storytelling scroll with the mascots and local-time shutdown explainer.
- **Blog:** editorial layout, magazine rhythm.
- **Contact / Terms / Privacy:** warm, readable, still on-brand (e.g., Terms with a plain-English margin summary).

## Map architecture
**Choice: MapLibre GL JS + PMTiles vector tiles** (alternatives: D3-SVG — too heavy for ~435 districts with smooth pan/zoom, and canvas/Deck.gl — more than needed).
- Layers: state fills, district fills (visible from zoom ≈ 4), borders, labels, race-status symbols, selection/hover highlights, optional cartogram inset for tiny/dense districts.
- Data-driven styling via `feature-state` keyed by race id: forecast calls, endorsement choices, polling lean, actual results, differences.
- **Views:** Forecast · Endorsement · Polling lean · Competitiveness · Actual · Forecast-vs-Actual diff · Forecast-vs-Endorsement diff (Reconcile).
- **Interactions:** pan, zoom, pinch, keyboard navigation, click-to-open race card, hover tooltip (debounced), filter chips mirrored from the sidebar scope, fit-to-scope button, reset view, minimap for AK/HI/territories, tabular alternative.
- Mobile: bottom sheet for race detail; touch-friendly hit areas via invisible buffered click layer for small districts.
- **Boundary correctness:** per-state `boundary_versions` (see risk R1 on mid-decade redistricting). The app displays "district lines verified as of …".
- Basemap: none or a very quiet custom background (no third-party tile costs/keys); attribution displayed.

## Candidate imagery
Component renders `verified photo → neutral botanical placeholder → initials`. Same dimensions in all three so layout never shifts; credit/license line available on hover/focus.
