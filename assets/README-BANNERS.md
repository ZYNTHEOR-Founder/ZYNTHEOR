# README banner update

The animated SVG banner artwork is in:

- `assets/banner-top.svg`
- `assets/banner-bottom.svg`

To display it in `README.md`, replace the current banner image paths:

```html
<img src="./assets/banner-top.gif" ... />
```

with:

```html
<img src="./assets/banner-top.svg" alt="ZYNTHEOR — Vivid Intelligence. An animated emerald and violet neural core surrounded by glowing network nodes." />
```

And replace `./assets/banner-bottom.gif` with `./assets/banner-bottom.svg` (alt: `Intelligence Without Boundaries — an animated glowing neural horizon.`).

The SVG artwork uses CSS-only animation, includes a `prefers-reduced-motion` fallback, and has no script or external asset dependencies.
