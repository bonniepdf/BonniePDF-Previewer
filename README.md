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

Attributes: `show-thumbnails` (`"false"` to hide), `show-inspector`
(`"false"` to collapse), `fit-mode` (`fit-page` | `fit-width`),
`download-filename`, and `label`.

Set `preference-key` to persist thumbnail and inspector visibility plus the
selected zoom (Fit page, Fit width, or a percentage) in
`localStorage`. The saved state is read synchronously before the shadow DOM is
built, so returning visitors do not see the panels flash through their default
state. Use the same key on multiple viewers to share the preference:

```html
<bonnie-pdf-previewer
  structure-view
  compliance-view
  preference-key="my-app-pdf-viewer-layout"
></bonnie-pdf-previewer>
```

Entering fullscreen temporarily switches the document to Fit page so it remains
comfortably sized on large monitors. Leaving fullscreen restores the previous
zoom unless the user selected a different zoom while fullscreen. The control
also expands to show “Exit Fullscreen” while active.

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
for a complete example. `addSidePanel` registers a **tab** in a single shared
inspector region (multiple panels don't stack); pass `defaultOpen` and an
`onVisibilityChange(visible)` callback so you can paint/clear overlays when your
tab becomes the active one, and use the returned `setBadge(text, tone)` to flag
counts on your tab.

## Compliance view (plugin)

The sibling `complianceView()` plugin turns the same layout snapshot into an
**accessibility / PDF-UA preflight panel** — a capability no other PDF library
offers, because BonniePDF *generates* the document and therefore knows the
semantics of every element at authoring time.

It reads the enriched snapshot (each node carries an `a11y` block: role, tagged /
artifact, alt text, heading level) plus an optional **compliance report** from
core's `evaluateCompliance(snapshot)`. It then:

- tags every tree row with its **role chip** (`H1`, `Figure`, `TH`, …) and a
  **severity dot** (red = error, amber = warning, blue = info, green = tagged OK,
  dashed = artifact);
- shows a **summary** — pass/fail verdict against PDF/UA-1 and error/warning/info
  counts — with a "show only elements with issues" filter, a count badge on its
  tab, and a dot on the shared toolbar toggle so issues are visible even while the
  panel is collapsed;
- paints a **severity-tinted overlay over every flagged element on the page** (an
  issues heatmap) so problems are visible on the document, not just in the tree;
- opens a **detail pane** on selection with each finding's message, the ISO
  clause citation, and a concrete fix hint. Selection is two-way, exactly like the
  structure view: click a row or click the element on the page.

The flagship check catches the mistake external validators pass silently: an
image with no alt text is exported as an `/Artifact`, so veraPDF sees a
legitimately untagged artifact — but a screen reader skips it entirely. The
preflight flags it as an error and tells you to add `altText` (or mark it
decorative).

```js
import {
  createPreviewer,
  complianceView,
  svgStringsToPages,
} from '@bonniepdf/previewer';
import { evaluateCompliance } from '@bonniepdf/core';

const { pages, fontFaceCss, snapshot } =
  await doc.generateSvgDocumentAsync({ captureLayout: true });
const report = evaluateCompliance(snapshot);

const handle = createPreviewer(container, { plugins: [complianceView()] });
handle.load(svgStringsToPages(pages), { fontFaceCss, snapshot, report });
```

Web-component opt-in via the boolean `compliance-view` attribute (composable with
`structure-view`):

```html
<bonnie-pdf-previewer structure-view compliance-view style="height: 80vh"></bonnie-pdf-previewer>
```

When more than one inspector plugin is registered (e.g. `structure-view` **and**
`compliance-view`), they share **one** side panel with a tab strip — only one is
visible at a time, and a single toolbar button toggles the panel. This keeps the
Structure tree and the Accessibility report from competing for screen space.
Tabs are ordered alphabetically by their displayed label.

```js
el.load(svgStringsToPages(pages), { fontFaceCss, snapshot, report });
```

With a `snapshot` but no `report`, the panel still shows role/status badges — it
just omits severities and findings. Options: `complianceView({ label, openByDefault,
markIssuesOnPage })`.

## Performance

- **Windowed virtualisation** — only the pages/thumbnails near the viewport are mounted in the DOM; the rest are kept as lightweight placeholders. A 50-page document keeps ~6 pages live at a time instead of all 50.
- **Lazy PDF** — the full PDF is generated only when the user clicks Download (via `pdfProvider`), so previewing never pays for it.
- **Deterministic teardown** — `dispose()` (and the element's `disconnectedCallback`) disconnect every observer and listener.

## Theming

Colours resolve `--bpdf-*` custom properties (which pierce the shadow boundary), falling back to a clean light theme. For example:

```css
bonnie-pdf-previewer {
  --bpdf-accent: #16a34a;
  --bpdf-bg-alt: #0b0f17;
  --bpdf-text-1: #e5e7eb;
}
```

## License

MIT
