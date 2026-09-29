# BonniePDF Previewer (`@bonniepdf/previewer`) — agent guide

A framework-agnostic PDF preview component: it renders the **SVG pages** produced by `@bonniepdf/core` as a paginated, zoomable viewer with a thumbnail rail, page navigation, and a lazy "Download PDF" action. Ships as a **Shadow-DOM web component** (`<bonnie-pdf-previewer>`), MIT-licensed.

> **This repository is public.** Keep this file, the README, and code comments useful to an outside contributor who has cloned only this repo.

[`README.md`](README.md) documents the full public API, attributes, and events — read it before changing the surface.

## Scope boundary (the thing to keep straight)

This component **consumes** SVG strings. It knows nothing about PDF generation, has no PDF parser, and carries no rendering engine — no pdfium, no WASM, no canvas rasteriser.

BonniePDF emits vector SVG (one `<text>` per run, glyphs positioned by real advance widths), so the preview is crisp at any zoom for free.

Do not add PDF parsing or a rendering engine here. If a preview looks wrong, the bug is almost always in the core SVG exporter, not in this viewer.

## Invariants

- **Shadow DOM isolation is the product.** The viewer must be immune to host-page CSS: embedded fonts render correctly, and multiple instances on one page must not collide on ids. Don't move styles out of the shadow root, and don't emit unprefixed global ids.
- **Theming is CSS custom properties only.** `<bonnie-pdf-previewer>` themes exclusively through `--bpdf-*` variables — there is no theme attribute and no JS theming API. The page area stays white **by design** (it's paper), regardless of the host's dark mode. Scrollbar styling requires the explicit `style-scrollbars` attribute.
- **PDF bytes are generated lazily.** `load(doc)` calls `generateBytesAsync()`, and a function passed as `pdf` runs, only when the user clicks Download. Never generate bytes eagerly on load.
- **`load()` is the single entry point.** It takes a `Document` (checked by shape, not class) or an SVG document export, or a promise of either. Don't add a second way in (a `document` property, a helper that prepares exports): hosts that generate elsewhere pass the export. The `load(pages, options)` form is deprecated, not removed, until the next major.
- **Object URLs the previewer creates, it revokes** — on the next load and on dispose. URLs a host passes in are the host's.
- **`@bonniepdf/core` is an optional peer and a type-free boundary.** Nothing in `src/` imports it at run time. The previewer's own structural types must keep accepting both core's objects and parsed JSON (a .NET export has plain-string severities, which core's enum types would reject).
- **`preference-key` state is read synchronously** before the shadow DOM is built, so returning visitors don't see panels flash through their default state. Keep it synchronous.
- **Two entry points.** `.` is the side-effect-free library (`createPreviewer`, plugins, types); `./element` registers the custom element and **is** a side effect (declared in `sideEffects`). Don't move registration into the main entry.

## Consumers

This component is consumed by the BonniePDF website, the desktop demo, and the [BonniePDF VS Code extension](https://github.com/bonniepdf/BonniePDF-VSCode). A change to the element's attributes, events, or `load()` signature is a breaking change for all of them — treat the public surface as an API, not an implementation detail.

## Build and test

```bash
pnpm build      # tsup + emitDeclarationOnly
pnpm test       # vitest (jsdom)
pnpm typecheck
```

`build` is two steps on purpose: `tsup` bundles, then `tsc --emitDeclarationOnly` writes the `.d.ts` files. Both outputs are published (`files: ["dist", "LICENSE"]`), so a change to either matters.

Tests run under **jsdom**, which does not implement Shadow DOM layout, `ResizeObserver`, or real font metrics. Assert structure and behaviour, not pixel geometry.

> This package depends on `@bonniepdf/core` as a peer. In the BonniePDF development workspace it resolves through a pnpm workspace link, and `@bonniepdf/core` must be built before this package's consumers run.
