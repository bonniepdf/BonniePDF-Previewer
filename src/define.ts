import { createPreviewer } from './controller';
import { structureView } from './structure-view';
import { complianceView } from './compliance-view';
import type {
  LoadOptions,
  PreviewerHandle,
  PreviewerOptions,
  PreviewerPlugin,
  PreviewerViewState,
  PreviewPage,
  ToolbarConfig,
} from './types';

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
 * `show-inspector`, `preference-key`, `fit-mode` (`fit-page` | `fit-width`),
 * `download-filename`, and `label`.
 *
 * Individual built-in toolbar groups can be dropped (each defaults to shown) via
 * `show-page-nav`, `show-zoom`, `show-fullscreen`, `show-download`, and
 * `show-thumbnails-toggle`, each set to `"false"` to hide that group.
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

  /** Selects and reveals a layout-snapshot node by its current document id. */
  selectSnapshotNode(nodeId: string): boolean {
    return this.handle?.selectSnapshotNode(nodeId) ?? false;
  }

  private readOptions(): PreviewerOptions {
    const showThumbs = this.getAttribute('show-thumbnails');
    const showInspector = this.getAttribute('show-inspector');
    const preferenceKey = this.getAttribute('preference-key');
    const saved = preferenceKey ? this.readPreferences(preferenceKey) : undefined;
    // Plugins are opt-in via boolean attributes, so the default element is
    // byte-for-byte the previous component. `structure-view` adds the layout
    // tree; `compliance-view` adds the accessibility/compliance panel.
    const plugins: PreviewerPlugin[] = [];
    if (this.hasAttribute('structure-view')) plugins.push(structureView());
    if (this.hasAttribute('compliance-view')) plugins.push(complianceView());
    return {
      plugins: plugins.length > 0 ? plugins : undefined,
      toolbar: this.readToolbarConfig(),
      showThumbnails: saved?.showThumbnails ?? (showThumbs === null ? undefined : showThumbs !== 'false'),
      showInspector: saved?.showInspector ?? (showInspector === null ? undefined : showInspector !== 'false'),
      initialZoom: saved?.zoom,
      onViewStateChange: preferenceKey ? state => this.writePreferences(preferenceKey, state) : undefined,
      fitMode: this.getAttribute('fit-mode') === 'fit-width' ? 'fit-width' : 'fit-page',
      title: this.getAttribute('label') ?? undefined,
      downloadFilename: this.getAttribute('download-filename') ?? undefined,
      hideBorder: this.getAttribute('hide-border') === 'true',
      styleScrollbars: this.getAttribute('style-scrollbars') === 'true',
    };
  }

  /** Reads the per-group toolbar flags. A group attribute defaults to shown and
   * is hidden only by an explicit `"false"`. Returns undefined when no toolbar
   * attribute is present, leaving the full toolbar in place. */
  private readToolbarConfig(): ToolbarConfig | undefined {
    const flag = (name: string): boolean | undefined => {
      const value = this.getAttribute(name);
      return value === null ? undefined : value !== 'false';
    };
    const config: ToolbarConfig = {
      thumbnails: flag('show-thumbnails-toggle'),
      pageNav: flag('show-page-nav'),
      zoom: flag('show-zoom'),
      fullscreen: flag('show-fullscreen'),
      download: flag('show-download'),
    };
    return Object.values(config).some(v => v !== undefined) ? config : undefined;
  }

  private readPreferences(key: string): Partial<PreviewerViewState> | undefined {
    try {
      const value = this.ownerDocument.defaultView?.localStorage.getItem(key);
      if (!value) return undefined;
      const parsed = JSON.parse(value) as Partial<PreviewerViewState>;
      return {
        showThumbnails: typeof parsed.showThumbnails === 'boolean' ? parsed.showThumbnails : undefined,
        showInspector: typeof parsed.showInspector === 'boolean' ? parsed.showInspector : undefined,
        zoom: this.readZoomPreference(parsed.zoom),
      };
    } catch {
      return undefined;
    }
  }

  private readZoomPreference(value: unknown): PreviewerViewState['zoom'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as { mode?: unknown; scale?: unknown };
    if (candidate.mode === 'fit-page' || candidate.mode === 'fit-width') {
      return { mode: candidate.mode };
    }
    if (
      candidate.mode === 'custom' &&
      typeof candidate.scale === 'number' &&
      Number.isFinite(candidate.scale) &&
      candidate.scale > 0
    ) {
      return { mode: 'custom', scale: candidate.scale };
    }
    return undefined;
  }

  private writePreferences(key: string, state: PreviewerViewState): void {
    try {
      this.ownerDocument.defaultView?.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Storage can be unavailable (privacy mode, sandboxed frames, quotas).
    }
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
