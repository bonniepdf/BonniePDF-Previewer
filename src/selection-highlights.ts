interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SelectionHighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SelectionHighlightOptions {
  root: ShadowRoot | HTMLElement;
  ownerDocument: Document;
  pageElements: readonly HTMLElement[];
  signal: AbortSignal;
}

interface SelectionHighlightController {
  refresh(): void;
  clear(): void;
}

interface ShadowRootSelection extends ShadowRoot {
  getSelection?: () => Selection | null;
}

const LINE_CENTER_TOLERANCE_RATIO = 0.35;
const MAX_GAP_HEIGHT_RATIO = 1.25;
const MIN_MERGE_GAP = 2;

function finiteRect(rect: RectLike): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function sameLine(a: SelectionHighlightRect, b: SelectionHighlightRect): boolean {
  const aCenter = a.top + a.height / 2;
  const bCenter = b.top + b.height / 2;
  const tolerance = Math.max(1, Math.min(a.height, b.height) * LINE_CENTER_TOLERANCE_RATIO);
  return Math.abs(aCenter - bCenter) <= tolerance;
}

/**
 * Coalesces the small, glyph-level rectangles returned for SVG text into line
 * fragments. The gap cap deliberately scales with line height: it bridges word
 * spacing (including justification) without flooding a column or table gutter.
 */
export function mergeSelectionHighlightRects(
  rects: readonly SelectionHighlightRect[],
): SelectionHighlightRect[] {
  const sorted = rects
    .filter(rect => rect.width > 0 && rect.height > 0)
    .map(rect => ({ ...rect }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const merged: SelectionHighlightRect[] = [];
  for (const rect of sorted) {
    const previous = merged.at(-1);
    if (previous && sameLine(previous, rect)) {
      const previousRight = previous.left + previous.width;
      const gap = rect.left - previousRight;
      const maxGap = Math.max(
        MIN_MERGE_GAP,
        Math.max(previous.height, rect.height) * MAX_GAP_HEIGHT_RATIO,
      );
      if (gap <= maxGap) {
        const left = Math.min(previous.left, rect.left);
        const top = Math.min(previous.top, rect.top);
        const right = Math.max(previousRight, rect.left + rect.width);
        const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
        previous.left = left;
        previous.top = top;
        previous.width = right - left;
        previous.height = bottom - top;
        continue;
      }
    }
    merged.push(rect);
  }
  return merged;
}

function rangeFromStatic(doc: Document, source: StaticRange): Range | null {
  try {
    const range = doc.createRange();
    range.setStart(source.startContainer, source.startOffset);
    range.setEnd(source.endContainer, source.endOffset);
    return range;
  } catch {
    // A selection can become stale while a lazily-mounted page is removed.
    return null;
  }
}

function liveRanges(root: ShadowRoot | HTMLElement, doc: Document): Range[] {
  const documentSelection = doc.getSelection();

  // getComposedRanges is the standards-track way to recover selection
  // boundaries inside a shadow root. Use it first where available; older
  // Chromium exposes ShadowRoot.getSelection(), handled by the fallback below.
  if (root instanceof ShadowRoot && documentSelection) {
    if (typeof documentSelection.getComposedRanges === 'function') {
      try {
        const ranges = documentSelection
          .getComposedRanges({ shadowRoots: [root] })
          .map(source => rangeFromStatic(doc, source))
          .filter((range): range is Range => range !== null && !range.collapsed);
        if (ranges.length > 0) return ranges;
      } catch {
        // Fall through to the legacy and light-DOM paths.
      }
    }

    const shadowSelection = (root as ShadowRootSelection).getSelection?.();
    if (shadowSelection && !shadowSelection.isCollapsed) {
      return Array.from({ length: shadowSelection.rangeCount }, (_, index) => shadowSelection.getRangeAt(index)).filter(
        range => !range.collapsed,
      );
    }
  }

  if (!documentSelection || documentSelection.isCollapsed) return [];
  return Array.from({ length: documentSelection.rangeCount }, (_, index) => documentSelection.getRangeAt(index)).filter(
    range => !range.collapsed,
  );
}

function intersects(a: RectLike, b: RectLike): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

function rangeIntersectsPage(range: Range, page: HTMLElement): boolean {
  if (page.contains(range.commonAncestorContainer)) return true;
  try {
    return range.intersectsNode(page);
  } catch {
    return false;
  }
}

function pageLocalRects(rangeRects: readonly RectLike[], page: HTMLElement): SelectionHighlightRect[] {
  const pageRect = page.getBoundingClientRect();
  if (!finiteRect(pageRect)) return [];

  const local: SelectionHighlightRect[] = [];
  for (const rect of rangeRects) {
    if (!finiteRect(rect) || !intersects(rect, pageRect)) continue;
    const left = Math.max(rect.left, pageRect.left);
    const top = Math.max(rect.top, pageRect.top);
    const right = Math.min(rect.right, pageRect.right);
    const bottom = Math.min(rect.bottom, pageRect.bottom);
    if (right <= left || bottom <= top) continue;
    local.push({ left: left - pageRect.left, top: top - pageRect.top, width: right - left, height: bottom - top });
  }
  return mergeSelectionHighlightRects(local);
}

function clearLayers(pages: readonly HTMLElement[]): void {
  for (const page of pages) page.querySelector(':scope > .bpp-selection-layer')?.remove();
}

/**
 * Paints a continuous selection backdrop for SVG text. Browsers often paint
 * native SVG selection per glyph and leave visible holes at spaces, even though
 * the whitespace remains part of the selected string and clipboard content.
 */
export function installSelectionHighlights(options: SelectionHighlightOptions): SelectionHighlightController {
  const { root, ownerDocument, pageElements, signal } = options;
  let frame = 0;

  const clear = (): void => clearLayers(pageElements);

  const paint = (): void => {
    frame = 0;
    if (signal.aborted) return;

    const ranges = liveRanges(root, ownerDocument);
    if (ranges.length === 0) {
      clear();
      return;
    }

    const measuredRanges: Array<{ range: Range; rects: RectLike[] }> = [];
    for (const range of ranges) {
      // Ignore selections without text (for example an image-only DOM range).
      if (range.toString().length === 0 || typeof range.getClientRects !== 'function') continue;
      try {
        measuredRanges.push({ range, rects: Array.from(range.getClientRects()) });
      } catch {
        // The DOM can change underneath a selection during virtual unmount.
      }
    }

    for (const page of pageElements) {
      // Geometry alone is not sufficient: content from another previewer or a
      // positioned host element may overlap this page in viewport coordinates.
      const clientRects = measuredRanges
        .filter(({ range }) => rangeIntersectsPage(range, page))
        .flatMap(({ rects }) => rects);
      const rects = pageLocalRects(clientRects, page);
      let layer = page.querySelector<HTMLElement>(':scope > .bpp-selection-layer');
      if (rects.length === 0) {
        layer?.remove();
        continue;
      }
      if (!layer) {
        layer = ownerDocument.createElement('div');
        layer.className = 'bpp-selection-layer';
        layer.setAttribute('aria-hidden', 'true');
        page.appendChild(layer);
      }
      const fragments = rects.map(rect => {
        const fragment = ownerDocument.createElement('span');
        fragment.className = 'bpp-selection-rect';
        fragment.style.left = `${rect.left}px`;
        fragment.style.top = `${rect.top}px`;
        fragment.style.width = `${rect.width}px`;
        fragment.style.height = `${rect.height}px`;
        return fragment;
      });
      layer.replaceChildren(...fragments);
    }
  };

  const refresh = (): void => {
    if (signal.aborted || frame !== 0) return;
    const requestFrame = ownerDocument.defaultView?.requestAnimationFrame;
    if (requestFrame) frame = requestFrame.call(ownerDocument.defaultView, paint);
    else paint();
  };

  ownerDocument.addEventListener('selectionchange', refresh, { signal });
  // Selection events are not consistently surfaced at Document when their
  // range lives in a shadow tree. Listen on the root as well and refresh after
  // pointer/keyboard selection gestures as compatibility fallbacks. Calls are
  // animation-frame coalesced, so browsers that emit every path still paint
  // only once per frame.
  root.addEventListener('selectionchange', refresh, { signal });
  root.addEventListener('pointerup', refresh, { signal });
  root.addEventListener(
    'pointermove',
    event => {
      if ((event as PointerEvent).buttons === 1) refresh();
    },
    { signal },
  );
  root.addEventListener('keyup', refresh, { signal });
  signal.addEventListener(
    'abort',
    () => {
      if (frame !== 0) ownerDocument.defaultView?.cancelAnimationFrame?.(frame);
      frame = 0;
      clear();
    },
    { once: true },
  );

  return { refresh, clear };
}
