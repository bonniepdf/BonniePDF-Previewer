import { icon } from './icons';
import { STYLES } from './styles';
import type { FooterConfig, PreviewerOptions, ToolbarConfig } from './types';

/**
 * Rewrites every `id` (and matching `url(#…)` / `href="#…"` reference) in an SVG
 * string with a unique prefix. The same page SVG is mounted twice within one
 * previewer (thumbnail + full page), and each carries `clipPath` ids like
 * `clip0`; browsers resolve `url(#clip0)` to the first match in tree order, so
 * without scoping the full page would borrow the thumbnail's clip. (Distinct
 * previewer *instances* are already isolated by their separate shadow roots.)
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replace(/\b(xlink:href|href)="#([^"]+)"/g, (_, attr, id) => `${attr}="#${prefix}${id}"`);
}

/** Builds the previewer chrome (stylesheet + toolbar + empty body + footer +
 * loading overlay) into the given root. Page/thumbnail content is mounted later
 * by the controller. */
export function buildShell(
  root: ShadowRoot | HTMLElement,
  opts: Required<
    Pick<PreviewerOptions, 'showThumbnails' | 'hideBorder' | 'styleScrollbars' | 'title' | 'fitMode'>
  > & { toolbar: Required<ToolbarConfig>; footer?: { text: string } },
): void {
  const showThumbs = opts.showThumbnails;
  const tb = opts.toolbar;

  // Each configurable group is emitted only when enabled; the separators are
  // then interleaved between the *present* groups so a hidden group never leaves
  // a dangling divider behind. The inspector end-slot is always present (plugins
  // append into it) and carries no leading separator, matching the prior markup.
  const groups: string[] = [];
  if (tb.thumbnails) {
    groups.push(`<div class="bpp-group" role="group" aria-label="Page thumbnails">
      <button type="button" class="bpp-btn${showThumbs ? ' bpp-btn-active' : ''}" data-toggle-thumbs
        aria-label="Toggle page thumbnails" aria-pressed="${showThumbs}"
        title="${showThumbs ? 'Hide' : 'Show'} page thumbnails">
        ${icon('panel-left-close', 'bpp-icon bpp-icon-thumbs-open')}
        ${icon('panel-left', 'bpp-icon bpp-icon-thumbs-closed')}
      </button>
    </div>`);
  }
  if (tb.pageNav) {
    groups.push(`<div class="bpp-group" role="group" aria-label="Page navigation">
      <button type="button" class="bpp-btn" data-prev aria-label="Previous page" title="Previous page" disabled>
        ${icon('chevron-left')}
      </button>
      <span class="bpp-pages-label" data-page-label role="status" aria-label="Page 1">
        <span class="bpp-page-current" aria-hidden="true" data-current-page>0</span>
        <span class="bpp-page-sep" aria-hidden="true">/</span>
        <span class="bpp-page-total" aria-hidden="true" data-total-pages>0</span>
      </span>
      <button type="button" class="bpp-btn" data-next aria-label="Next page" title="Next page" disabled>
        ${icon('chevron-right')}
      </button>
    </div>`);
  }
  if (tb.zoom) {
    groups.push(`<div class="bpp-group" role="group" aria-label="Zoom">
      <button type="button" class="bpp-btn" data-zoom-out aria-label="Zoom out" title="Zoom out">
        ${icon('zoom-out')}
      </button>
      <select class="bpp-zoom" data-zoom-select aria-label="Zoom level" title="Zoom level">
        <option value="fit-page">Fit page</option>
        <option value="fit-width">Fit width</option>
        <option value="custom" data-custom-zoom hidden>100%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="3">300%</option>
      </select>
      <button type="button" class="bpp-btn" data-zoom-in aria-label="Zoom in" title="Zoom in">
        ${icon('zoom-in')}
      </button>
    </div>`);
  }
  if (tb.fullscreen) {
    groups.push(`<div class="bpp-group" role="group" aria-label="Preview display">
      <button type="button" class="bpp-btn" data-fullscreen aria-label="Full screen" aria-pressed="false" title="Full screen">
        ${icon('maximize', 'bpp-icon bpp-icon-fullscreen-open')}
        ${icon('minimize', 'bpp-icon bpp-icon-fullscreen-close')}
        <span class="bpp-fullscreen-label">Exit Fullscreen</span>
      </button>
    </div>`);
  }
  if (tb.download) {
    groups.push(`<div class="bpp-group" role="group" aria-label="Download">
      <button type="button" class="bpp-btn bpp-btn-download" data-download aria-label="Download PDF" title="Download PDF" disabled>
        ${icon('download')}
        <span class="bpp-btn-label">Download PDF</span>
      </button>
    </div>`);
  }

  const separator = '<div class="bpp-sep" role="separator" aria-hidden="true"></div>';
  const toolbarInner = groups.join(separator);

  root.innerHTML = `
<style>${STYLES}</style>
<div class="bpp${opts.hideBorder ? ' bpp-no-border' : ''}${opts.styleScrollbars ? ' bpp-styled-scrollbars' : ''}" part="container" role="region" aria-label="${escapeAttr(opts.title)}">
  <div class="bpp-toolbar" role="toolbar" aria-label="Document preview controls">
    ${toolbarInner}
    <div class="bpp-group bpp-group-end" role="group" aria-label="Inspector" data-toolbar-end></div>
  </div>
  <div class="bpp-body">
    <nav class="bpp-thumbs" aria-label="Page thumbnails" data-thumbs${showThumbs ? '' : ' hidden'}>
      <ul class="bpp-thumbs-list" data-thumbs-list></ul>
    </nav>
    <div class="bpp-scroll" data-scroll tabindex="0">
      <div class="bpp-pages" data-pages></div>
    </div>
  </div>
  ${footerMarkup(opts.footer)}
  <div class="bpp-loading" data-loading role="status" aria-live="polite">
    <span class="bpp-spinner" aria-hidden="true"></span>
    <span>Generating preview…</span>
  </div>
  <div class="bpp-error" data-error role="alert" hidden>
    <span class="bpp-error-title">The preview could not be generated.</span>
    <span class="bpp-error-detail" data-error-detail></span>
  </div>
</div>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** The footer bar's markup. The tag list starts empty — the controller fills it
 * from each loaded document's snapshot metadata. */
function footerMarkup(footer: { text: string } | undefined): string {
  if (!footer) return '';
  return `<footer class="bpp-footer" data-footer aria-label="Document conformance">
    <span class="bpp-footer-text">${escapeAttr(footer.text)}</span>
    <div class="bpp-footer-tags" data-footer-tags></div>
  </footer>`;
}
