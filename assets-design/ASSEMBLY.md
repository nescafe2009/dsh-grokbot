# Composition contract

Render order: `body → internal motif → blush → eyes → mouth → head accessory → eye accessory → state → level`.

At 36px, suppress the internal motif when the role has glasses, a magnifier or an oscilloscope visor. Suppress a generated head accessory when it intersects a fixed role prop. Never show both `crown-mini` and the chief's main crown.

State mapping: `idle`, `hover`, `thinking`, `working`, `success`, `error`, `waiting`. State changes must not change role color, ears or signature prop.

Level mapping: Lv1–3 no avatar ring; Lv4 `ring-gold`; Lv5 `ring-gold` + `crown-mini` (chief uses jewel treatment).

See `parts/ASSEMBLY.md` for deterministic custom-avatar mapping.
