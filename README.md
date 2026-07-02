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

## Structure view (plugin)

The previewer ships a **plugin system** so optional features layer on without
touching the core viewer — with no plugins registered, behaviour is exactly as
documented above. The first-party `structureView()` plugin renders the document's
**layout structure tree** in a side panel; selecting a node highlights the
rectangle(s) that element occupied (one per page it spans) as a translucent
overlay on top of the SVG. The SVG itself is never modified.

Each tree row shows the element's size (width × height in points; a `· Np`
suffix marks nodes that span multiple pages). Selection is **two-way**: click a
row to highlight it on the page, or click an element **on the page** to select
the deepest node under the cursor in the tree.

It consumes the layout snapshot from `@bonniepdf/core`:

```js
import { createPreviewer, structureView, svgStringsToPages } from '@bonniepdf/previewer';

// Ask core to capture the layout while rendering the SVG:
const { pages, fontFaceCss, snapshot } =
  await doc.generateSvgDocumentAsync({ captureLayout: true });

const handle = createPreviewer(container, { plugins: [structureView()] });
handle.load(svgStringsToPages(pages), { fontFaceCss, snapshot });
```

Web-component opt-in via the boolean `structure-view` attribute:

```html
<bonnie-pdf-previewer structure-view style="height: 80vh"></bonnie-pdf-previewer>
```

```js
el.load(svgStringsToPages(pages), { fontFaceCss, snapshot });
```

Writing your own plugin: implement `PreviewerPlugin` (`setup` / `load` / `sync` /
`teardown`). The host hands you `overlayFor(pageIndex)` (a `pointer-events:none`
layer that survives the windowed page virtualisation), `addSidePanel`,
`addToolbarItem`, `scale()`, and `scrollToPage()` — see `src/structure-view.ts`
for a complete example.

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
