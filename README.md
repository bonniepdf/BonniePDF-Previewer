# BonniePDF Previewer

[![npm](https://img.shields.io/npm/v/@bonniepdf/previewer?label=%40bonniepdf%2Fpreviewer&color=2196F3&style=flat-square&logo=npm)](https://www.npmjs.com/package/@bonniepdf/previewer)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](https://github.com/bonniepdf/BonniePDF-Previewer/blob/master/LICENSE)

[Documentation](https://www.bonniepdf.dev/docs/typescript/previewer) · [Accessibility inspector](https://www.bonniepdf.dev/docs/typescript/previewer-accessibility-view) · [Live examples](https://www.bonniepdf.dev/examples/industry-templates) · [BonniePDF for TypeScript](https://github.com/bonniepdf/BonniePDF-TypeScript) · [BonniePDF for .NET](https://github.com/bonniepdf/BonniePDF-NET) · [@bonniepdf/core on npm](https://www.npmjs.com/package/@bonniepdf/core) · [npm](https://www.npmjs.com/package/@bonniepdf/previewer)

Show BonniePDF documents in a web page before anyone downloads them. `@bonniepdf/previewer` is a framework-agnostic document viewer: a paginated, zoomable preview with a thumbnail rail, page navigation, fullscreen, a Download PDF button and an optional accessibility inspector. It ships as a `<bonnie-pdf-previewer>` web component inside a Shadow DOM, so host-page CSS cannot reach it.

The previewer is what runs on every page of the [live example gallery](https://www.bonniepdf.dev/examples), and inside the BonniePDF editor extensions.

It displays the vector SVG pages that BonniePDF itself produces. It is not a general-purpose PDF viewer: it does not open arbitrary PDF files, and it carries no PDF parser, canvas rasteriser or WASM rendering engine.

## Why the previewer

- **Crisp at every zoom.** BonniePDF exports each page as vector SVG with glyphs placed by real font advance widths, so text and charts stay sharp at any zoom.
- **No rendering engine on the page.** No pdf.js, no pdfium, no WASM download. The pages are SVG the browser already knows how to draw.
- **Fully isolated.** Shadow DOM keeps host styles out and the document's embedded fonts in, and several viewers on one page never collide.
- **Lazy PDF.** Pages render straight away; the PDF bytes are only generated when someone clicks Download.
- **Accessibility preflight built in.** The inspector shows the document's tagged structure, PDF/UA-1 findings and WCAG contrast checks, and highlights each element on the page.
- **Works with either runtime.** Pass a TypeScript `Document`, or the JSON export from a .NET server or a web worker.
- **Any framework.** Use the custom element, or mount it into any element or shadow root with `createPreviewer()`.

## Install

```bash
npm install @bonniepdf/previewer @bonniepdf/core
```

pnpm, Bun and Yarn work too. The package ships ESM and CommonJS entry points and has no runtime dependencies.

`@bonniepdf/core` is an optional peer dependency. You need it to preview a document you build in the browser; you do not need it to show an export generated somewhere else (see [Documents generated elsewhere](#documents-generated-elsewhere)).

## Quick start

Register the element, place it on the page, and load a document:

```html
<bonnie-pdf-previewer style="height: 80vh" label="Quarterly report"></bonnie-pdf-previewer>
```

```typescript
import { BonniePdfPreviewerElement } from '@bonniepdf/previewer/element'; // registers <bonnie-pdf-previewer>
import { Document } from '@bonniepdf/core';

const doc = new Document();
// ...build the document...

const viewer = document.querySelector<BonniePdfPreviewerElement>('bonnie-pdf-previewer')!;
await viewer.load(doc);
```

`load(doc)` does the rest:

- renders the pages, capturing the layout snapshot only when an inspector plugin needs it;
- generates the PDF only if the user clicks Download, naming it from the document's title (`Quarterly Report` becomes `quarterly-report.pdf`);
- shows a loading state while it works, and an error state if rendering fails;
- lets a newer `load()` replace one still in progress, so rapid re-renders never show a stale document.

`load()` also accepts a promise of a document, and is safe to call before the element is connected: the load runs when it mounts. A second argument overrides the filename or supplies the PDF, for example `viewer.load(doc, { downloadFilename: 'q3.pdf' })`.

A failed load rejects its promise and dispatches a `bpp-load-error` event from the element. A document already on screen stays visible under an error banner.

## Using it from any framework

The main entry point is side-effect free. `createPreviewer()` mounts the viewer into any element or `ShadowRoot` and returns a handle:

```typescript
import { createPreviewer } from '@bonniepdf/previewer';

const handle = createPreviewer(container, {
  fitMode: 'fit-width',
  selectionColor: '#16a34a',
});

await handle.load(doc);

// When the component unmounts:
handle.dispose();
```

The custom element is a thin wrapper that calls this factory with its own shadow root. To register it under a different tag name, call `defineBonniePdfPreviewer('my-pdf-viewer')` from the main entry instead of importing `@bonniepdf/previewer/element`.

## Documents generated elsewhere

A `Document` is a live object in one JavaScript runtime. When the document is generated somewhere else, pass its **export** instead: the result of `generateSvgDocumentAsync()`, or the same data as JSON. The previewer reads page sizes from each page's `<svg>`, injects the font CSS once, and hands the layout snapshot and compliance report to its inspector.

From an ASP.NET Core server, using BonniePDF for .NET:

```csharp
app.MapGet("/preview", () => Results.Content(
    BuildReport().GenerateSvgDocument(new SvgPageExportOptions { CaptureLayout = true }).ToJson(),
    "application/json"));
```

```typescript
await viewer.load(await (await fetch('/preview')).json(), {
  pdf: () => fetch('/report.pdf').then((r) => r.blob()), // optional: enables Download
});
```

From a web worker, to keep a large document off the main thread:

```typescript
// worker.ts
const svgExport = await doc.generateSvgDocumentAsync({ captureLayout: true });
postMessage({ svgExport, pdf: await doc.generateBytesAsync() });

// page
worker.onmessage = ({ data }) => viewer.load(data.svgExport, { pdf: data.pdf });
```

An export carries no document to generate a PDF from, so Download appears only when you pass `pdf`: a URL, a `Blob`, bytes, or a function returning one of those, called on the first click. When the previewer turns a `Blob` or bytes into an object URL, it owns that URL and revokes it on the next load or on `dispose()`. URLs you pass in remain yours.

## Accessibility inspector

The `complianceView()` plugin adds an inspector panel for PDF/UA and accessibility preflight. Because BonniePDF generated the document, the inspector knows each element's semantics from authoring: its structure role, whether it is tagged or an artifact, its alternative text and its heading level.

```typescript
import { complianceView, createPreviewer } from '@bonniepdf/previewer';

const handle = createPreviewer(container, { plugins: [complianceView()] });
await handle.load(doc);
```

Or, on the element:

```html
<bonnie-pdf-previewer compliance-view style="height: 80vh"></bonnie-pdf-previewer>
```

The panel provides:

- **A layout tree** following the WAI-ARIA tree pattern: one tab stop, arrow-key navigation, `←` and `→` to collapse and expand, `*` to expand all. It opens fully by default; `defaultExpandDepth` limits the initial depth, and branches containing errors still expand.
- **Role badges** such as `H1`, `Figure` and `TH`. A filled badge marks tagged content, a dashed badge marks an artifact, and separate icons distinguish errors, warnings and informational findings.
- **A summary** with the PDF/UA-1 verdict and issue counts, a filter for elements with issues, and a switch for WCAG contrast checks.
- **An Issues tab** grouping findings by severity, each with its element, page and a Go to element button.
- **Two-way selection.** Click a row to highlight its rectangles on the page, or click the page to select the deepest matching node. The SVG itself is never modified; highlights draw on a separate overlay.
- **A detail pane** with the finding's message, ISO clause and a fix hint.

This catches problems external validators often miss. An image without alternative text exports as an artifact; a validator sees a valid untagged artifact, while a screen reader silently skips it. The inspector flags it as an error that needs `altText` or an explicit decorative marking.

The inspector reads the layout snapshot and compliance report from `@bonniepdf/core`. With the plugin registered, `load(doc)` captures them automatically. An export carries them when it was generated with `captureLayout: true`.

### WCAG contrast checks

PDF/UA-1 sets no numeric contrast requirement: ISO 14289-1 §7.1 only forbids conveying information by contrast or colour alone. Core's contrast findings cite WCAG 2.2 success criterion 1.4.3 instead, and because colourful documents can produce many of them, they can be switched off:

- **In the viewer:** the Include WCAG contrast checks switch in the panel, with its initial state set by `complianceView({ showWcagChecks: false })` or `wcag-checks="false"`. Turning it off removes contrast findings from the tree, counts, badges, detail pane and page markers. WCAG findings never affect the PDF/UA-1 verdict.
- **In the library:** `evaluateCompliance(snapshot, { includeWcag: false })` in TypeScript, or `CompliancePreflight.Evaluate` in .NET, stops the rules running at all.

The inspector is an advisory preflight. It does not certify PDF/A or PDF/UA conformance; use an external validator where certification is required.

### Writing a plugin

A plugin implements `PreviewerPlugin` (`setup`, `load`, `sync`, `teardown`). The host gives it `overlayFor(pageIndex)` (a `pointer-events: none` layer over a page), `addSidePanel`, `addToolbarItem`, `scale()` and `scrollToPage()`. `addSidePanel` registers a tab in the shared inspector region; pass `defaultOpen` and an `onVisibilityChange(visible)` callback to manage overlays, and use `setBadge(text, tone)` for tab counts. [`src/compliance-view.ts`](src/compliance-view.ts) is a complete example.

## Element reference

Attributes are read when the element connects to the page.

| Attribute                 | Effect                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `label`                   | Accessible name for the viewer region. Defaults to `PDF preview`.                            |
| `fit-mode`                | `fit-page` (default) or `fit-width`.                                                         |
| `show-thumbnails`         | Shows the thumbnail rail on first render. Hidden by default; `"false"` keeps it hidden.      |
| `show-inspector`          | Opens (`"true"`) or collapses (`"false"`) the inspector region on first render.              |
| `compliance-view`         | Adds the accessibility inspector.                                                            |
| `wcag-checks`             | `"false"` starts the inspector with WCAG contrast findings hidden.                           |
| `download-filename`       | Filename for Download, overriding the one derived from the document title.                   |
| `selection-color`         | Any CSS colour for selection highlights. Defaults to the system `Highlight` colour.          |
| `footer`                  | Renders a footer bar with text on the left and conformance pills such as `PDF/A-2a` and `PDF/UA-1`, or `PDF/A-4f` and `PDF/UA-2` for PDF 2.0, on the right. |
| `footer-label`            | Footer text. Defaults to `Generated by @bonniepdf/previewer`.                                |
| `preference-key`          | Persists thumbnail and inspector visibility and the chosen zoom in `localStorage` under this key. |
| `hide-border`             | Removes the outer border and corner radius.                                                  |
| `style-scrollbars`        | `"true"` applies the previewer's own scrollbar styling.                                      |
| `show-page-nav`, `show-zoom`, `show-fullscreen`, `show-download`, `show-thumbnails-toggle` | `"false"` hides that toolbar group. All are shown by default. |

`preference-key` state is read synchronously before the viewer builds, so returning visitors never see panels flash through their defaults. Viewers sharing a key share their preferences.

| Method or event                                  | Description                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `load(source, options?)`                         | Shows a `Document`, an export, or a promise of either. Resolves once it is shown.           |
| `selectSnapshotNode(nodeId)`                     | Selects and reveals a layout node. Returns `false` when no such node exists.                |
| `clear()`                                        | Clears the pages and returns to the loading state.                                          |
| `dispose()`                                      | On a `createPreviewer()` handle: disconnects every observer and listener. The element does this itself when removed. |
| `bpp-load-error` event                           | A load failed. `event.detail.error` holds the error.                                        |
| `bonniepdf-node-select` event                    | The inspector selected a node. `event.detail` holds `nodeId`, `sourceId`, `sourceNavigation` and `origin` (`page`, `tree` or `finding`). |

Both events bubble and cross the shadow boundary. `createPreviewer()` accepts the same settings as options (`fitMode`, `showThumbnails`, `showInspector`, `toolbar`, `footer`, `title`, `downloadFilename`, `hideBorder`, `styleScrollbars`, `selectionColor`, `initialZoom`, `onViewStateChange` and `plugins`); the exported TypeScript types document each one.

### Fullscreen

Entering fullscreen switches the document to Fit Page, locks page scrolling and releases any reserved scrollbar gutter. Leaving fullscreen restores the previous zoom, unless the user changed it while in fullscreen, and restores the host's styles.

## Theming

Colours resolve the previewer's own `--bpdf-*` custom properties first, then the CongruentUI `--cui-*` tokens the BonniePDF websites use, then a built-in light theme. Custom properties cross the shadow boundary, so a host that sets either family gets a previewer that follows its light and dark modes. The pages themselves stay white, because they are paper.

| Property                                         | Controls                         |
| ------------------------------------------------ | -------------------------------- |
| `--bpdf-bg`, `--bpdf-bg-alt`, `--bpdf-bg-soft`   | Chrome backgrounds               |
| `--bpdf-text-1`, `--bpdf-text-2`, `--bpdf-text-3`| Primary, secondary and muted text|
| `--bpdf-brand-2`, `--bpdf-brand-soft`            | Accent and accent tint           |
| `--bpdf-divider`                                 | Borders and separators           |
| `--bpdf-radius`                                  | Corner radius                    |
| `--bpdf-font-family`                             | Chrome font (pages use their own)|
| `--bpdf-selection`                               | Selection highlight              |
| `--bpdf-error`, `--bpdf-warning`, `--bpdf-info`, `--bpdf-success` | Inspector severity colours |

There is no theme attribute and no JavaScript theming API; custom properties are the whole interface.

## Performance

- **Windowed rendering.** Only pages and thumbnails near the viewport are mounted; the rest are lightweight placeholders.
- **Lazy PDF.** The full PDF is generated only when Download is clicked.
- **Layout capture on demand.** `load(doc)` asks for the layout snapshot only when an inspector plugin is registered.
- **Deterministic teardown.** `dispose()` and removing the element disconnect every observer and listener.

## Deprecated API

`load(svgStringsToPages(pages), { fontFaceCss, snapshot, report, pdfUrl, pdfProvider })` still works as before but is deprecated and will be removed in the next major version; pass the document or its export instead. The `structureView()` plugin and `structure-view` attribute are aliases for the accessibility inspector.

## Licence

`@bonniepdf/previewer` is licensed under the [Apache License 2.0](https://github.com/bonniepdf/BonniePDF-Previewer/blob/master/LICENSE).

The previewer is free to use with any BonniePDF licence tier. `@bonniepdf/core`, which generates the documents it shows, is licensed separately under the BonniePDF Community License 1.0 or a commercial licence; see the [licensing overview](https://www.bonniepdf.dev/pricing).

## Contributing

Issues and pull requests are welcome. For anything beyond a small fix, please open an issue first: the element's attributes, events and `load()` signature are a public API, so the approach is worth agreeing before the work. See [CONTRIBUTING.md](CONTRIBUTING.md) for the sign-off requirement and how to build and test, and [SECURITY.md](SECURITY.md) to report a vulnerability.

© 2026 CodeFocus Limited
