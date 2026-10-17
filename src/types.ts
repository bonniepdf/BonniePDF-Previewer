// ---------------------------------------------------------------------------
// Public types for @bonniepdf/previewer.
//
// The previewer is intentionally decoupled from PDF *generation*: it consumes
// already-rendered SVG pages (the output of `@bonniepdf/core`'s
// `Document.generateSvgDocumentAsync()` / `exportSvgPagesAsync`) plus an optional
// way to fetch the real PDF bytes for download. It knows nothing about the
// generator, so any source of SVG pages can drive it.
// ---------------------------------------------------------------------------

/**
 * A single previewable page: its `<svg>` markup plus its intrinsic size in PDF
 * points. Hosts can pass `fontFaceCss` through `LoadOptions` once per document
 * instead of inlining duplicate font CSS into every page SVG.
 */
export interface PreviewPage {
  /** `<svg>...</svg>` markup for the page. */
  svg: string;
  /** Page width in PDF points (the SVG's intrinsic width). */
  width: number;
  /** Page height in PDF points (the SVG's intrinsic height). */
  height: number;
}

/** How the previewer fits pages into the available viewport space. */
export type FitMode = 'fit-page' | 'fit-width' | 'custom';

/** A semantic fit mode or an explicit scale selected by the user. */
export interface PreviewerZoomState {
  mode: FitMode;
  /** Scale factor used when `mode` is `custom` (1 = 100%). */
  scale?: number;
}

// ---------------------------------------------------------------------------
// Layout snapshot (structural mirror of @bonniepdf/core's LayoutSnapshot).
//
// Declared here, not imported, so the previewer stays decoupled from the core
// package — exactly as it already is for SVG page strings. Any object matching
// this shape (e.g. the `snapshot` from `generateSvgDocumentAsync({ captureLayout:
// true })`) drives the accessibility inspector plugin.
// ---------------------------------------------------------------------------

/** One rectangle an element occupied on a page (top-left origin, PDF points). */
export interface SnapshotRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Intrinsic accessibility facts for a node, mirroring `@bonniepdf/core`'s
 * `NodeAccessibility`. Present only when the element declares a role.
 */
export interface NodeAccessibility {
  /** Resolved PDF structure tag, e.g. `'H1'`, `'P'`, `'Figure'`, `'TH'`. */
  role: string;
  /** True when the element contributes real content to the structure tree. */
  tagged: boolean;
  /** True when the element renders as an `/Artifact` (out of reading order). */
  artifact: boolean;
  /** `/Alt` alternate text, when supplied. */
  alt?: string;
  /** Author explicitly marked the element decorative. */
  decorative?: boolean;
  /** Heading level 1–6 for `H1`…`H6`. */
  headingLevel?: number;
  /** True for image-like elements (figure candidates). */
  imageLike?: boolean;
}

/** One node in the layout tree. */
export interface SnapshotNode {
  id: string;
  type: string;
  name?: string;
  /** Opaque source id supplied by an instrumented editor preview build. */
  sourceId?: string;
  rects: SnapshotRect[];
  /** Intrinsic accessibility facts, when the element declares a role. */
  a11y?: NodeAccessibility;
  children: SnapshotNode[];
}

/** Document-level accessibility/compliance context, mirroring core's `SnapshotMeta`. */
export interface SnapshotMeta {
  accessibilityMode: number;
  conformance: string;
  language?: string;
  title?: string;
}

/** The captured layout of a document, as consumed by inspector plugins. */
export interface LayoutSnapshot {
  version: number;
  pages: { width: number; height: number }[];
  root: SnapshotNode;
  /** Document-level accessibility/compliance context. */
  meta?: SnapshotMeta;
}

// ---------------------------------------------------------------------------
// Compliance findings (mirror of @bonniepdf/core's ComplianceReport).
//
// Declared here, not imported, so the previewer stays decoupled from core —
// exactly as it is for the snapshot. Any object matching this shape (e.g. the
// result of `evaluateCompliance(snapshot)`) drives the compliance-view plugin.
// ---------------------------------------------------------------------------

/** Severity of a compliance finding. */
export type ComplianceSeverity = 'error' | 'warning' | 'info';

/** One reported accessibility/compliance issue. */
export interface ComplianceFinding {
  code: string;
  severity: ComplianceSeverity;
  standard: string;
  clause: string;
  message: string;
  fixHint?: string;
  /** The node this finding anchors to; omitted for document-level findings. */
  nodeId?: string;
  role?: string;
  page?: number;
}

/** The result of evaluating a snapshot for compliance. */
export interface ComplianceReport {
  findings: ComplianceFinding[];
  passed: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

/**
 * Capabilities the previewer host hands to a plugin. Everything here is a thin
 * wrapper over machinery the previewer already owns (page elements, the scale
 * factor, scroll-to-page); plugins never reach into the controller internals.
 */
export interface PreviewerPluginContext {
  /** The owning document, for creating elements. */
  readonly ownerDocument: Document;
  /** Host element used for composed integration events. */
  readonly hostElement: HTMLElement;
  /** Adds a control to the toolbar's trailing group. */
  addToolbarItem(element: HTMLElement): void;
  /**
   * Registers a side panel in the body (beside the page scroll area). All
   * registered panels share **one** collapsible region with a tab strip — only
   * one panel is ever visible at a time, and a single toolbar button toggles the
   * region. This keeps multiple inspector plugins (structure, compliance, …) from
   * stacking as competing side-by-side panels.
   *
   * - `defaultOpen`: open the region on this panel when it registers (the first
   *   panel to request it wins; later panels become inactive tabs).
   * - `onVisibilityChange`: called with `true` when this panel becomes the active,
   *   visible tab and `false` when it stops being (region closed or switched away).
   *   Plugins use it to paint/clear on-page overlays instead of tracking their own
   *   toolbar toggle.
   *
   * The returned handle drives the panel: `setVisible` activates/closes it, and
   * `setBadge` shows a small count/severity badge on its tab (and contributes a
   * dot to the shared toolbar toggle so issues are visible while collapsed).
   */
  addSidePanel(panel: {
    id: string;
    label: string;
    element: HTMLElement;
    defaultOpen?: boolean;
    onVisibilityChange?: (visible: boolean) => void;
  }): {
    setVisible(visible: boolean): void;
    setBadge(text: string | null, tone?: 'error' | 'warning' | 'info' | 'ok'): void;
  };
  /** The `.bpp-page` host element for a 0-based page index, or null. */
  pageElement(index: number): HTMLElement | null;
  /**
   * The pointer-events:none overlay layer for a page, created on first use.
   * Plugins paint absolutely-positioned children into it; it survives the
   * windowed mount/unmount of the page's SVG.
   */
  overlayFor(index: number): HTMLElement | null;
  /** Current scale factor mapping PDF points to CSS pixels. */
  scale(): number;
  /** Number of pages currently loaded. */
  pageCount(): number;
  /** Scrolls a 1-based page into view (mirrors the toolbar's navigation). */
  scrollToPage(pageNumber: number): void;
}

/** Per-load context: the plugin context plus the document being shown. */
export interface PreviewerLoadContext extends PreviewerPluginContext {
  pages: PreviewPage[];
  /** The layout snapshot, when the host was given one via {@link LoadOptions.snapshot}. */
  snapshot?: LayoutSnapshot;
  /** The compliance report, when the host was given one via {@link LoadOptions.report}. */
  report?: ComplianceReport;
}

/** State pushed to plugins whenever the viewport scale or current page changes. */
export interface PreviewerSyncContext {
  scale: number;
  currentPage: number;
}

/**
 * A previewer plugin. Lifecycle: `setup` once when the previewer is built (may
 * return a cleanup fn), `load` on every document load, `sync` on scale/page
 * changes, `teardown` on dispose or when a load supersedes the previous one.
 * With no plugins registered the previewer behaves exactly as before.
 */
export interface PreviewerPlugin {
  readonly name: string;
  /**
   * Set when the plugin reads the layout snapshot or compliance report. When any
   * registered plugin sets it, `load(doc)` asks the document to capture its
   * layout; otherwise it skips that work.
   */
  readonly needsLayout?: boolean;
  setup?(ctx: PreviewerPluginContext): void | (() => void);
  load?(ctx: PreviewerLoadContext): void;
  sync?(ctx: PreviewerSyncContext): void;
  /** Selects a snapshot node when the plugin owns node-selection UI. */
  selectSnapshotNode?(nodeId: string): boolean;
  teardown?(): void;
}

/**
 * Controls which built-in toolbar groups render. Each flag defaults to `true`,
 * so an omitted `toolbar` (or omitted flag) leaves the toolbar exactly as it was
 * before this option existed. Hosts embedding the previewer in a context that
 * owns its own chrome (e.g. an editor panel with native save/fullscreen) can
 * drop the groups that don't apply. Note these gate the built-in groups only —
 * plugin-contributed controls (via `addToolbarItem`) are unaffected.
 */
export interface ToolbarConfig {
  /** The thumbnail-rail toggle button. Defaults to `true`. */
  thumbnails?: boolean;
  /** The previous / page-indicator / next group. Defaults to `true`. */
  pageNav?: boolean;
  /** The zoom-out / zoom-select / zoom-in group. Defaults to `true`. */
  zoom?: boolean;
  /** The full-screen toggle button. Defaults to `true`. */
  fullscreen?: boolean;
  /** The download-PDF button. Defaults to `true`. */
  download?: boolean;
}

/**
 * The optional footer bar. Set {@link PreviewerOptions.footer} to render a slim
 * bar below the page area: host-supplied text on the left, and conformance pills
 * on the right derived from each loaded document's snapshot metadata (e.g.
 * `PDF/A-2a`, `PDF/UA-1`). Omitting `footer` renders no bar at all — the
 * previewer's layout is exactly as it was before this option existed.
 */
export interface FooterConfig {
  /**
   * Left-aligned text. Defaults to `'Generated by @bonniepdf/previewer'`. Set an
   * empty string to leave the left side blank (the pills still render).
   */
  text?: string;
  /**
   * Render conformance pills derived from the loaded document's
   * `snapshot.meta`: its PDF/A conformance level and PDF/UA-1 tagging. Defaults
   * to `true`. Documents loaded without a snapshot simply show no pills.
   */
  conformance?: boolean;
}

/** Visibility state for the previewer's collapsible navigation panels. */
export interface PreviewerViewState {
  showThumbnails: boolean;
  showInspector: boolean;
  zoom: PreviewerZoomState;
}

/** Configuration applied when a previewer is created (chrome / defaults). */
export interface PreviewerOptions {
  /** Plugins extending the previewer (e.g. the accessibility inspector). Optional. */
  plugins?: PreviewerPlugin[];
  /**
   * Which built-in toolbar groups to render. Every flag defaults to `true`, so
   * omitting this leaves the full toolbar in place. See {@link ToolbarConfig}.
   */
  toolbar?: ToolbarConfig;
  /** Show the thumbnail rail on first render. Defaults to `true`. */
  showThumbnails?: boolean;
  /**
   * Show the shared inspector region on first render. When omitted, inspector
   * plugins retain their own `openByDefault` behaviour.
   */
  showInspector?: boolean;
  /** Restores a previously selected zoom. `fitMode` remains the fallback. */
  initialZoom?: PreviewerZoomState;
  /** Called whenever panel visibility or the user-selected zoom changes. */
  onViewStateChange?: (state: PreviewerViewState) => void;
  /** Initial fit mode. Defaults to `'fit-page'`. */
  fitMode?: Exclude<FitMode, 'custom'>;
  /** Accessible label for the previewer region. Defaults to `'PDF preview'`. */
  title?: string;
  /** Default download filename. Defaults to `'document.pdf'`. */
  downloadFilename?: string;
  /** Hides the outer border and border-radius around the previewer. Defaults to `false`. */
  hideBorder?: boolean;
  /**
   * Renders the footer bar below the page area. Omit for no footer. See
   * {@link FooterConfig}.
   */
  footer?: FooterConfig;
  /** Whether to apply custom styling to scrollbars. Defaults to `false`. */
  styleScrollbars?: boolean;
  /**
   * Selection highlight colour as any valid CSS colour. Defaults to the
   * platform-standard `Highlight` system colour. This takes precedence over
   * an inherited `--bpdf-selection` custom property.
   */
  selectionColor?: string;
}

/** Per-document data handed to the deprecated `load(pages, options)` form. */
export interface LoadOptions {
  /**
   * `@font-face` CSS (e.g. from `generateSvgDocumentAsync`) embedding the
   * subsetted fonts the document uses, so pages render with the exact faces they
   * were laid out with. Injected once at the document level (font resources are
   * document-scoped and reach shadow content; the names are namespaced so they
   * never collide with installed fonts).
   */
  fontFaceCss?: string;
  /**
   * A ready PDF blob/URL for the download button.
   * @deprecated Load the document or its export and pass {@link PreviewLoadOptions.pdf}.
   */
  pdfUrl?: string;
  /**
   * Lazily produces the PDF blob URL on the first download click. Preferred over
   * {@link pdfUrl} so previewing a large document does not pay for full PDF
   * generation unless the user actually downloads.
   * @deprecated Load the document or its export and pass {@link PreviewLoadOptions.pdf}.
   */
  pdfProvider?: () => Promise<string>;
  /** Overrides the download filename for this document. */
  downloadFilename?: string;
  /**
   * The layout snapshot for this document (from `generateSvgDocumentAsync({
   * captureLayout: true })`). Consumed by the accessibility inspector; ignored
   * when no plugin uses it.
   */
  snapshot?: LayoutSnapshot;
  /**
   * A precomputed compliance report for this document (from core's
   * `evaluateCompliance(snapshot)`). Consumed by the compliance-view plugin. When
   * omitted while a `snapshot` is present, the plugin still shows role/status
   * badges from the snapshot, just without severity findings.
   */
  report?: ComplianceReport;
}

/**
 * A document the previewer can render itself: any object with these two methods,
 * which `@bonniepdf/core`'s `Document` has. Checked by shape, not by class, so
 * the previewer works with whichever copy of core the host bundles.
 */
export interface PreviewableDocument {
  generateSvgDocumentAsync(options?: { captureLayout?: boolean }): Promise<PreviewExport>;
  generateBytesAsync(): Promise<Uint8Array>;
  readonly metadata?: { readonly title?: string };
}

/**
 * A rendered document produced anywhere, in either language: the value of
 * `@bonniepdf/core`'s `generateSvgDocumentAsync()`, or the JSON a .NET server
 * returns from `SvgDocumentExport.ToJson()`, parsed. Page sizes are read from
 * each page's root `<svg>`.
 */
export interface PreviewExport {
  /** Export format version. Absent in exports from releases before it existed. */
  version?: number;
  /** One `<svg>` document per page, in page order. */
  pages: readonly string[];
  /** `@font-face` CSS for the embedded fonts, injected once for every page. */
  fontFaceCss?: string;
  /** The layout snapshot, present when the export captured layout. */
  snapshot?: LayoutSnapshot;
  /** The compliance report for {@link snapshot}. */
  report?: ComplianceReport;
}

/** What {@link PreviewerHandle.load} accepts: a document, an export, or a promise of either. */
export type PreviewSource = PreviewableDocument | PreviewExport | PromiseLike<PreviewableDocument | PreviewExport>;

/**
 * The PDF behind the download button: a URL, the bytes, or a function producing
 * either, called on the first click only. When the previewer turns bytes into
 * an object URL, it owns that URL and revokes it on the next load or on dispose.
 */
export type PdfSource =
  | string
  | Blob
  | Uint8Array
  | (() => string | Blob | Uint8Array | PromiseLike<string | Blob | Uint8Array>);

/** Per-load overrides for {@link PreviewerHandle.load}. */
export interface PreviewLoadOptions {
  /**
   * The download filename. Defaults to the document's title as a slug
   * (`Quarterly Report` → `quarterly-report.pdf`), then to the previewer's
   * `downloadFilename`.
   */
  downloadFilename?: string;
  /**
   * The PDF for the download button. A loaded document supplies its own
   * (generated on the first click), so this is needed only for an export.
   * Without a PDF the download button is hidden.
   */
  pdf?: PdfSource;
}

/** Controls a created previewer instance. Returned by `createPreviewer`. */
export interface PreviewerHandle {
  /**
   * Shows a document. Pass a `@bonniepdf/core` `Document`, and the previewer
   * renders it, captures layout when an inspector needs it, and generates the
   * PDF only if the user downloads. Pass an export (`generateSvgDocumentAsync()`'s
   * result, or .NET's `ToJson()` parsed) when the document was generated
   * elsewhere. A promise of either shows the loading state until it settles.
   *
   * Resolves once the document is shown, or when a newer `load()` supersedes
   * this one. Rejects if rendering fails; the viewer then shows an error state
   * and dispatches a `bpp-load-error` event from the host element.
   */
  load(source: PreviewSource, options?: PreviewLoadOptions): Promise<void>;
  /**
   * Replaces the previewed document with the given pages.
   * @deprecated Pass the document or its export: `load(doc)` or `load(svgExport)`.
   */
  load(pages: PreviewPage[], options?: LoadOptions): void;
  /** Selects and reveals a layout-snapshot node. */
  selectSnapshotNode(nodeId: string): boolean;
  /** Clears rendered pages and resets to the loading state without removing injected fonts. */
  clear(): void;
  /** Disconnects observers and listeners. Safe to call more than once. */
  dispose(): void;
}

const A4_PORTRAIT = { width: 595.28, height: 841.89 } as const;

/** Pulls the intrinsic width/height (in points) out of an SVG root element. */
function parseSvgSize(svg: string): { width: number; height: number } {
  const width = svg.match(/<svg[^>]*\bwidth="([\d.]+)"/i);
  const height = svg.match(/<svg[^>]*\bheight="([\d.]+)"/i);
  if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  const viewBox = svg.match(/<svg[^>]*\bviewBox="([\d.\s-]+)"/i);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4) return { width: parts[2], height: parts[3] };
  }
  return { ...A4_PORTRAIT };
}

/**
 * Convenience adapter: turn the raw `string[]` returned by `exportSvgPagesAsync`
 * into {@link PreviewPage}s by reading each SVG's intrinsic dimensions.
 * @deprecated `load()` accepts the export directly: `load(svgExport)`.
 */
export function svgStringsToPages(svgs: readonly string[]): PreviewPage[] {
  return readPreviewPages(svgs);
}

/** Internal: {@link PreviewPage}s from page SVGs, sized from each root `<svg>`. */
export function readPreviewPages(svgs: readonly string[]): PreviewPage[] {
  return svgs.map(svg => ({ svg, ...parseSvgSize(svg) }));
}
