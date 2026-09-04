# Deterministic 576-combination assembly

Hash the normalized UTF-8 display name with the project's existing stable hash. Consume independent bytes (or mixed 32-bit lanes) rather than repeatedly taking the same modulus.

```text
palette = PALETTES[h0 % 12]
mouth   = MOUTHS[h1 % 4]
inside  = INTERNALS[h2 % 3]
top     = TOPS[h3 % 4]
```

Pools:

- palettes: blueberry, mint, apricot, grape, aqua, coral, slate, leaf, rose, lilac, honey, cream
- mouths: smile, o, w, wave
- internals: none, bubbles, sparkles
- tops: none, tuft, round ears, pointed ears

Normalize names with trim + Unicode NFC. An unchanged name must always produce the same tuple. Keyword-family avatars take precedence over hashing. When glasses/magnifier/visor are present, omit internal motifs to keep the 36px face readable.

`parts-library.svg` is a visual sprite sheet and coordinate reference; integration may translate its groups into inline JSX paths.
