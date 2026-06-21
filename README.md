# @bonniepdf/previewer

A framework-agnostic PDF preview component for [BonniePDF](https://www.bonniepdf.dev). It renders the **SVG pages** produced by `@bonniepdf/core` as a paginated, zoomable viewer with a thumbnail rail, page navigation, and a lazy "Download PDF" action. This is the component that https://bonniepdf.dev uses on it's example pages.

It ships as a **Shadow-DOM web component**, so the viewer is completely isolated from the host page's CSS. Embedded fonts always render correctly and there are no id collisions between instances.

## Why SVG, not a canvas/WASM renderer

BonniePDF generates the preview as vector SVG (one `<text>` per run, glyphs positioned by the font's real advance widths), so the preview is crisp at any zoom and needs no PDF rendering engine on the page. This component only *consumes* those SVG strings. It knows nothing about PDF generation.

## Install

```sh
npm install @bonniepdf/previewer @bonniepdf/core
```

## Usage — web component

```js
import '@bonniepdf/previewer/element'; // registers <bonnie-pdf-previewer>
import { svgStringsToPages } from '@bonniepdf/previewer';

const { pages, fontFaceCss } = await doc.generateSvgDocumentAsync();

const viewer = document.querySelector('bonnie-pdf-previewer');
viewer.load(svgStringsToPages(pages), {
  fontFaceCss,
  downloadFilename: 'report.pdf',
  // PDF bytes are generated only if the user clicks Download:
  pdfProvider: async () => URL.createObjectURL(new Blob([await doc.generateBytesAsync()], { type: 'application/pdf' })),
});
```

```html
<bonnie-pdf-previewer style="height: 80vh" label="Quarterly report"></bonnie-pdf-previewer>
```

Attributes: `show-thumbnails` (`"false"` to hide), `fit-mode` (`fit-page` | `fit-width`), `download-filename`, `label`.

## Usage — factory (any framework / light DOM)

```js
import { createPreviewer, svgStringsToPages } from '@bonniepdf/previewer';

const handle = createPreviewer(container, { fitMode: 'fit-width' });
handle.load(svgStringsToPages(pages), { fontFaceCss });
// later:
handle.dispose();
```

`createPreviewer` accepts a `ShadowRoot` or any element. The web component is a thin wrapper that calls it with its own shadow root.

## Performance

- **Windowed virtualisation** — only the pages/thumbnails near the viewport are mounted in the DOM; the rest are kept as lightweight placeholders. A 50-page document keeps ~6 pages live at a time instead of all 50.
- **Lazy PDF** — the full PDF is generated only when the user clicks Download (via `pdfProvider`), so previewing never pays for it.
- **Deterministic teardown** — `dispose()` (and the element's `disconnectedCallback`) disconnect every observer and listener.

## Theming

Colours resolve `--bpp-*` custom properties (which pierce the shadow boundary), falling back to a clean light theme. For example:

```css
bonnie-pdf-previewer {
  --bpp-accent: #16a34a;
  --bpp-bg-alt: #0b0f17;
  --bpp-text-1: #e5e7eb;
}
```

## License

MIT
