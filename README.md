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
`download-filename`, `selection-color`, and `label`. Set the `footer` attribute
to render a footer bar below the pages (see [Footer](#footer)).

Set `preference-key` to persist thumbnail and inspector visibility plus the
selected zoom (Fit page, Fit width, or a percentage) in
`localStorage`. The saved state is read synchronously before the shadow DOM is
built, so returning visitors do not see the panels flash through their default
state. Use the same key on multiple viewers to share the preference:

```html
<bonnie-pdf-previewer
  compliance-view
  preference-key="my-app-pdf-viewer-layout"
></bonnie-pdf-previewer>
```

Entering fullscreen temporarily switches the document to Fit page so it remains
comfortably sized on large monitors. Leaving fullscreen restores the previous
zoom unless the user selected a different zoom while fullscreen. The control
also expands to show “Exit Fullscreen” while active. While fullscreen is open,
the previewer locks scrolling and releases any reserved scrollbar gutter on its
owning document, then restores the host page's previous styles when fullscreen
closes or the previewer is disposed.

## Usage — factory (any framework / light DOM)

```js
import { createPreviewer, svgStringsToPages } from '@bonniepdf/previewer';

const handle = createPreviewer(container, {
  fitMode: 'fit-width',
  selectionColor: '#16a34a',
});
handle.load(svgStringsToPages(pages), { fontFaceCss });
// later:
handle.dispose();
```

`createPreviewer` accepts a `ShadowRoot` or any element. The web component is a thin wrapper that calls it with its own shadow root.

## Accessibility inspector (plugin)

The previewer ships a **plugin system** so optional features layer on without
touching the core viewer — with no plugins registered, behaviour is exactly as
documented above. The first-party `complianceView()` plugin renders the document's
**layout structure tree** in a side panel; selecting a node highlights the
rectangle(s) that element occupied (one per page it spans) as a translucent
overlay on top of the SVG. The SVG itself is never modified.

The tree expands and collapses per node, and each row shows what the element
**is** — its type, name, structure role, and severity. Its geometry (page span,
size in points, origin) appears in the detail pane when you select it, where
there is room to state it in full. Selection is **two-way**: click a row to
highlight it on the page, or click an element **on the page** to select the
deepest node under the cursor in the tree.

It consumes the layout snapshot from `@bonniepdf/core`:

```js
import { complianceView, createPreviewer, svgStringsToPages } from '@bonniepdf/previewer';

// Ask core to capture the layout while rendering the SVG:
const { pages, fontFaceCss, snapshot } =
  await doc.generateSvgDocumentAsync({ captureLayout: true });

const handle = createPreviewer(container, { plugins: [complianceView()] });
handle.load(svgStringsToPages(pages), { fontFaceCss, snapshot });
```

Web-component opt-in via the boolean `compliance-view` attribute:

```html
<bonnie-pdf-previewer compliance-view style="height: 80vh"></bonnie-pdf-previewer>
```

```js
el.load(svgStringsToPages(pages), { fontFaceCss, snapshot });
```

Writing your own plugin: implement `PreviewerPlugin` (`setup` / `load` / `sync` /
`teardown`). The host hands you `overlayFor(pageIndex)` (a `pointer-events:none`
layer that survives the windowed page virtualisation), `addSidePanel`,
`addToolbarItem`, `scale()`, and `scrollToPage()` — see `src/compliance-view.ts`
for a complete example. `addSidePanel` registers a **tab** in a single shared
inspector region (multiple panels don't stack); pass `defaultOpen` and an
`onVisibilityChange(visible)` callback so you can paint/clear overlays when your
tab becomes the active one, and use the returned `setBadge(text, tone)` to flag
counts on your tab.

The inspector also turns the layout snapshot into an **accessibility / PDF-UA
preflight panel** — a capability no other PDF library
offers, because BonniePDF *generates* the document and therefore knows the
semantics of every element at authoring time.

It reads the enriched snapshot (each node carries an `a11y` block: role, tagged /
artifact, alt text, heading level) plus an optional **compliance report** from
core's `evaluateCompliance(snapshot)`. It then:

- renders the layout as an **expandable tree** (WAI-ARIA tree pattern: one tab
  stop, arrow-key navigation, `←`/`→` to collapse/expand, `*` to expand
  everything, plus Expand-all / Collapse-all buttons). It opens **fully** by
  default — pass `defaultExpandDepth` to open only the top levels instead, in
  which case any branch containing an error is still expanded;
- tags every tree row with its **role chip** (`H1`, `Figure`, `TH`, …) and a
  **severity dot** (red = error, amber = warning, blue = info, green = tagged OK,
  dashed = artifact). Rows carry identity only — geometry belongs to the detail
  pane, which has room to state the page span, size, and origin in full;
- shows a **summary** — pass/fail verdict against PDF/UA-1 and error/warning/info
  counts — with a "show only elements with issues" filter and an **"include WCAG
  contrast checks"** switch. The summary is fixed-height by design;
- puts every **finding on its own `Issues` tab**, grouped errors → warnings →
  info, each naming its element and page with a "Go to element" button that
  switches back to the tree and selects it. Findings are unbounded — a
  colour-rich document can carry hundreds — so they get their own scroll region
  instead of pushing the tree off the bottom of the panel. The tab carries the
  count badge, and contributes a dot to the shared toolbar toggle so issues are
  visible even while the panel is collapsed;
- paints a **severity-tinted overlay over every flagged element on the page** (an
  issues heatmap) so problems are visible on the document, not just in the tree;
- opens a **detail pane** on selection with each finding's message, the ISO
  clause citation, and a concrete fix hint. Selection remains two-way: click a
  row or click the element on the page.

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

Web-component opt-in via the boolean `compliance-view` attribute:

```html
<bonnie-pdf-previewer compliance-view style="height: 80vh"></bonnie-pdf-previewer>
```

When more than one custom inspector plugin is registered, they share **one** side
panel with a tab strip — only one is visible at a time, and a single toolbar
button toggles the panel. Tabs are ordered alphabetically by displayed label.

```js
el.load(svgStringsToPages(pages), { fontFaceCss, snapshot, report });
```

The inspector registers **two** tabs of its own — `Accessibility` (the tree) and
`Issues` (the findings) — which share one selection, one filter state, and one
on-page overlay; switching between them does not disturb the highlights.

With a `snapshot` but no `report`, the panel still shows role/status badges — it
just omits severities and findings. Options: `complianceView({ label, issuesLabel,
openByDefault, markIssuesOnPage, showWcagChecks, onlyIssues, defaultExpandDepth,
preferenceKey })`.

### WCAG contrast checks

PDF/UA-1 sets **no numeric contrast requirement** — ISO 14289-1 §7.1 only forbids
conveying information by contrast or colour alone. Core's contrast findings
therefore cite WCAG 2.2 SC 1.4.3, a standard an author may be tracking separately,
on a different schedule, or not at all — and on a colour-rich document they can
outnumber the structural findings and bury them.

So they are switchable, in both places it makes sense:

- **In the viewer** — the "Include WCAG contrast checks" switch in the panel, its
  initial state set by `complianceView({ showWcagChecks: false })` or the
  `wcag-checks="false"` attribute. Turning it off removes those findings from the
  tree, the counts, the tab badge, the detail pane, and the on-page markers. The
  PDF/UA-1 verdict never moves — no WCAG finding is an error.
- **In the library** — `evaluateCompliance(snapshot, { includeWcag: false })`
  (`CompliancePreflight.Evaluate(snapshot, new CompliancePreflightOptions { IncludeWcag = false })`
  in .NET), which never runs the rules at all.

Give the plugin a `preferenceKey` and its two filter switches persist across
reloads; the element wires this to its own `preference-key` automatically.

`structureView()` and the `structure-view` element attribute remain as deprecated
compatibility aliases for the unified Accessibility inspector. New code should
use `complianceView()` / `compliance-view`; using both element attributes still
creates only one inspector.

## Footer

An optional footer bar renders under the page area: host-supplied text on the
left, and conformance pills on the right derived from each loaded document's
snapshot metadata (the PDF/A conformance level and PDF/UA-1 tagging, e.g.
`PDF/A-2a` and `PDF/UA-1`).

With the web component, add the `footer` attribute. The left text defaults to
"Generated by @bonniepdf/previewer" and can be overridden with `footer-label`:

```html
<bonnie-pdf-previewer footer footer-label="Quarterly report"></bonnie-pdf-previewer>
```

With the factory, pass a `footer` option:

```js
const handle = createPreviewer(container, {
  footer: { text: 'Quarterly report', conformance: false },
});
```

Omit `footer` entirely and the previewer renders exactly as it did before the
option existed. Pills appear only for documents loaded with a layout snapshot
(`load(pages, { snapshot })`) that declares conformance; documents without a
snapshot show the footer text alone.

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
  --bpdf-selection: #2563eb;
}
```

`--bpdf-selection` controls the continuous backdrop painted behind selected SVG
text, including the visual advances occupied by spaces. It defaults to the
platform-standard `Highlight` system colour. Factory users can set the same
value with `selectionColor`; web-component users can use the `selection-color`
attribute. An explicit option or attribute takes precedence over the inherited
custom property.

## License

`@bonniepdf/previewer` is licensed under the [MIT License](./LICENSE).

The previewer does not grant rights to `@bonniepdf/core`. Documents it renders
are produced by your own copy of the core library, which remains subject to the
licence bundled with that package.
