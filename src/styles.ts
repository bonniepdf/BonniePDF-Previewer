// The component's stylesheet, scoped to the shadow root. Because it lives behind
// a shadow boundary, host-page rules (e.g. a global `* { font-family: inherit }`
// reset) cannot reach the SVG pages — the very class of bug that plagues
// light-DOM embedding is structurally impossible here.
//
// Theming: every colour resolves the shared BonniePDF tokens (`--bpdf-c-*` /
// `--bp-*`) set by @bonniepdf/ui-shared on the host document, then a literal
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
  --_text-1: var(--bp-text-1, #0f172a);
  --_text-2: var(--bp-text-2, #475569);
  --_text-3: var(--bp-text-3, #94a3b8);
  --_radius-md: var(--bp-radius, 8px);
  --_radius-sm: 6px;

  display: block;
  height: 100%;
  min-height: 0;
  /* A clean default font for the chrome; the SVG pages carry their own fonts. */
  font-family: var(--bp-font-family, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);
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
.bpp-thumb:hover .bpp-thumb-canvas { border-color: var(--_brand); }
.bpp-thumb-active .bpp-thumb-canvas { border-color: var(--_brand); box-shadow: 0 0 0 1px var(--_brand); }
.bpp-thumb-label { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.bpp-thumb-active .bpp-thumb-label { color: var(--_text-1); font-weight: 600; }
.bpp-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.bpp-pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px; min-width: min-content; }
.bpp-page {
  flex-shrink: 0; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  /* Let the browser skip layout/paint of off-screen pages as a second layer of
     virtualisation on top of the JS mount/unmount. */
  content-visibility: auto;
}
.bpp-page svg { display: block; width: 100%; height: 100%; }

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

/* ── Custom Scrollbars ───────────────────────────────────────────────────── */
.bpp-styled-scrollbars .bpp-thumbs,
.bpp-styled-scrollbars .bpp-scroll {
  scrollbar-color: var(--_divider) transparent;
}
`;
