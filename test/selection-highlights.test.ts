import { describe, expect, it, vi } from 'vitest';
import { createPreviewer } from '../src/controller';
import { mergeSelectionHighlightRects } from '../src/selection-highlights';
import type { PreviewPage } from '../src/types';

const page: PreviewPage = {
  width: 200,
  height: 300,
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><text x="10 20 34" y="30">a b</text></svg>',
};

describe('SVG text selection highlights', () => {
  it('merges nearby glyph fragments on a line but preserves line and column gaps', () => {
    expect(
      mergeSelectionHighlightRects([
        { left: 10, top: 10, width: 8, height: 12 },
        { left: 22, top: 10, width: 14, height: 12 },
        { left: 80, top: 10, width: 10, height: 12 },
        { left: 10, top: 30, width: 20, height: 12 },
      ]),
    ).toEqual([
      { left: 10, top: 10, width: 26, height: 12 },
      { left: 80, top: 10, width: 10, height: 12 },
      { left: 10, top: 30, width: 20, height: 12 },
    ]);
  });

  it('does not merge tall selection rectangles that overlap across adjacent lines', () => {
    expect(
      mergeSelectionHighlightRects([
        { left: 10, top: 10, width: 40, height: 16 },
        // Font ascender/descender bounds overlap the preceding line by 8px.
        { left: 10, top: 18, width: 60, height: 16 },
      ]),
    ).toEqual([
      { left: 10, top: 10, width: 40, height: 16 },
      { left: 10, top: 18, width: 60, height: 16 },
    ]);
  });

  it('clips and merges selected SVG fragments into a continuous page overlay', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host);
    handle.load([page]);

    const pageElement = host.querySelector<HTMLElement>('.bpp-page')!;
    vi.spyOn(pageElement, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 300,
      bottom: 350,
      width: 200,
      height: 300,
      toJSON: () => ({}),
    });

    const textNode = host.querySelector('.bpp-page text')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    Object.defineProperty(range, 'getClientRects', {
      value: () => [
        { left: 110, top: 70, right: 120, bottom: 84, width: 10, height: 14 },
        { left: 124, top: 70, right: 140, bottom: 84, width: 16, height: 14 },
      ],
    });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    await vi.waitFor(() => expect(host.querySelectorAll('.bpp-selection-rect')).toHaveLength(1));
    const fragments = host.querySelectorAll<HTMLElement>('.bpp-selection-rect');
    expect(fragments).toHaveLength(1);
    expect(fragments[0].style.left).toBe('10px');
    expect(fragments[0].style.top).toBe('20px');
    expect(fragments[0].style.width).toBe('30px');
    expect(fragments[0].style.height).toBe('14px');
    expect(host.querySelector('.bpp-selection-layer')?.getAttribute('aria-hidden')).toBe('true');

    selection.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await vi.waitFor(() => expect(host.querySelector('.bpp-selection-layer')).toBeNull());

    handle.dispose();
    host.remove();
  });

  it('uses composed ranges when the document-level Shadow DOM selection appears collapsed', async () => {
    const element = document.createElement('div');
    const shadow = element.attachShadow({ mode: 'open' });
    document.body.append(element);
    const handle = createPreviewer(shadow);
    handle.load([page]);

    const pageElement = shadow.querySelector<HTMLElement>('.bpp-page')!;
    vi.spyOn(pageElement, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 300,
      bottom: 350,
      width: 200,
      height: 300,
      toJSON: () => ({}),
    });

    const textNode = shadow.querySelector('.bpp-page text')!.firstChild!;
    const measuredRange = document.createRange();
    Object.defineProperty(measuredRange, 'getClientRects', {
      value: () => [{ left: 110, top: 70, right: 140, bottom: 84, width: 30, height: 14 }],
    });
    const createRange = vi.spyOn(document, 'createRange').mockReturnValue(measuredRange);
    const getSelection = vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: true,
      getComposedRanges: () => [
        {
          collapsed: false,
          startContainer: textNode,
          startOffset: 0,
          endContainer: textNode,
          endOffset: textNode.textContent?.length ?? 0,
        },
      ],
    } as unknown as Selection);

    // Some browsers expose the composed range but do not dispatch a useful
    // document-level selectionchange for a selection wholly inside the shadow.
    shadow.dispatchEvent(new Event('pointerup'));
    await vi.waitFor(() => expect(shadow.querySelectorAll('.bpp-selection-rect')).toHaveLength(1));

    getSelection.mockRestore();
    createRange.mockRestore();
    handle.dispose();
    element.remove();
  });

  it('removes highlights and listeners when a load is superseded or disposed', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host);
    handle.load([page]);

    const oldPage = host.querySelector<HTMLElement>('.bpp-page')!;
    const layer = document.createElement('div');
    layer.className = 'bpp-selection-layer';
    oldPage.append(layer);

    handle.load([page]);
    expect(layer.isConnected).toBe(false);
    expect(host.querySelectorAll('.bpp-selection-layer')).toHaveLength(0);

    handle.dispose();
    document.dispatchEvent(new Event('selectionchange'));
    expect(host.querySelectorAll('.bpp-selection-layer')).toHaveLength(0);
    host.remove();
  });
});
