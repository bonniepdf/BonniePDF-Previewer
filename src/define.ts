import { createPreviewer } from './controller';
import { structureView } from './structure-view';
import { complianceView } from './compliance-view';
import type { LoadOptions, PreviewerHandle, PreviewerOptions, PreviewerPlugin, PreviewPage } from './types';

/**
 * `<bonnie-pdf-previewer>` — a framework-agnostic PDF preview element.
 *
 * Pages are SVG strings (too large for attributes), so they're supplied through
 * the imperative {@link load} method rather than markup:
 *
 * ```js
 * import { defineBonniePdfPreviewer } from '@bonniepdf/previewer';
 * defineBonniePdfPreviewer();
 *
 * const el = document.querySelector('bonnie-pdf-previewer');
 * el.load(svgStringsToPages(svgPages), { fontFaceCss, pdfProvider });
 * ```
 *
 * Configuration is read from attributes: `show-thumbnails` (`"false"` to hide),
 * `fit-mode` (`fit-page` | `fit-width`), `download-filename`, and `label`.
 *
 * The viewer renders inside a shadow root, so host-page CSS cannot reach the SVG
 * pages — the embedded fonts always win and there are no id collisions between
 * instances.
 */
export class BonniePdfPreviewerElement extends HTMLElement {
  private handle: PreviewerHandle | null = null;
  private pending: { pages: PreviewPage[]; options?: LoadOptions } | null = null;

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (!this.handle) {
      this.handle = createPreviewer(root, this.readOptions());
      if (this.pending) {
        this.handle.load(this.pending.pages, this.pending.options);
        this.pending = null;
      }
    }
  }

  disconnectedCallback(): void {
    this.handle?.dispose();
    this.handle = null;
  }

  /** Replaces the previewed document. Safe to call before the element is
   * connected — the pages are applied as soon as it mounts. */
  load(pages: PreviewPage[], options?: LoadOptions): void {
    if (this.handle) this.handle.load(pages, options);
    else this.pending = { pages, options };
  }

  private readOptions(): PreviewerOptions {
    const showThumbs = this.getAttribute('show-thumbnails');
    // Plugins are opt-in via boolean attributes, so the default element is
    // byte-for-byte the previous component. `structure-view` adds the layout
    // tree; `compliance-view` adds the accessibility/compliance panel.
    const plugins: PreviewerPlugin[] = [];
    if (this.hasAttribute('structure-view')) plugins.push(structureView());
    if (this.hasAttribute('compliance-view')) plugins.push(complianceView());
    return {
      plugins: plugins.length > 0 ? plugins : undefined,
      showThumbnails: showThumbs === null ? undefined : showThumbs !== 'false',
      fitMode: this.getAttribute('fit-mode') === 'fit-width' ? 'fit-width' : 'fit-page',
      title: this.getAttribute('label') ?? undefined,
      downloadFilename: this.getAttribute('download-filename') ?? undefined,
      hideBorder: this.getAttribute('hide-border') === 'true',
      styleScrollbars: this.getAttribute('style-scrollbars') === 'true',
    };
  }
}

/**
 * Registers {@link BonniePdfPreviewerElement} under `tagName` (default
 * `bonnie-pdf-previewer`). A no-op if the tag is already defined, so it's safe to
 * call more than once.
 */
export function defineBonniePdfPreviewer(tagName = 'bonnie-pdf-previewer'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, BonniePdfPreviewerElement);
  }
}
