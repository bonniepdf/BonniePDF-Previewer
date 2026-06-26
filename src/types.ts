// ---------------------------------------------------------------------------
// Public types for @bonniepdf/previewer.
//
// The previewer is intentionally decoupled from PDF *generation*: it consumes
// already-rendered SVG pages (the output of `@bonniepdf/core`'s
// `Document.generateSvgDocumentAsync()` / `exportSvgPagesAsync`) plus an optional
// way to fetch the real PDF bytes for download. It knows nothing about the
// generator, so any source of standalone SVG pages can drive it.
// ---------------------------------------------------------------------------

/**
 * A single previewable page: its standalone `<svg>` markup plus its intrinsic
 * size in PDF points. The size drives zoom / fit-to-page maths without re-parsing
 * the SVG on every layout.
 */
export interface PreviewPage {
  /** Standalone `<svg>…</svg>` markup for the page. */
  svg: string;
  /** Page width in PDF points (the SVG's intrinsic width). */
  width: number;
  /** Page height in PDF points (the SVG's intrinsic height). */
  height: number;
}

/** How the previewer fits pages into the available viewport space. */
export type FitMode = 'fit-page' | 'fit-width' | 'custom';

/** Configuration applied when a previewer is created (chrome / defaults). */
export interface PreviewerOptions {
  /** Show the thumbnail rail on first render. Defaults to `true`. */
  showThumbnails?: boolean;
  /** Initial fit mode. Defaults to `'fit-page'`. */
  fitMode?: Exclude<FitMode, 'custom'>;
  /** Accessible label for the previewer region. Defaults to `'PDF preview'`. */
  title?: string;
  /** Default download filename. Defaults to `'document.pdf'`. */
  downloadFilename?: string;
  /** Hides the outer border around the previewer. Defaults to `false`. */
  hideBorder?: boolean;
  /** Whether to apply custom styling to scrollbars. Defaults to `false`. */
  styleScrollbars?: boolean;
}

/** Per-document data handed to {@link PreviewerHandle.load}. */
export interface LoadOptions {
  /**
   * `@font-face` CSS (e.g. from `generateSvgDocumentAsync`) embedding the
   * subsetted fonts the document uses, so pages render with the exact faces they
   * were laid out with. Injected once at the document level (font resources are
   * document-scoped and reach shadow content; the names are namespaced so they
   * never collide with installed fonts).
   */
  fontFaceCss?: string;
  /** A ready PDF blob/URL for the download button. */
  pdfUrl?: string;
  /**
   * Lazily produces the PDF blob URL on the first download click. Preferred over
   * {@link pdfUrl} so previewing a large document does not pay for full PDF
   * generation unless the user actually downloads.
   */
  pdfProvider?: () => Promise<string>;
  /** Overrides the download filename for this document. */
  downloadFilename?: string;
}

/** Controls a created previewer instance. Returned by `createPreviewer`. */
export interface PreviewerHandle {
  /** Replaces the previewed document with the given pages. */
  load(pages: PreviewPage[], options?: LoadOptions): void;
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
 */
export function svgStringsToPages(svgs: readonly string[]): PreviewPage[] {
  return svgs.map(svg => ({ svg, ...parseSvgSize(svg) }));
}
