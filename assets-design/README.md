# DSH Jelly Agents · H1-EVO

> **Current review status:** all 18 files in `avatars/` are final high-fidelity color traces of the approved `references/roles-01...06.png` artwork. All 18 have passed 128px and native 36px visual review.

Pure SVG art package for ZCode integration. No runtime or source files are modified.

## Visual model

Each avatar is composed in three independent layers:

1. **Identity** — role silhouette, candy gradient, face and signature prop.
2. **State** — optional overlay from `states/`; identity never changes.
3. **Level** — optional ring/crown/badge from `rating/`.

The 18 fixed avatars use `viewBox="0 0 64 64"`. Test at 64px and 36px. Rating icons are designed for both 16px and 48px. All gradient/filter IDs are file-prefixed.

## Layer priority

Face > role prop > state overlay > level overlay. At 36px, show at most one state symbol and one level decoration. For Lv5 chief, keep the main crown and use the jewel-only corner treatment rather than a second full crown.

## Motion guidance

- Hover: 180ms squash to `scale(1.04, .97)`, then settle.
- Thinking/working: 900–1200ms low-amplitude loop.
- Success/error: one 220–280ms response, never an infinite alert.
- Respect `prefers-reduced-motion`; use the static overlay only.

## Files

- `references/`: approved high-fidelity role artwork, six source sheets, plus final 128px and native 36px SVG contact sheets.
- `avatars/`: 18 final high-fidelity SVG identities, ready for integration.
- `parts/`: deterministic custom-avatar parts and assembly contract (576 combinations).
- `states/`: seven interaction overlays.
- `rating/`: badges, stars, ring, crown, EXP endpoint and feedback icons.

SVGs use no external fonts, images, emoji, scripts or dependencies. Final validation also checks XML parsing, unique IDs, `viewBox="0 0 64 64"` on every avatar, and absence of embedded raster/script/foreign-object content.
