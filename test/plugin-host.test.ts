import { describe, it, expect, vi } from 'vitest';
import { createPreviewer } from '../src/controller';
import { structureView } from '../src/structure-view';
import { complianceView } from '../src/compliance-view';
import { BonniePdfPreviewerElement } from '../src/define';
import type { LayoutSnapshot, PreviewPage, PreviewerPlugin } from '../src/types';

function pageSvg(n: number, w = 200, h = 300): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text>page ${n}</text></svg>`;
}

function pages(count: number): PreviewPage[] {
  return Array.from({ length: count }, (_, i) => ({ svg: pageSvg(i + 1), width: 200, height: 300 }));
}

function snapshotFor2Pages(): LayoutSnapshot {
  return {
    version: 1,
    pages: [
      { width: 200, height: 300 },
      { width: 200, height: 300 },
    ],
    root: {
      id: 'n0',
      type: 'Document',
      rects: [],
      children: [
        {
          id: 'n1',
          type: 'Page',
          // Spans both pages — selecting it must paint two highlights.
          rects: [
            { page: 0, x: 10, y: 10, width: 180, height: 280 },
            { page: 1, x: 10, y: 10, width: 180, height: 100 },
          ],
          children: [
            { id: 'n2', type: 'TextBlock', name: 'title', sourceId: 'src:title', rects: [{ page: 0, x: 10, y: 10, width: 180, height: 20 }], children: [] },
          ],
        },
      ],
    },
  };
}

describe('previewer plugin host', () => {
  it('backward compat: with no plugins the chrome and pages still render', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, {});
    handle.load(pages(2));

    expect(host.querySelector('.bpp-toolbar')).toBeTruthy();
    expect(host.querySelectorAll('.bpp-page')).toHaveLength(2);
    // No plugin DOM is added.
    expect(host.querySelector('.bpp-side')).toBeNull();
    expect(host.querySelector('.bpp-overlay')).toBeNull();
    handle.dispose();
    host.remove();
  });

  it('toggles the previewer full-screen viewport mode', () => {
    const host = document.createElement('div');
    const showPopover = vi.fn();
    const hidePopover = vi.fn();
    Object.defineProperties(host, {
      showPopover: { configurable: true, value: showPopover },
      hidePopover: { configurable: true, value: hidePopover },
    });
    document.body.append(host);
    const handle = createPreviewer(host, { fitMode: 'fit-width' });
    handle.load(pages(1));

    const shell = host.querySelector('.bpp');
    const fullscreen = host.querySelector('[data-fullscreen]') as HTMLButtonElement;
    const zoom = host.querySelector('[data-zoom-select]') as HTMLSelectElement;
    const fullscreenLabel = host.querySelector('.bpp-fullscreen-label') as HTMLElement;

    expect(fullscreen).toBeTruthy();
    expect(shell?.classList.contains('bpp-fullscreen')).toBe(false);
    expect(fullscreen.getAttribute('aria-label')).toBe('Full screen');
    expect(zoom.value).toBe('fit-width');
    expect(fullscreenLabel.textContent).toBe('Exit Fullscreen');

    fullscreen.click();
    expect(showPopover).toHaveBeenCalledOnce();
    expect(host.getAttribute('popover')).toBe('manual');
    expect(host.classList.contains('bpp-popover-host')).toBe(true);
    expect(shell?.classList.contains('bpp-fullscreen')).toBe(true);
    expect(fullscreen.getAttribute('aria-pressed')).toBe('true');
    expect(fullscreen.getAttribute('aria-label')).toBe('Exit full screen');
    expect(zoom.value).toBe('fit-page');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hidePopover).toHaveBeenCalledOnce();
    expect(host.hasAttribute('popover')).toBe(false);
    expect(host.classList.contains('bpp-popover-host')).toBe(false);
    expect(shell?.classList.contains('bpp-fullscreen')).toBe(false);
    expect(fullscreen.getAttribute('aria-label')).toBe('Full screen');
    expect(zoom.value).toBe('fit-width');

    // A deliberate zoom choice made in fullscreen survives exit.
    fullscreen.click();
    zoom.value = '1.25';
    zoom.dispatchEvent(new Event('change'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(zoom.value).toBe('custom');

    handle.dispose();
    host.remove();
  });

  it('runs plugin lifecycle hooks in order', () => {
    const calls: string[] = [];
    const probe: PreviewerPlugin = {
      name: 'probe',
      setup: () => {
        calls.push('setup');
        return () => calls.push('cleanup');
      },
      load: () => calls.push('load'),
      sync: () => calls.push('sync'),
      teardown: () => calls.push('teardown'),
    };
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [probe] });
    handle.load(pages(1));
    handle.dispose();
    host.remove();

    expect(calls[0]).toBe('setup');
    expect(calls.indexOf('load')).toBeGreaterThan(calls.indexOf('setup'));
    expect(calls).toContain('sync');
    expect(calls).toContain('teardown');
    expect(calls[calls.length - 1]).toBe('cleanup');
  });

  it('structure view renders the tree and paints multi-page highlights on select', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [structureView({ openByDefault: true })] });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    // Tree rows for Document, Page, TextBlock.
    const rows = host.querySelectorAll('.bpp-tree-row');
    expect(rows.length).toBe(3);
    const types = Array.from(rows).map(r => r.querySelector('.bpp-tree-type')?.textContent);
    expect(types).toEqual(['Document', 'Page', 'TextBlock']);
    // The named node shows its name.
    expect(host.querySelector('.bpp-tree-name')?.textContent).toBe('title');

    // Select the Page node (index 1): it has rects on both pages.
    (rows[1] as HTMLButtonElement).click();
    const highlights = host.querySelectorAll('.bpp-hl');
    expect(highlights.length).toBe(2);
    expect(rows[1].getAttribute('aria-selected')).toBe('true');

    handle.dispose();
    host.remove();
  });

  it('structure view shows each node size, with a page-span suffix for multi-page nodes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [structureView()] });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    const sizes = Array.from(host.querySelectorAll('.bpp-tree-size')).map(s => s.textContent);
    // TextBlock: single rect 180×20. Page: 180×280 first rect, spans 2 pages.
    expect(sizes).toContain('180×20');
    expect(sizes).toContain('180×280 · 2p');
    // Document has no rect → no size cell.
    const docRow = host.querySelector('.bpp-tree-row');
    expect(docRow?.querySelector('.bpp-tree-size')).toBeNull();

    handle.dispose();
    host.remove();
  });

  it('reverse linking: clicking the page selects the deepest node in the tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [structureView({ openByDefault: true })] });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    const pageEl = host.querySelectorAll('.bpp-page')[0] as HTMLElement;
    // jsdom has no layout, so getBoundingClientRect is all-zero and scale is 1;
    // a click at (15,15) lands inside the TextBlock rect {x:10,y:10,w:180,h:20}.
    pageEl.dispatchEvent(new MouseEvent('click', { clientX: 15, clientY: 15, bubbles: true }));

    // The TextBlock ('title') row — the deepest node under the point — is selected.
    const selected = host.querySelector('.bpp-tree-row[aria-selected="true"]');
    expect(selected?.querySelector('.bpp-tree-type')?.textContent).toBe('TextBlock');
    expect(selected?.querySelector('.bpp-tree-name')?.textContent).toBe('title');
    // And its highlight is painted.
    expect(host.querySelectorAll('.bpp-hl').length).toBeGreaterThan(0);

    handle.dispose();
    host.remove();
  });

  it('programmatically selects nodes and emits source intent on modifier-click', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [structureView({ openByDefault: true })] });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    expect(handle.selectSnapshotNode('n2')).toBe(true);
    expect(host.querySelector('.bpp-tree-row[aria-selected="true"] .bpp-tree-type')?.textContent).toBe(
      'TextBlock',
    );

    const selected = vi.fn();
    host.addEventListener('bonniepdf-node-select', selected);
    const pageEl = host.querySelectorAll('.bpp-page')[0] as HTMLElement;
    pageEl.dispatchEvent(
      new MouseEvent('click', { clientX: 15, clientY: 15, bubbles: true, ctrlKey: true }),
    );
    expect(selected).toHaveBeenCalledOnce();
    expect((selected.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      nodeId: 'n2',
      sourceId: 'src:title',
      sourceNavigation: true,
      origin: 'page',
    });

    handle.dispose();
    host.remove();
  });

  it('two inspector plugins share one tabbed panel — only one visible at a time', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, {
      plugins: [structureView({ openByDefault: true }), complianceView({ openByDefault: true })],
    });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    // Exactly one side region, with a two-tab strip.
    expect(host.querySelectorAll('.bpp-side')).toHaveLength(1);
    const tabs = host.querySelectorAll('.bpp-side-tab');
    expect(tabs).toHaveLength(2);
    expect(host.querySelector('.bpp-side-tabs')?.hasAttribute('hidden')).toBe(false);

    const structurePanel = host.querySelector<HTMLElement>('[data-side-panel="structure"]')!;
    const compliancePanel = host.querySelector<HTMLElement>('[data-side-panel="compliance"]')!;
    expect(Array.from(tabs).map(tab => tab.querySelector('.bpp-side-tab-label')?.textContent)).toEqual([
      'Accessibility',
      'Structure',
    ]);

    // Structure registered first, so it wins the default-open race; compliance is a quiet tab.
    expect(structurePanel.hidden).toBe(false);
    expect(compliancePanel.hidden).toBe(true);

    // Switching to the compliance tab hides the structure panel (mutually exclusive).
    const complianceTab = Array.from(tabs).find(t => t.textContent?.includes('Accessibility')) as HTMLButtonElement;
    complianceTab.click();
    expect(compliancePanel.hidden).toBe(false);
    expect(structurePanel.hidden).toBe(true);

    // The single toolbar toggle collapses the whole region.
    const toggle = host.querySelector<HTMLButtonElement>('.bpp-side-toggle')!;
    expect(toggle).toBeTruthy();
    toggle.click();
    expect(host.querySelector<HTMLElement>('.bpp-side')!.hidden).toBe(true);

    handle.dispose();
    host.remove();
  });

  it('honours initial panel visibility and reports user visibility changes', () => {
    const states: Array<{
      showThumbnails: boolean;
      showInspector: boolean;
      zoom: { mode: 'fit-page' | 'fit-width' | 'custom'; scale?: number };
    }> = [];
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, {
      plugins: [structureView(), complianceView()],
      showThumbnails: false,
      showInspector: false,
      onViewStateChange: state => states.push(state),
    });
    handle.load(pages(1), { snapshot: snapshotFor2Pages() });

    expect(host.querySelector<HTMLElement>('[data-thumbs]')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.bpp-side')!.hidden).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-toggle-thumbs]')!.click();
    host.querySelector<HTMLButtonElement>('.bpp-side-toggle')!.click();
    expect(states.at(-1)).toEqual({
      showThumbnails: true,
      showInspector: true,
      zoom: { mode: 'fit-page' },
    });

    handle.dispose();
    host.remove();
  });

  it('applies persisted visibility before building the custom-element shell', () => {
    const tagName = 'bonnie-pdf-previewer-persistence-test';
    if (!customElements.get(tagName)) {
      customElements.define(tagName, class extends BonniePdfPreviewerElement {});
    }
    const key = 'bonniepdf-previewer-test-layout';
    localStorage.setItem(
      key,
      JSON.stringify({
        showThumbnails: false,
        showInspector: false,
        zoom: { mode: 'custom', scale: 1.25 },
      }),
    );

    const element = document.createElement(tagName) as BonniePdfPreviewerElement;
    element.setAttribute('show-thumbnails', 'true');
    element.setAttribute('show-inspector', 'true');
    element.setAttribute('structure-view', '');
    element.setAttribute('compliance-view', '');
    element.setAttribute('preference-key', key);
    document.body.append(element);
    element.load(pages(1), { snapshot: snapshotFor2Pages() });

    expect(element.shadowRoot?.querySelector<HTMLElement>('[data-thumbs]')?.hidden).toBe(true);
    expect(element.shadowRoot?.querySelector<HTMLElement>('.bpp-side')?.hidden).toBe(true);
    expect(element.shadowRoot?.querySelector<HTMLSelectElement>('[data-zoom-select]')?.value).toBe('custom');

    element.shadowRoot?.querySelector<HTMLButtonElement>('[data-toggle-thumbs]')?.click();
    element.shadowRoot?.querySelector<HTMLButtonElement>('.bpp-side-toggle')?.click();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      showThumbnails: true,
      showInspector: true,
      zoom: { mode: 'custom', scale: 1.25 },
    });

    const zoom = element.shadowRoot?.querySelector<HTMLSelectElement>('[data-zoom-select]');
    if (zoom) {
      zoom.value = 'fit-width';
      zoom.dispatchEvent(new Event('change'));
    }
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      showThumbnails: true,
      showInspector: true,
      zoom: { mode: 'fit-width' },
    });

    element.remove();
    localStorage.removeItem(key);
  });

  it('structure view shows an empty state when no snapshot is provided', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [structureView()] });
    handle.load(pages(1));
    const side = host.querySelector('[data-side-panel="structure"]');
    expect(side?.textContent).toContain('No structure data');
    handle.dispose();
    host.remove();
  });
});
