import { buildShell, namespaceSvgIds } from './dom';
import { icon } from './icons';
import type {
  LoadOptions,
  PreviewerHandle,
  PreviewerOptions,
  PreviewerPlugin,
  PreviewerPluginContext,
  PreviewerLoadContext,
  PreviewPage,
  PreviewerZoomState,
} from './types';

const PAGE_PAD = 24;
const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const PAGE_MOUNT_MARGIN = '1500px 0px';
const THUMB_MOUNT_MARGIN = '800px 0px';

// Inspector panel resize bounds. The panel is clamped between a hard minimum and
// maximum, and additionally never allowed to squeeze the document area below
// SIDE_DOC_MIN — whichever constraint is tighter wins.
const SIDE_MIN_WIDTH = 200;
const SIDE_MAX_WIDTH = 640;
const SIDE_DOC_MIN = 320;

const clamp = (s: number) => Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);

/**
 * Builds a PDF previewer into `container` (a shadow root for the web component,
 * or any element for light-DOM use) and returns a handle to drive it. The
 * container's chrome renders immediately in a loading state; call `load()` with
 * the document's pages to populate it.
 */
export function createPreviewer(
  container: ShadowRoot | HTMLElement,
  options: PreviewerOptions = {},
): PreviewerHandle {
  const opts = {
    plugins: options.plugins ?? [],
    showThumbnails: options.showThumbnails ?? true,
    showInspector: options.showInspector,
    initialZoom: options.initialZoom,
    onViewStateChange: options.onViewStateChange ?? (() => {}),
    fitMode: options.fitMode ?? 'fit-page',
    title: options.title ?? 'PDF preview',
    downloadFilename: options.downloadFilename ?? 'document.pdf',
    hideBorder: options.hideBorder ?? false,
    styleScrollbars: options.styleScrollbars ?? false,
    toolbar: {
      thumbnails: options.toolbar?.thumbnails ?? true,
      pageNav: options.toolbar?.pageNav ?? true,
      zoom: options.toolbar?.zoom ?? true,
      fullscreen: options.toolbar?.fullscreen ?? true,
      download: options.toolbar?.download ?? true,
    },
  };

  buildShell(container, opts);

  const hostEl = container instanceof ShadowRoot ? (container.host as HTMLElement) : container;
  const ownerDoc = hostEl.ownerDocument;
  const q = <T extends Element>(sel: string) => container.querySelector<T>(sel);

  // Teardown plumbing: all listeners share one AbortController; observers and the
  // injected font stylesheet are tracked explicitly.
  let listeners = new AbortController();
  let observers: Array<{ disconnect(): void }> = [];
  let fontStyle: HTMLStyleElement | null = null;
  let disposed = false;
  let exitFullscreenMode: (() => void) | null = null;

  // ── Plugin host ────────────────────────────────────────────────────────────
  // Per-load state the plugin context closes over via mutable refs, so a single
  // context object stays valid across loads.
  const plugins: PreviewerPlugin[] = opts.plugins;
  const setupCleanups: Array<() => void> = [];
  let curPageEls: HTMLElement[] = [];
  let curOverlays: Array<HTMLElement | null> = [];
  let curScale: () => number = () => 1;
  let curScrollToPage: (n: number) => void = () => {};

  // ── Shared side-panel region ────────────────────────────────────────────────
  // All plugin side panels live in ONE collapsible region with a tab strip; only
  // one panel shows at a time and a single toolbar button toggles the region.
  type Tone = 'error' | 'warning' | 'info' | 'ok';
  interface RegisteredPanel {
    id: string;
    label: string;
    element: HTMLElement;
    tabBtn: HTMLButtonElement;
    badgeEl: HTMLElement;
    onVisibilityChange?: (visible: boolean) => void;
    badgeTone: Tone | null;
  }
  const sidePanels: RegisteredPanel[] = [];
  let activePanelId: string | null = null;
  let regionVisible = false;
  let sideAside: HTMLElement | null = null;
  let sideResizer: HTMLElement | null = null;
  let sideTabs: HTMLElement | null = null;
  let sideBody: HTMLElement | null = null;
  let inspectorToggle: HTMLButtonElement | null = null;
  let inspectorDot: HTMLElement | null = null;
  let showThumbnails = opts.showThumbnails;
  let viewZoom: PreviewerZoomState =
    opts.initialZoom?.mode === 'custom'
      ? { mode: 'custom', scale: clamp(opts.initialZoom.scale ?? 1) }
      : { mode: opts.initialZoom?.mode ?? opts.fitMode };

  function notifyViewState(): void {
    opts.onViewStateChange({
      showThumbnails,
      showInspector: regionVisible,
      zoom: { ...viewZoom },
    });
  }

  const TONE_RANK: Record<Tone, number> = { error: 3, warning: 2, info: 1, ok: 0 };

  function updateInspectorDot(): void {
    if (!inspectorDot) return;
    let worst: Tone | null = null;
    for (const p of sidePanels) {
      if (p.badgeTone && (worst === null || TONE_RANK[p.badgeTone] > TONE_RANK[worst])) worst = p.badgeTone;
    }
    if (worst && worst !== 'ok') {
      inspectorDot.hidden = false;
      inspectorDot.className = `bpp-side-toggle-dot bpp-side-toggle-dot-${worst}`;
    } else {
      inspectorDot.hidden = true;
    }
  }

  function updateTabStripVisibility(): void {
    // The tab strip is only useful when there is something to switch between.
    if (sideTabs) sideTabs.hidden = sidePanels.length < 2;
  }

  function showRegion(): void {
    regionVisible = true;
    if (sideAside) sideAside.hidden = false;
    if (sideResizer) sideResizer.hidden = false;
    inspectorToggle?.setAttribute('aria-pressed', 'true');
    inspectorToggle?.classList.add('bpp-btn-active');
    notifyViewState();
  }

  function hideRegion(): void {
    regionVisible = false;
    if (sideAside) sideAside.hidden = true;
    if (sideResizer) sideResizer.hidden = true;
    inspectorToggle?.setAttribute('aria-pressed', 'false');
    inspectorToggle?.classList.remove('bpp-btn-active');
    sidePanels.find(p => p.id === activePanelId)?.onVisibilityChange?.(false);
    notifyViewState();
  }

  function activatePanel(id: string | null): void {
    if (!id) return;
    const next = sidePanels.find(p => p.id === id);
    if (!next) return;
    // Clicking the already-active tab while open is a no-op.
    if (regionVisible && activePanelId === id) return;

    const prevId = activePanelId;
    if (!regionVisible) showRegion();
    if (prevId && prevId !== id) {
      const prev = sidePanels.find(p => p.id === prevId);
      if (prev) {
        prev.element.hidden = true;
        prev.tabBtn.setAttribute('aria-selected', 'false');
        prev.tabBtn.classList.remove('bpp-side-tab-active');
        prev.onVisibilityChange?.(false);
      }
    }
    activePanelId = id;
    next.element.hidden = false;
    next.tabBtn.setAttribute('aria-selected', 'true');
    next.tabBtn.classList.add('bpp-side-tab-active');
    next.onVisibilityChange?.(true);
  }

  /** Clamps a requested panel width to the configured bounds and the room the
   * document area needs, so neither side can be dragged away entirely. */
  function clampSideWidth(px: number): number {
    const bodyWidth = q<HTMLElement>('.bpp-body')?.clientWidth ?? 0;
    const maxByContainer = bodyWidth > 0 ? bodyWidth - SIDE_DOC_MIN : SIDE_MAX_WIDTH;
    const max = Math.max(SIDE_MIN_WIDTH, Math.min(SIDE_MAX_WIDTH, maxByContainer));
    return Math.min(Math.max(px, SIDE_MIN_WIDTH), max);
  }

  function setSideWidth(px: number): void {
    if (!sideAside) return;
    const w = clampSideWidth(px);
    sideAside.style.width = `${w}px`;
    sideResizer?.setAttribute('aria-valuenow', String(Math.round(w)));
  }

  function setupSideResizer(handle: HTMLElement): void {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!sideAside) return;
      dragging = true;
      startX = event.clientX;
      startWidth = sideAside.getBoundingClientRect().width;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('bpp-side-resizer-active');
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return;
      // The panel is docked on the right, so dragging left (a negative delta)
      // widens it and dragging right narrows it.
      setSideWidth(startWidth + (startX - event.clientX));
    });

    const endDrag = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('bpp-side-resizer-active');
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    // Keyboard resizing for the separator (arrow keys nudge; Shift for a larger step).
    handle.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!sideAside) return;
      const step = event.shiftKey ? 48 : 16;
      const current = sideAside.getBoundingClientRect().width;
      if (event.key === 'ArrowLeft') {
        setSideWidth(current + step);
        event.preventDefault();
      } else if (event.key === 'ArrowRight') {
        setSideWidth(current - step);
        event.preventDefault();
      }
    });
  }

  function ensureSideChrome(): void {
    if (sideAside) return;
    sideAside = ownerDoc.createElement('aside');
    sideAside.className = 'bpp-side';
    sideAside.hidden = true;
    sideAside.setAttribute('aria-label', 'Inspector');
    sideTabs = ownerDoc.createElement('div');
    sideTabs.className = 'bpp-side-tabs';
    sideTabs.setAttribute('role', 'tablist');
    sideTabs.hidden = true;
    sideBody = ownerDoc.createElement('div');
    sideBody.className = 'bpp-side-body';
    sideAside.append(sideTabs, sideBody);

    // Draggable splitter between the document scroll area and the inspector. It
    // straddles the panel's left border (via negative margins in CSS) and is
    // hidden whenever the region is collapsed.
    sideResizer = ownerDoc.createElement('div');
    sideResizer.className = 'bpp-side-resizer';
    sideResizer.hidden = true;
    sideResizer.setAttribute('role', 'separator');
    sideResizer.setAttribute('aria-orientation', 'vertical');
    sideResizer.setAttribute('aria-label', 'Resize inspector panel');
    sideResizer.setAttribute('aria-valuemin', String(SIDE_MIN_WIDTH));
    sideResizer.setAttribute('aria-valuemax', String(SIDE_MAX_WIDTH));
    sideResizer.setAttribute('aria-valuenow', String(SIDE_MIN_WIDTH));
    sideResizer.tabIndex = 0;
    setupSideResizer(sideResizer);

    q<HTMLElement>('.bpp-body')?.append(sideResizer, sideAside);

    inspectorToggle = ownerDoc.createElement('button');
    inspectorToggle.type = 'button';
    inspectorToggle.className = 'bpp-btn bpp-side-toggle';
    inspectorToggle.title = 'Toggle inspector panel';
    inspectorToggle.setAttribute('aria-label', 'Toggle inspector panel');
    inspectorToggle.setAttribute('aria-pressed', 'false');
    inspectorToggle.innerHTML = icon('panel-right', 'bpp-icon');
    inspectorDot = ownerDoc.createElement('span');
    inspectorDot.className = 'bpp-side-toggle-dot';
    inspectorDot.hidden = true;
    inspectorToggle.append(inspectorDot);
    inspectorToggle.addEventListener('click', () => {
      if (regionVisible) hideRegion();
      else activatePanel(activePanelId ?? sidePanels[0]?.id ?? null);
    });
    (q<HTMLElement>('[data-toolbar-end]') ?? q<HTMLElement>('.bpp-toolbar'))?.append(inspectorToggle);
  }

  const pluginContext: PreviewerPluginContext = {
    ownerDocument: ownerDoc,
    hostElement: hostEl,
    addToolbarItem(element) {
      const slot = q<HTMLElement>('[data-toolbar-end]') ?? q<HTMLElement>('.bpp-toolbar');
      slot?.append(element);
    },
    addSidePanel({ id, label, element, defaultOpen, onVisibilityChange }) {
      ensureSideChrome();
      const tabBtn = ownerDoc.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'bpp-side-tab';
      tabBtn.setAttribute('role', 'tab');
      tabBtn.setAttribute('aria-selected', 'false');
      const labelSpan = ownerDoc.createElement('span');
      labelSpan.className = 'bpp-side-tab-label';
      labelSpan.textContent = label;
      const badgeEl = ownerDoc.createElement('span');
      badgeEl.className = 'bpp-side-tab-badge';
      badgeEl.hidden = true;
      tabBtn.append(labelSpan, badgeEl);
      tabBtn.addEventListener('click', () => activatePanel(id));
      element.dataset.sidePanel = id;
      element.hidden = true;
      sideBody!.append(element);

      const panel: RegisteredPanel = { id, label, element, tabBtn, badgeEl, onVisibilityChange, badgeTone: null };
      sidePanels.push(panel);
      sidePanels.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      sideTabs!.replaceChildren(...sidePanels.map(p => p.tabBtn));
      updateTabStripVisibility();
      // The first panel that asks to open wins; later panels become quiet tabs.
      const shouldOpen = opts.showInspector ?? defaultOpen;
      if (shouldOpen && !regionVisible && activePanelId === null) activatePanel(id);

      return {
        setVisible(visible: boolean) {
          if (visible) activatePanel(id);
          else if (activePanelId === id && regionVisible) hideRegion();
        },
        setBadge(text: string | null, tone: Tone = 'info') {
          if (text == null || text === '') {
            badgeEl.hidden = true;
            badgeEl.textContent = '';
            panel.badgeTone = null;
          } else {
            badgeEl.hidden = false;
            badgeEl.textContent = text;
            badgeEl.className = `bpp-side-tab-badge bpp-side-tab-badge-${tone}`;
            panel.badgeTone = tone;
          }
          updateInspectorDot();
        },
      };
    },
    pageElement: index => curPageEls[index] ?? null,
    overlayFor(index) {
      const host = curPageEls[index];
      if (!host) return null;
      let overlay = curOverlays[index];
      if (!overlay) {
        overlay = ownerDoc.createElement('div');
        overlay.className = 'bpp-overlay';
        host.append(overlay);
        curOverlays[index] = overlay;
      }
      return overlay;
    },
    scale: () => curScale(),
    pageCount: () => curPageEls.length,
    scrollToPage: n => curScrollToPage(n),
  };

  // Plugin setup runs once, against the chrome built above.
  for (const plugin of plugins) {
    try {
      const cleanup = plugin.setup?.(pluginContext);
      if (cleanup) setupCleanups.push(cleanup);
    } catch (err) {
      console.error(`[bonniepdf-previewer] plugin "${plugin.name}" setup failed`, err);
    }
  }

  function load(pages: PreviewPage[], loadOptions: LoadOptions = {}): void {
    if (disposed) return;
    // A fresh load supersedes any previous one.
    listeners.abort();
    listeners = new AbortController();
    for (const o of observers) o.disconnect();
    observers = [];
    teardownPlugins();
    const signal = listeners.signal;

    injectFonts(loadOptions.fontFaceCss);

    const scroll = q<HTMLElement>('[data-scroll]')!;
    const pagesContainer = q<HTMLElement>('[data-pages]')!;
    const thumbsNav = q<HTMLElement>('[data-thumbs]');
    const thumbsList = q<HTMLElement>('[data-thumbs-list]')!;

    const svgFor = (i: number) => pages[i].svg;

    // ── Build placeholders (empty until lazily mounted) ──────────────────────
    const thumbCanvases: HTMLElement[] = [];
    const thumbButtons: HTMLButtonElement[] = [];
    const thumbItems = pages.map((page, index) => {
      const li = ownerDoc.createElement('li');
      const button = ownerDoc.createElement('button');
      button.type = 'button';
      button.className = `bpp-thumb${index === 0 ? ' bpp-thumb-active' : ''}`;
      button.setAttribute('aria-label', `Go to page ${index + 1}`);
      if (index === 0) button.setAttribute('aria-current', 'page');
      button.dataset.thumb = String(index + 1);
      thumbButtons.push(button);
      const canvas = ownerDoc.createElement('span');
      canvas.className = 'bpp-thumb-canvas';
      canvas.style.aspectRatio = `${page.width} / ${page.height}`;
      thumbCanvases.push(canvas);
      const label = ownerDoc.createElement('span');
      label.className = 'bpp-thumb-label';
      label.textContent = String(index + 1);
      button.append(canvas, label);
      li.append(button);
      return li;
    });

    // Each page is `.bpp-page > .bpp-page-canvas` (the lazily-mounted SVG host).
    // Plugin overlays are appended to `.bpp-page` as siblings of the canvas, so
    // they survive the windowed mount/unmount that wipes the canvas content.
    const pageCanvases: HTMLElement[] = [];
    const pageEls = pages.map((page, index) => {
      const el = ownerDoc.createElement('div');
      el.className = 'bpp-page';
      el.dataset.pageIndex = String(index);
      el.style.width = `${page.width}px`;
      el.style.height = `${page.height}px`;
      const canvas = ownerDoc.createElement('div');
      canvas.className = 'bpp-page-canvas';
      el.append(canvas);
      pageCanvases.push(canvas);
      return el;
    });

    thumbsList.replaceChildren(...thumbItems);
    pagesContainer.replaceChildren(...pageEls);

    observeLazyMount(pageCanvases, svgFor, i => `p${i}-`, scroll, PAGE_MOUNT_MARGIN);
    observeLazyMount(thumbCanvases, svgFor, i => `t${i}-`, thumbsNav, THUMB_MOUNT_MARGIN, /* decorative */ true);

    // ── Viewer state ─────────────────────────────────────────────────────────
    let fitMode: 'fit-page' | 'fit-width' | 'custom' = viewZoom.mode;
    let customScale = viewZoom.mode === 'custom' ? clamp(viewZoom.scale ?? 1) : 1;
    let currentPage = 1;
    let viewport = { width: scroll.clientWidth, height: scroll.clientHeight };
    const totalPages = pages.length;

    // Toolbar handles
    const shell = q<HTMLElement>('.bpp');
    const toggleThumbs = q<HTMLButtonElement>('[data-toggle-thumbs]');
    const prev = q<HTMLButtonElement>('[data-prev]');
    const next = q<HTMLButtonElement>('[data-next]');
    const zoomOut = q<HTMLButtonElement>('[data-zoom-out]');
    const zoomIn = q<HTMLButtonElement>('[data-zoom-in]');
    const zoomSelect = q<HTMLSelectElement>('[data-zoom-select]');
    const customZoom = q<HTMLOptionElement>('[data-custom-zoom]');
    const currentPageEl = q<HTMLElement>('[data-current-page]');
    const totalPagesEl = q<HTMLElement>('[data-total-pages]');
    const pageLabel = q<HTMLElement>('[data-page-label]');
    const fullscreen = q<HTMLButtonElement>('[data-fullscreen]');
    const download = q<HTMLButtonElement>('[data-download]');
    let isFullscreen = shell?.classList.contains('bpp-fullscreen') ?? false;
    let zoomBeforeFullscreen: PreviewerZoomState | null = null;

    const effectiveScale = (): number => {
      if (fitMode === 'custom') return customScale;
      const active = pages[currentPage - 1] ?? pages[0];
      if (!active || viewport.width === 0) return 1;
      const fitWidth = Math.max(viewport.width - PAGE_PAD * 2, 1) / active.width;
      if (fitMode === 'fit-width') return fitWidth;
      return Math.min(fitWidth, Math.max(viewport.height - PAGE_PAD * 2, 1) / active.height);
    };

    const syncToolbar = (scale = effectiveScale()): void => {
      toggleThumbs?.classList.toggle('bpp-btn-active', showThumbnails);
      toggleThumbs?.setAttribute('aria-pressed', String(showThumbnails));
      toggleThumbs?.setAttribute('title', showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails');
      if (currentPageEl) currentPageEl.textContent = String(currentPage);
      pageLabel?.setAttribute('aria-label', `Page ${currentPage} of ${totalPages}`);
      if (prev) prev.disabled = currentPage <= 1;
      if (next) next.disabled = currentPage >= totalPages;
      if (zoomOut) zoomOut.disabled = scale <= MIN_SCALE;
      if (zoomIn) zoomIn.disabled = scale >= MAX_SCALE;
      if (fullscreen) {
        fullscreen.classList.toggle('bpp-btn-active', isFullscreen);
        fullscreen.setAttribute('aria-pressed', String(isFullscreen));
        fullscreen.setAttribute('aria-label', isFullscreen ? 'Exit full screen' : 'Full screen');
        fullscreen.setAttribute('title', isFullscreen ? 'Exit full screen' : 'Full screen');
      }
      if (zoomSelect) {
        if (customZoom) {
          customZoom.textContent = `${Math.round(scale * 100)}%`;
          customZoom.hidden = fitMode !== 'custom';
        }
        zoomSelect.value = fitMode;
      }
      thumbButtons.forEach((button, i) => {
        const active = i + 1 === currentPage;
        button.classList.toggle('bpp-thumb-active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    };

    const syncPages = (): void => {
      const scale = effectiveScale();
      pageEls.forEach((el, i) => {
        const page = pages[i];
        if (!page) return;
        el.style.width = `${page.width * scale}px`;
        el.style.height = `${page.height * scale}px`;
      });
      syncToolbar(scale);
      // Notify plugins so overlays can re-scale with the page.
      for (const plugin of plugins) {
        try {
          plugin.sync?.({ scale, currentPage });
        } catch (err) {
          console.error(`[bonniepdf-previewer] plugin "${plugin.name}" sync failed`, err);
        }
      }
    };

    const rememberUserZoom = (): void => {
      viewZoom = fitMode === 'custom' ? { mode: fitMode, scale: customScale } : { mode: fitMode };
      // A choice made while fullscreen is intentional and should survive exit,
      // rather than being replaced by the pre-fullscreen zoom.
      if (isFullscreen) zoomBeforeFullscreen = null;
      notifyViewState();
    };

    type FullscreenTopLayer = 'popover' | 'native' | null;
    const hostPopoverIsOpen = (): boolean => {
      try {
        return hostEl.matches(':popover-open');
      } catch {
        return false;
      }
    };
    let fullscreenTopLayer: FullscreenTopLayer =
      ownerDoc.fullscreenElement === hostEl ? 'native' : hostPopoverIsOpen() ? 'popover' : null;

    const applyFullscreenState = (expanded: boolean): void => {
      if (expanded === isFullscreen) return;
      if (expanded) {
        zoomBeforeFullscreen = fitMode === 'custom' ? { mode: fitMode, scale: customScale } : { mode: fitMode };
        fitMode = 'fit-page';
      } else if (zoomBeforeFullscreen) {
        fitMode = zoomBeforeFullscreen.mode;
        if (zoomBeforeFullscreen.mode === 'custom') customScale = clamp(zoomBeforeFullscreen.scale ?? 1);
        zoomBeforeFullscreen = null;
      }
      isFullscreen = expanded;
      shell?.classList.toggle('bpp-fullscreen', isFullscreen);
      viewport = { width: scroll.clientWidth, height: scroll.clientHeight };
      syncToolbar();
      const win = ownerDoc.defaultView;
      if (typeof win?.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(() => {
          viewport = { width: scroll.clientWidth, height: scroll.clientHeight };
          syncPages();
        });
      } else {
        syncPages();
      }
    };

    const leaveTopLayer = (): void => {
      if (fullscreenTopLayer === 'popover') {
        try {
          (hostEl as HTMLElement & { hidePopover?: () => void }).hidePopover?.();
        } catch {
          /* The popover may already have been dismissed by the browser. */
        }
        hostEl.removeAttribute('popover');
        hostEl.classList.remove('bpp-popover-host');
        fullscreenTopLayer = null;
      } else if (fullscreenTopLayer === 'native' && ownerDoc.fullscreenElement === hostEl) {
        void ownerDoc.exitFullscreen?.().catch(() => {});
      }
    };

    const enterTopLayer = (): void => {
      const popoverHost = hostEl as HTMLElement & { showPopover?: () => void };
      if (typeof popoverHost.showPopover === 'function') {
        try {
          hostEl.classList.add('bpp-popover-host');
          hostEl.setAttribute('popover', 'manual');
          popoverHost.showPopover();
          fullscreenTopLayer = 'popover';
          return;
        } catch {
          hostEl.removeAttribute('popover');
          hostEl.classList.remove('bpp-popover-host');
        }
      }

      // Older browsers without Popover still get a true top-layer fullscreen
      // experience. If that request is unavailable or denied, .bpp-fullscreen
      // remains as the backwards-compatible fixed-position fallback.
      if (typeof hostEl.requestFullscreen === 'function') {
        fullscreenTopLayer = 'native';
        void hostEl.requestFullscreen().catch(() => {
          fullscreenTopLayer = null;
        });
      }
    };

    const setFullscreen = (expanded: boolean): void => {
      applyFullscreenState(expanded);
      if (expanded) enterTopLayer();
      else leaveTopLayer();
    };
    exitFullscreenMode = () => {
      if (isFullscreen) setFullscreen(false);
    };

    const setCurrentPage = (n: number): void => {
      currentPage = Math.min(Math.max(n, 1), totalPages);
      syncToolbar();
    };

    const scrollToPage = (n: number): void => {
      const target = Math.min(Math.max(n, 1), totalPages);
      const el = pageEls[target - 1];
      if (!el) return;
      setCurrentPage(target);
      if (typeof scroll.scrollTo !== 'function') return; // jsdom / non-DOM hosts
      const delta = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      scroll.scrollTo({ top: Math.max(scroll.scrollTop + delta - PAGE_PAD, 0), behavior: 'smooth' });
    };

    // ── Observers (resize + current-page tracking) ───────────────────────────
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        viewport = { width: scroll.clientWidth, height: scroll.clientHeight };
        syncPages();
      });
      ro.observe(scroll);
      observers.push(ro);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      const ratios = new Map<number, number>();
      const io = new IntersectionObserver(
        entries => {
          for (const e of entries) {
            const i = Number((e.target as HTMLElement).dataset.pageIndex);
            ratios.set(i, e.isIntersecting ? e.intersectionRatio : 0);
          }
          let best = -1;
          let bestRatio = 0;
          ratios.forEach((r, i) => {
            if (r > bestRatio) {
              best = i;
              bestRatio = r;
            }
          });
          if (best >= 0) setCurrentPage(best + 1);
        },
        { root: scroll, threshold: [0.1, 0.25, 0.5, 0.75, 1] },
      );
      pageEls.forEach(el => io.observe(el));
      observers.push(io);
    }

    // ── Toolbar wiring ───────────────────────────────────────────────────────
    toggleThumbs?.addEventListener(
      'click',
      () => {
        showThumbnails = !showThumbnails;
        if (thumbsNav) thumbsNav.hidden = !showThumbnails;
        syncPages();
        notifyViewState();
      },
      { signal },
    );
    prev?.addEventListener('click', () => scrollToPage(currentPage - 1), { signal });
    next?.addEventListener('click', () => scrollToPage(currentPage + 1), { signal });
    thumbButtons.forEach(button =>
      button.addEventListener('click', () => scrollToPage(Number(button.dataset.thumb)), { signal }),
    );

    // Internal-link overlays: the SVG export marks internal document links
    // (e.g. VisualToc entries) with data-bp-link-page="N" rects; external links
    // are real SVG <a> elements and need no wiring. Delegated on the scroller so
    // it survives the windowed page mount/unmount.
    scroll.addEventListener(
      'click',
      e => {
        const hit = (e.target as Element | null)?.closest?.('[data-bp-link-page]');
        if (!hit) return;
        const n = Number(hit.getAttribute('data-bp-link-page'));
        if (Number.isFinite(n) && n >= 1) scrollToPage(n);
      },
      { signal },
    );
    zoomOut?.addEventListener(
      'click',
      () => {
        customScale = clamp(effectiveScale() / ZOOM_STEP);
        fitMode = 'custom';
        syncPages();
        rememberUserZoom();
      },
      { signal },
    );
    zoomIn?.addEventListener(
      'click',
      () => {
        customScale = clamp(effectiveScale() * ZOOM_STEP);
        fitMode = 'custom';
        syncPages();
        rememberUserZoom();
      },
      { signal },
    );
    zoomSelect?.addEventListener(
      'change',
      () => {
        const value = zoomSelect.value;
        if (value === 'fit-page' || value === 'fit-width') fitMode = value;
        else if (value !== 'custom') {
          customScale = clamp(Number(value));
          fitMode = 'custom';
        }
        syncPages();
        rememberUserZoom();
      },
      { signal },
    );

    // ── Download (lazy PDF) ──────────────────────────────────────────────────
    fullscreen?.addEventListener('click', () => setFullscreen(!isFullscreen), { signal });
    ownerDoc.addEventListener(
      'fullscreenchange',
      () => {
        if (ownerDoc.fullscreenElement === hostEl) {
          fullscreenTopLayer = 'native';
          if (!isFullscreen) applyFullscreenState(true);
        } else if (fullscreenTopLayer === 'native') {
          fullscreenTopLayer = null;
          if (isFullscreen) applyFullscreenState(false);
        }
      },
      { signal },
    );
    ownerDoc.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Escape' && isFullscreen) setFullscreen(false);
      },
      { signal },
    );

    const filename = loadOptions.downloadFilename ?? opts.downloadFilename;
    let pdfUrl = loadOptions.pdfUrl;
    const provider = loadOptions.pdfProvider;
    if (download) download.disabled = !(pdfUrl || provider);
    download?.addEventListener(
      'click',
      async () => {
        if (!pdfUrl && provider) {
          download.disabled = true;
          try {
            pdfUrl = await provider();
          } catch {
            /* leave enabled to retry */
          } finally {
            download.disabled = false;
          }
        }
        if (pdfUrl) triggerDownload(ownerDoc, pdfUrl, filename);
      },
      { signal },
    );

    // ── Finalise ─────────────────────────────────────────────────────────────
    if (totalPagesEl) totalPagesEl.textContent = String(totalPages);
    if (currentPageEl) currentPageEl.textContent = totalPages > 0 ? '1' : '0';
    if (thumbsNav) thumbsNav.hidden = !showThumbnails;
    const loading = q<HTMLElement>('[data-loading]');
    if (loading) loading.hidden = true;

    // Expose this load's state to the plugin context, then run plugin load().
    curPageEls = pageEls;
    curOverlays = new Array(pages.length).fill(null);
    curScale = effectiveScale;
    curScrollToPage = scrollToPage;
    if (plugins.length > 0) {
      const loadCtx: PreviewerLoadContext = {
        ...pluginContext,
        pages,
        snapshot: loadOptions.snapshot,
        report: loadOptions.report,
      };
      for (const plugin of plugins) {
        try {
          plugin.load?.(loadCtx);
        } catch (err) {
          console.error(`[bonniepdf-previewer] plugin "${plugin.name}" load failed`, err);
        }
      }
    }

    syncPages();
  }

  /** Tears down all plugins for the current load (idempotent). */
  function teardownPlugins(): void {
    for (const plugin of plugins) {
      try {
        plugin.teardown?.();
      } catch (err) {
        console.error(`[bonniepdf-previewer] plugin "${plugin.name}" teardown failed`, err);
      }
    }
    curOverlays = [];
  }

  function selectSnapshotNode(nodeId: string): boolean {
    if (disposed) return false;
    let selected = false;
    for (const plugin of plugins) {
      try {
        if (plugin.selectSnapshotNode?.(nodeId)) selected = true;
      } catch (err) {
        console.error(`[bonniepdf-previewer] plugin "${plugin.name}" selection failed`, err);
      }
    }
    return selected;
  }

  /** Windowed lazy mount/unmount with per-index memoisation of namespaced markup. */
  function observeLazyMount(
    items: HTMLElement[],
    svgFor: (index: number) => string,
    prefixFor: (index: number) => string,
    scrollRoot: HTMLElement | null,
    rootMargin: string,
    decorative = false,
  ): void {
    const cache = new Map<number, string>();
    const mount = (host: HTMLElement, index: number) => {
      if (host.dataset.mounted === 'true') return;
      let html = cache.get(index);
      if (html === undefined) {
        html = namespaceSvgIds(svgFor(index), prefixFor(index));
        cache.set(index, html);
      }
      host.innerHTML = html;
      // Thumbnails are a decorative mini-render — the enclosing button already
      // carries a "Go to page N" label. Hide the cloned SVG from assistive tech
      // and strip the exported PDF's hyperlink hotspots so they don't surface as
      // unnamed, keyboard-focusable links nested inside the thumbnail button
      // (which would trip axe's link-name + nested-interactive rules).
      if (decorative) {
        const svg = host.querySelector('svg');
        if (svg) svg.setAttribute('aria-hidden', 'true');
        for (const anchor of host.querySelectorAll('a')) {
          anchor.removeAttribute('href');
          anchor.removeAttribute('xlink:href');
          anchor.removeAttribute('target');
          anchor.setAttribute('tabindex', '-1');
        }
      }
      host.dataset.mounted = 'true';
    };
    const unmount = (host: HTMLElement) => {
      if (host.dataset.mounted !== 'true') return;
      host.replaceChildren();
      host.dataset.mounted = 'false';
    };

    items.forEach((el, index) => {
      el.dataset.lazyIndex = String(index);
    });
    if (items[0]) mount(items[0], 0);

    if (scrollRoot && typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const host = entry.target as HTMLElement;
            const index = Number(host.dataset.lazyIndex);
            if (entry.isIntersecting) mount(host, index);
            else unmount(host);
          }
        },
        { root: scrollRoot, rootMargin },
      );
      items.forEach(el => io.observe(el));
      observers.push(io);
    } else {
      items.forEach((el, index) => mount(el, index));
    }
  }

  /** Injects the document's embedded `@font-face` CSS at the document level
   * (font resources are document-scoped and reach shadow content). */
  function injectFonts(css: string | undefined): void {
    if (!css) {
      if (fontStyle) {
        fontStyle.remove();
        fontStyle = null;
      }
      return;
    }
    if (!fontStyle) {
      fontStyle = ownerDoc.createElement('style');
      fontStyle.setAttribute('data-bpp-fonts', '');
      ownerDoc.head.appendChild(fontStyle);
    }
    fontStyle.textContent = css;
  }

  function dispose(): void {
    if (disposed) return;
    exitFullscreenMode?.();
    exitFullscreenMode = null;
    disposed = true;
    teardownPlugins();
    for (const cleanup of setupCleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        /* ignore cleanup errors during dispose */
      }
    }
    listeners.abort();
    for (const o of observers) o.disconnect();
    observers = [];
    if (fontStyle) {
      fontStyle.remove();
      fontStyle = null;
    }
  }

  return { load, selectSnapshotNode, dispose };
}

function triggerDownload(doc: Document, url: string, filename: string): void {
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
}
