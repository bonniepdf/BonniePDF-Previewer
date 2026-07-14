// The component's stylesheet, scoped to the shadow root. Because it lives behind
// a shadow boundary, host-page rules (e.g. a global `* { font-family: inherit }`
// reset) cannot reach the SVG pages — the very class of bug that plagues
// light-DOM embedding is structurally impossible here.
//
// Theming: every colour resolves the shared BonniePDF tokens (`--bpdf-c-*` /
// `--bpdf-*`) set by @bonniepdf/ui-shared on the host document, then a literal
// light-theme default. Custom properties pierce the shadow boundary, so the
// previewer matches the host page's theme automatically.

export const STYLES = /* css */ `
:host {
  --_divider: var(--bpdf-c-divider, #e2e8f0);
  --_bg: var(--bpdf-c-bg, #ffffff);
  --_bg-alt: var(--bpdf-c-bg-alt, #f1f5f9);
  --_bg-soft: var(--bpdf-c-bg-soft, #f8fafc);
  --_brand: var(--bpdf-c-brand-2, #2563eb);
  --_brand-soft: var(--bpdf-c-brand-soft, #dbeafe);
  --_text-1: var(--bpdf-text-1, #0f172a);
  --_text-2: var(--bpdf-text-2, #475569);
  --_text-3: var(--bpdf-text-3, #94a3b8);
  --_radius-md: var(--bpdf-radius, 8px);
  --_radius-sm: 6px;

  /* Compliance severity palette (overridable via --bpdf-* tokens). */
  --_sev-error: var(--bpdf-c-error, #dc2626);
  --_sev-warning: var(--bpdf-c-warning, #d97706);
  --_sev-info: var(--bpdf-c-info, #2563eb);
  --_sev-ok: var(--bpdf-c-success, #16a34a);

  display: block;
  height: 100%;
  min-height: 0;
  /* A clean default font for the chrome; the SVG pages carry their own fonts. */
  font-family: var(--bpdf-font-family, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);
}

/* Maximized web components enter the browser's top layer via the Popover API,
   so host-page stacking contexts (sticky headers, transformed ancestors, etc.)
   cannot cover the previewer. The class selector provides the same sizing for
   createPreviewer() instances mounted directly into a light-DOM element. */
:host(:popover-open),
.bpp-popover-host:popover-open {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
  background: var(--_bg-alt);
  z-index: 2147483647;
}

* { box-sizing: border-box; }

.bpp {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--_divider);
  border-radius: var(--_radius-md);
  overflow: hidden;
  background: var(--_bg-alt);
  container-type: inline-size;
}

.bpp-no-border {
  border-color: transparent;
}

.bpp-fullscreen {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  border-radius: 0;
  z-index: 2147483647;
}

.bpp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--_text-3);
  font-size: 0.875rem;
}

/* ── Toolbar ─────────────────────────────────────────────────────────────── */
.bpp-toolbar {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 12px;
  gap: 4px;
  flex-shrink: 0;
  background: var(--_bg-soft);
  border-bottom: 1px solid var(--_divider);
  z-index: 5;
}
.bpp-group { display: flex; align-items: center; gap: 2px; }
.bpp-group-end { margin-left: auto; }
.bpp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--_radius-sm);
  cursor: pointer;
  color: var(--_text-2);
  font: inherit;
  font-size: 0.8125rem;
}
.bpp-btn:hover:not(:disabled) {
  background: var(--_bg-alt);
  border-color: var(--_divider);
  color: var(--_text-1);
}
.bpp-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.bpp-btn-active, .bpp-btn-active:hover {
  background: var(--_brand-soft);
  border-color: var(--_brand);
  color: var(--_brand);
}
.bpp-btn-download { padding: 0 10px; }
.bpp-btn-label { white-space: nowrap; }
.bpp-icon { width: 16px; height: 16px; flex-shrink: 0; }
.bpp-btn-active .bpp-icon-thumbs-closed,
.bpp-btn:not(.bpp-btn-active) .bpp-icon-thumbs-open { display: none; }
.bpp-fullscreen .bpp-icon-fullscreen-open,
.bpp:not(.bpp-fullscreen) .bpp-icon-fullscreen-close { display: none; }
.bpp-sep { width: 1px; height: 20px; margin: 0 6px; background: var(--_divider); flex-shrink: 0; }
.bpp-pages-label {
  display: flex; align-items: center; gap: 4px; min-width: 56px; justify-content: center;
  font-size: 0.8125rem; color: var(--_text-2); font-variant-numeric: tabular-nums; user-select: none;
}
.bpp-page-current { font-weight: 600; color: var(--_text-1); }
.bpp-page-sep, .bpp-page-total { color: var(--_text-3); }
.bpp-zoom {
  height: 32px; min-width: 96px; padding: 0 8px;
  border: 1px solid var(--_divider); border-radius: var(--_radius-sm);
  background: var(--_bg); color: var(--_text-1); font: inherit; font-size: 0.8125rem; cursor: pointer;
}
.bpp-zoom:hover { border-color: var(--_text-3); }

@container (max-width: 640px) {
  .bpp-btn-label { display: none; }
  .bpp-btn-download { padding: 0 6px; }
}

/* ── Body / thumbnails / pages ───────────────────────────────────────────── */
.bpp-body { display: flex; flex-direction: row; flex: 1; min-height: 0; overflow: hidden; }
.bpp-thumbs {
  width: 168px; flex-shrink: 0; overflow-y: auto;
  background: var(--_bg-soft); border-right: 1px solid var(--_divider);
}
.bpp-thumbs[hidden] { display: none; }
.bpp-thumbs-list { list-style: none; margin: 0; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.bpp-thumb {
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%;
  padding: 0; background: none; border: none; cursor: pointer; color: var(--_text-3); font: inherit;
}
.bpp-thumb-canvas {
  display: block; width: 100%; background: #fff; border: 2px solid transparent; border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.16); overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.bpp-thumb-canvas svg { display: block; width: 100%; height: auto; }
/* Link overlays stay inert in thumbnails - a thumbnail click always navigates
   to the page, never follows the document's links. */
.bpp-thumb-canvas svg a, .bpp-thumb-canvas svg [data-bp-link-page] { pointer-events: none; }
.bpp-thumb:hover .bpp-thumb-canvas { border-color: var(--_brand); }
.bpp-thumb-active .bpp-thumb-canvas { border-color: var(--_brand); box-shadow: 0 0 0 1px var(--_brand); }
.bpp-thumb-label { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.bpp-thumb-active .bpp-thumb-label { color: var(--_text-1); font-weight: 600; }
/* scrollbar-gutter: stable reserves the vertical scrollbar's space at all
   times so the scroll container's clientWidth doesn't jump when the scrollbar
   appears/disappears. Without it, fit-width sizing forms a feedback loop with
   the ResizeObserver (width -> page scale -> content height -> scrollbar ->
   width...), which oscillates forever for documents whose fitted height lands
   right at the viewport boundary (e.g. the pdf-compliance example). */
.bpp-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.bpp-pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px; min-width: min-content; }
.bpp-page {
  position: relative;
  flex-shrink: 0; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  /* Let the browser skip layout/paint of off-screen pages as a second layer of
     virtualisation on top of the JS mount/unmount. */
  content-visibility: auto;
}
.bpp-page-canvas { position: absolute; inset: 0; }
.bpp-page svg { display: block; width: 100%; height: 100%; }

/* ── Plugin overlays (structure view highlights) ──────────────────────────── */
.bpp-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.bpp-hl {
  position: absolute; box-sizing: border-box;
  background: color-mix(in srgb, var(--_brand) 18%, transparent);
  border: 1px solid var(--_brand);
  border-radius: 1px;
}
.bpp-hl-hover {
  background: color-mix(in srgb, var(--_brand) 8%, transparent);
  border-style: dashed;
}

/* ── Shared inspector side panel (tabbed: structure / compliance / …) ──────── */
.bpp-side {
  width: 280px; flex-shrink: 0;
  display: flex; flex-direction: column; min-height: 0;
  border-left: 1px solid var(--_divider); background: var(--_bg-alt);
  font-size: 0.8125rem; color: var(--_text-2);
}
.bpp-side[hidden] { display: none; }
/* Tab strip: one tab per registered panel; hidden when there's only one. */
.bpp-side-tabs {
  display: flex; flex-shrink: 0; gap: 2px; padding: 6px 6px 0;
  border-bottom: 1px solid var(--_divider);
}
.bpp-side-tabs[hidden] { display: none; }
.bpp-side-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 0; border-bottom: 2px solid transparent;
  background: none; color: var(--_text-2); font: inherit; font-size: 0.8125rem;
  font-weight: 600; cursor: pointer; white-space: nowrap;
}
.bpp-side-tab:hover { color: var(--_text-1); }
.bpp-side-tab-active {
  color: var(--_brand); border-bottom-color: var(--_brand);
}
.bpp-side-tab-badge {
  min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; font-size: 0.625rem; font-weight: 700; line-height: 1; color: #fff;
}
.bpp-side-tab-badge[hidden] { display: none; }
.bpp-side-tab-badge-error { background: var(--_sev-error); }
.bpp-side-tab-badge-warning { background: var(--_sev-warning); }
.bpp-side-tab-badge-info { background: var(--_sev-info); }
.bpp-side-tab-badge-ok { background: var(--_sev-ok); }
/* Body: holds every panel's element; only the active one is shown. */
.bpp-side-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
.bpp-side-body > [hidden] { display: none; }
.bpp-side-body > * { flex: 1 1 auto; min-height: 0; }
/* Toolbar toggle: a dot signals unseen issues while the panel is collapsed. */
.bpp-side-toggle { position: relative; }
.bpp-side-toggle-dot {
  position: absolute; top: 3px; right: 3px;
  width: 8px; height: 8px; border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--_bg);
}
.bpp-side-toggle-dot[hidden] { display: none; }
.bpp-side-toggle-dot-error { background: var(--_sev-error); }
.bpp-side-toggle-dot-warning { background: var(--_sev-warning); }
.bpp-side-toggle-dot-info { background: var(--_sev-info); }
.bpp-tree { list-style: none; margin: 0; padding: 6px 0; }
.bpp-tree ul { list-style: none; margin: 0; padding-left: 14px; }
.bpp-tree-row {
  display: flex; align-items: baseline; gap: 6px; width: 100%;
  padding: 3px 10px; border: 0; background: none; text-align: left;
  color: inherit; font: inherit; cursor: pointer;
}
.bpp-tree-row:hover { background: color-mix(in srgb, var(--_brand) 10%, transparent); }
.bpp-tree-row[aria-selected="true"] {
  background: color-mix(in srgb, var(--_brand) 16%, transparent);
  color: var(--_text-1); font-weight: 600;
}
.bpp-tree-type { color: var(--_text-1); }
.bpp-tree-name { color: var(--_text-3); font-style: italic; }
.bpp-tree-size {
  margin-left: auto; padding-left: 8px;
  color: var(--_text-3); font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* ── Loading overlay ─────────────────────────────────────────────────────── */
.bpp-loading {
  position: absolute; inset: 0; z-index: 6;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  background: var(--_bg-alt); color: var(--_text-3); font-size: 0.875rem;
}
.bpp-loading[hidden] { display: none; }
.bpp-spinner {
  width: 34px; height: 34px; border-radius: 50%;
  border: 3px solid var(--_divider); border-top-color: var(--_brand);
  animation: bpp-spin 0.8s linear infinite;
}
@keyframes bpp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .bpp-spinner { animation-duration: 2s; } }

/* ── Compliance view plugin ──────────────────────────────────────────────── */
.bpp-cv-host { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* Summary block. */
.bpp-cv-summary {
  padding: 10px 12px; border-bottom: 1px solid var(--_divider);
  display: flex; flex-direction: column; gap: 8px;
}
.bpp-cv-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.bpp-cv-pill {
  padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
  color: #fff;
}
.bpp-cv-pill-error { background: var(--_sev-error); }
.bpp-cv-pill-warning { background: var(--_sev-warning); }
.bpp-cv-pill-info { background: var(--_sev-info); }
.bpp-cv-pill-zero { opacity: 0.4; }
.bpp-cv-verdict { font-size: 0.8125rem; font-weight: 600; }
.bpp-cv-verdict-pass { color: var(--_sev-ok); }
.bpp-cv-verdict-fail { color: var(--_sev-error); }
.bpp-cv-filter { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--_text-2); cursor: pointer; }

/* Section titles. */
.bpp-cv-section-title {
  font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--_text-3); font-weight: 700; padding: 8px 12px 4px;
}
.bpp-cv-doc-findings { display: flex; flex-direction: column; gap: 6px; }

/* Tree area (scrolls). */
.bpp-cv-tree-host { flex: 1 1 auto; overflow: auto; min-height: 60px; }
.bpp-cv-tree { padding: 4px 0; }
.bpp-cv-row { align-items: center; }

/* Severity dot. */
.bpp-cv-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--_text-3); }
.bpp-cv-dot-error { background: var(--_sev-error); }
.bpp-cv-dot-warning { background: var(--_sev-warning); }
.bpp-cv-dot-info { background: var(--_sev-info); }
.bpp-cv-dot-ok { background: var(--_sev-ok); }
.bpp-cv-dot-artifact { background: transparent; border: 1px dashed var(--_text-3); }
.bpp-cv-dot-none { background: var(--_divider); }

/* Role chips. */
.bpp-cv-role {
  flex: 0 0 auto; padding: 0 5px; border-radius: 4px; font-size: 0.6875rem;
  font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.5;
  background: var(--_bg-soft); color: var(--_text-2); border: 1px solid var(--_divider);
}
.bpp-cv-role-heading { background: color-mix(in srgb, var(--_brand) 14%, transparent); color: var(--_brand); border-color: transparent; }
.bpp-cv-role-figure { background: color-mix(in srgb, var(--_sev-info) 14%, transparent); color: var(--_sev-info); border-color: transparent; }
.bpp-cv-role-table { background: color-mix(in srgb, var(--_sev-ok) 16%, transparent); color: var(--_sev-ok); border-color: transparent; }
.bpp-cv-role-artifact { background: transparent; color: var(--_text-3); border-style: dashed; }

/* Detail pane. */
.bpp-cv-detail { border-top: 1px solid var(--_divider); max-height: 42%; overflow: auto; flex: 0 0 auto; }
.bpp-cv-detail-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.bpp-cv-detail-head { display: flex; align-items: center; gap: 6px; padding: 0 12px 6px; }
.bpp-cv-detail-type { font-weight: 700; color: var(--_text-1); font-size: 0.8125rem; }
.bpp-cv-attr { margin: 0 12px; font-size: 0.75rem; color: var(--_text-2); font-style: italic; }
.bpp-cv-empty { padding: 4px 12px; font-size: 0.75rem; color: var(--_text-3); }

/* Finding cards. */
.bpp-cv-finding {
  border: 1px solid var(--_divider); border-left-width: 3px; border-radius: var(--_radius-sm);
  padding: 8px 10px; background: var(--_bg); display: flex; flex-direction: column; gap: 5px;
}
.bpp-cv-finding-error { border-left-color: var(--_sev-error); }
.bpp-cv-finding-warning { border-left-color: var(--_sev-warning); }
.bpp-cv-finding-info { border-left-color: var(--_sev-info); }
.bpp-cv-finding-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bpp-cv-badge {
  padding: 1px 6px; border-radius: 4px; font-size: 0.625rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em; color: #fff;
}
.bpp-cv-badge-error { background: var(--_sev-error); }
.bpp-cv-badge-warning { background: var(--_sev-warning); }
.bpp-cv-badge-info { background: var(--_sev-info); }
.bpp-cv-clause { font-size: 0.6875rem; color: var(--_text-3); font-variant-numeric: tabular-nums; }
.bpp-cv-msg { margin: 0; font-size: 0.75rem; color: var(--_text-1); line-height: 1.45; }
.bpp-cv-fix { margin: 0; font-size: 0.75rem; color: var(--_text-2); line-height: 1.45; }
.bpp-cv-fix-label { font-weight: 700; color: var(--_sev-ok); }
.bpp-cv-jump {
  align-self: flex-start; margin-top: 2px; padding: 3px 8px; border: 1px solid var(--_divider);
  border-radius: var(--_radius-sm); background: var(--_bg-soft); color: var(--_brand);
  font: inherit; font-size: 0.6875rem; font-weight: 600; cursor: pointer;
}
.bpp-cv-jump:hover { background: var(--_brand-soft); }

/* On-page markers (issues heatmap) + selection. */
.bpp-cv-mark { position: absolute; box-sizing: border-box; border-radius: 1px; border: 1px solid transparent; }
.bpp-cv-mark-error { background: color-mix(in srgb, var(--_sev-error) 12%, transparent); border-color: color-mix(in srgb, var(--_sev-error) 55%, transparent); }
.bpp-cv-mark-warning { background: color-mix(in srgb, var(--_sev-warning) 12%, transparent); border-color: color-mix(in srgb, var(--_sev-warning) 55%, transparent); }
.bpp-cv-mark-info { background: color-mix(in srgb, var(--_sev-info) 10%, transparent); border-color: color-mix(in srgb, var(--_sev-info) 45%, transparent); }
.bpp-cv-sel { position: absolute; box-sizing: border-box; border-radius: 1px; background: color-mix(in srgb, var(--_brand) 16%, transparent); border: 2px solid var(--_brand); }
.bpp-cv-sel-error { background: color-mix(in srgb, var(--_sev-error) 20%, transparent); border-color: var(--_sev-error); }
.bpp-cv-sel-warning { background: color-mix(in srgb, var(--_sev-warning) 20%, transparent); border-color: var(--_sev-warning); }
.bpp-cv-sel-info { background: color-mix(in srgb, var(--_sev-info) 18%, transparent); border-color: var(--_sev-info); }

/* ── Custom Scrollbars ───────────────────────────────────────────────────── */
.bpp-styled-scrollbars .bpp-thumbs,
.bpp-styled-scrollbars .bpp-scroll {
  scrollbar-color: var(--_divider) transparent;
}
`;
