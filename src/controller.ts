import { buildShell, namespaceSvgIds } from './dom';
import type { LoadOptions, PreviewerHandle, PreviewerOptions, PreviewPage } from './types';

const PAGE_PAD = 24;
const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const PAGE_MOUNT_MARGIN = '1500px 0px';
const THUMB_MOUNT_MARGIN = '800px 0px';

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
  const opts: Required<PreviewerOptions> = {
    showThumbnails: options.showThumbnails ?? true,
    fitMode: options.fitMode ?? 'fit-page',
    title: options.title ?? 'PDF preview',
    downloadFilename: options.downloadFilename ?? 'document.pdf',
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

  function load(pages: PreviewPage[], loadOptions: LoadOptions = {}): void {
    if (disposed) return;
    // A fresh load supersedes any previous one.
    listeners.abort();
    listeners = new AbortController();
    for (const o of observers) o.disconnect();
    observers = [];
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

    const pageEls = pages.map((page, index) => {
      const el = ownerDoc.createElement('div');
      el.className = 'bpp-page';
      el.dataset.pageIndex = String(index);
      el.style.width = `${page.width}px`;
      el.style.height = `${page.height}px`;
      return el;
    });

    thumbsList.replaceChildren(...thumbItems);
    pagesContainer.replaceChildren(...pageEls);

    observeLazyMount(pageEls, svgFor, i => `p${i}-`, scroll, PAGE_MOUNT_MARGIN);
    observeLazyMount(thumbCanvases, svgFor, i => `t${i}-`, thumbsNav, THUMB_MOUNT_MARGIN);

    // ── Viewer state ─────────────────────────────────────────────────────────
    let showThumbnails = opts.showThumbnails;
    let fitMode: 'fit-page' | 'fit-width' | 'custom' = opts.fitMode;
    let customScale = 1;
    let currentPage = 1;
    let viewport = { width: scroll.clientWidth, height: scroll.clientHeight };
    const totalPages = pages.length;

    // Toolbar handles
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
    const download = q<HTMLButtonElement>('[data-download]');

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
      },
      { signal },
    );
    prev?.addEventListener('click', () => scrollToPage(currentPage - 1), { signal });
    next?.addEventListener('click', () => scrollToPage(currentPage + 1), { signal });
    thumbButtons.forEach(button =>
      button.addEventListener('click', () => scrollToPage(Number(button.dataset.thumb)), { signal }),
    );
    zoomOut?.addEventListener(
      'click',
      () => {
        customScale = clamp(effectiveScale() / ZOOM_STEP);
        fitMode = 'custom';
        syncPages();
      },
      { signal },
    );
    zoomIn?.addEventListener(
      'click',
      () => {
        customScale = clamp(effectiveScale() * ZOOM_STEP);
        fitMode = 'custom';
        syncPages();
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
      },
      { signal },
    );

    // ── Download (lazy PDF) ──────────────────────────────────────────────────
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
    syncPages();
  }

  /** Windowed lazy mount/unmount with per-index memoisation of namespaced markup. */
  function observeLazyMount(
    items: HTMLElement[],
    svgFor: (index: number) => string,
    prefixFor: (index: number) => string,
    scrollRoot: HTMLElement | null,
    rootMargin: string,
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
    disposed = true;
    listeners.abort();
    for (const o of observers) o.disconnect();
    observers = [];
    if (fontStyle) {
      fontStyle.remove();
      fontStyle = null;
    }
  }

  return { load, dispose };
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
