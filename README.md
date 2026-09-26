# @bonniepdf/previewer

A framework-agnostic PDF preview component for [BonniePDF](https://www.bonniepdf.dev). It renders SVG pages produced by `@bonniepdf/core` as a paginated, zoomable viewer with a thumbnail rail, page navigation, and a lazy "Download PDF" action. Used on the bonniepdf.dev example pages.

It ships as a Shadow-DOM web component, isolating the viewer from the host page's CSS. Embedded fonts render correctly and prevent ID collisions between instances.

## Why SVG over a canvas/WASM renderer

BonniePDF generates previews as vector SVGs (one `<text>` per run, glyphs positioned by font advance widths). The preview maintains resolution at any zoom level and requires no PDF rendering engine on the page. The component consumes SVG strings and does not generate PDFs.

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

Attributes: `show-thumbnails` (`"false"` to hide), `show-inspector` (`"false"` to collapse), `fit-mode` (`fit-page` | `fit-width`), `download-filename`, `selection-color`, and `label`. Set `footer` to render a footer bar (see [Footer](#footer)).

Set `preference-key` to persist thumbnail visibility, inspector visibility, and the selected zoom level in `localStorage`. This state is read synchronously before the shadow DOM builds, preventing layout shifts. Share this key across multiple viewers to sync preferences:

```html
<bonnie-pdf-previewer
  compliance-view
  preference-key="my-app-pdf-viewer-layout"
></bonnie-pdf-previewer>
```

Entering fullscreen temporarily switches the document to Fit Page. Leaving fullscreen restores the previous zoom unless changed by the user while in fullscreen. The control displays “Exit Fullscreen” when active. During fullscreen, the previewer locks scrolling, releases reserved scrollbar gutters on the document, and restores host styles upon closing or disposal.

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

`createPreviewer` accepts a `ShadowRoot` or any element. The web component acts as a wrapper that calls this factory with its own shadow root.

## Accessibility inspector (plugin)

The previewer includes a plugin system. The `complianceView()` plugin renders the document's layout structure tree in a side panel. Selecting a node highlights the corresponding rectangle(s) as a translucent overlay on the SVG. The SVG remains unmodified.

The tree expands and collapses per node. Each row displays the element type, name, structure role, and severity. Geometry details (page span, size in points, origin) appear in the detail pane upon selection. Selection is bidirectional: click a row to highlight the page element, or click an element on the page to select its deepest node in the tree.

It consumes the layout snapshot from `@bonniepdf/core`:

```js
import { complianceView, createPreviewer, svgStringsToPages } from '@bonniepdf/previewer';

// Ask core to capture the layout while rendering the SVG:
const { pages, fontFaceCss, snapshot } =
  await doc.generateSvgDocumentAsync({ captureLayout: true });

const handle = createPreviewer(container, { plugins: [complianceView()] });
handle.load(svgStringsToPages(pages), { fontFaceCss, snapshot });
```

Web-component opt-in via the `compliance-view` attribute:

```html
<bonnie-pdf-previewer compliance-view style="height: 80vh"></bonnie-pdf-previewer>
```

To write a plugin: implement `PreviewerPlugin` (`setup` / `load` / `sync` / `teardown`). The host provides `overlayFor(pageIndex)` (a `pointer-events:none` layer), `addSidePanel`, `addToolbarItem`, `scale()`, and `scrollToPage()`. See `src/compliance-view.ts` for an example. `addSidePanel` registers a tab in a shared inspector region. Pass `defaultOpen` and an `onVisibilityChange(visible)` callback to manage overlays, and use `setBadge(text, tone)` for tab counts.

The inspector functions as an accessibility/PDF-UA preflight panel. Since BonniePDF generates the document, it retains element semantics from authoring. It reads the enriched snapshot (role, tagged/artifact, alt text, heading level) and an optional compliance report from `evaluateCompliance(snapshot)`. The panel provides:

*   An expandable layout tree (WAI-ARIA tree pattern: single tab stop, arrow navigation, `←`/`→` to collapse/expand, `*` to expand all). Opens fully by default. Use `defaultExpandDepth` to limit initial depth (branches with errors still expand).
*   Tree rows tagged with a role chip (`H1`, `Figure`, `TH`) and severity dot (red = error, amber = warning, blue = info, green = tagged OK, dashed = artifact).
*   A summary displaying the PDF/UA-1 verdict and issue counts, featuring a "show only elements with issues" filter and an "include WCAG contrast checks" toggle.
*   An `Issues` tab grouping findings (errors → warnings → info). Each finding includes the element, page, and a "Go to element" button. Findings scroll independently from the tree.
*   A severity-tinted overlay indicating flagged elements directly on the document.
*   A detail pane showing the finding's message, ISO clause citation, and a fix hint.

This check catches issues external validators often miss. For example, an image without alt text exports as an `/Artifact`. While standard validators see a valid untagged artifact, screen readers skip it. The preflight flags this as an error requiring `altText` or decorative marking.

### WCAG contrast checks

PDF/UA-1 sets no numeric contrast requirement (ISO 14289-1 §7.1 only forbids conveying information by contrast or color alone). Core's contrast findings cite WCAG 2.2 SC 1.4.3. Because documents with multiple colors can produce numerous findings, these checks are toggleable:

*   **In the viewer:** The "Include WCAG contrast checks" switch in the panel (initial state set via `complianceView({ showWcagChecks: false })` or `wcag-checks="false"`). Disabling this removes contrast findings from the tree, counts, badges, detail pane, and on-page markers. WCAG findings do not affect the PDF/UA-1 verdict.
*   **In the library:** `evaluateCompliance(snapshot, { includeWcag: false })` (`CompliancePreflight.Evaluate` in .NET) prevents the rules from running.

## Footer

An optional footer bar renders below the pages, displaying host-supplied text (left) and conformance pills (right) derived from the document's snapshot metadata (e.g., `PDF/A-2a`, `PDF/UA-1`).

## Performance

*   **Windowed virtualisation:** Mounts only pages/thumbnails near the viewport in the DOM, keeping the rest as placeholders.
*   **Lazy PDF:** Generates the full PDF only upon clicking Download (via `pdfProvider`).
*   **Deterministic teardown:** `dispose()` (and `disconnectedCallback`) disconnect all observers and listeners.

## Theming

Colors resolve `--bpdf-*` custom properties, falling back to a light theme.

## License

`@bonniepdf/previewer` is licensed under the [MIT License](./LICENSE).
