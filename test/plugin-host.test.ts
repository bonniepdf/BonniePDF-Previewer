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

function sidePanelPlugin(id: string, label: string): PreviewerPlugin {
  return {
    name: `${id}-view`,
    setup(context) {
      context.addSidePanel({
        id,
        label,
        element: context.ownerDocument.createElement('div'),
        defaultOpen: true,
      });
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

  it('configures the selection colour through the factory option', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { selectionColor: '#5f7f3c' });

    expect(host.querySelector<HTMLElement>('.bpp')?.style.getPropertyValue('--bpdf-selection')).toBe('#5f7f3c');

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
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('');
    expect(document.body.style.overflow).toBe('');

    fullscreen.click();
    expect(showPopover).toHaveBeenCalledOnce();
    expect(host.getAttribute('popover')).toBe('manual');
    expect(host.classList.contains('bpp-popover-host')).toBe(true);
    expect(shell?.classList.contains('bpp-fullscreen')).toBe(true);
    expect(fullscreen.getAttribute('aria-pressed')).toBe('true');
    expect(fullscreen.getAttribute('aria-label')).toBe('Exit full screen');
    expect(zoom.value).toBe('fit-page');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('auto');
    expect(document.body.style.overflow).toBe('hidden');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hidePopover).toHaveBeenCalledOnce();
    expect(host.hasAttribute('popover')).toBe(false);
    expect(host.classList.contains('bpp-popover-host')).toBe(false);
    expect(shell?.classList.contains('bpp-fullscreen')).toBe(false);
    expect(fullscreen.getAttribute('aria-label')).toBe('Full screen');
    expect(zoom.value).toBe('fit-width');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('');
    expect(document.body.style.overflow).toBe('');

    // A deliberate zoom choice made in fullscreen survives exit.
    fullscreen.click();
    zoom.value = '1.25';
    zoom.dispatchEvent(new Event('change'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(zoom.value).toBe('custom');

    handle.dispose();
    host.remove();
  });

  it('restores the document scroll styles when disposed while full screen', () => {
    const originalDocumentOverflow = document.documentElement.style.overflow;
    const originalScrollbarGutter = document.documentElement.style.getPropertyValue('scrollbar-gutter');
    const originalBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'clip';
    document.documentElement.style.setProperty('scrollbar-gutter', 'stable both-edges');
    document.body.style.overflow = 'auto';

    const host = document.createElement('div');
    Object.defineProperties(host, {
      showPopover: { configurable: true, value: vi.fn() },
      hidePopover: { configurable: true, value: vi.fn() },
    });
    document.body.append(host);
    const handle = createPreviewer(host);
    handle.load(pages(1));

    try {
      (host.querySelector('[data-fullscreen]') as HTMLButtonElement).click();
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('auto');
      expect(document.body.style.overflow).toBe('hidden');

      handle.dispose();
      expect(document.documentElement.style.overflow).toBe('clip');
      expect(document.documentElement.style.getPropertyValue('scrollbar-gutter')).toBe('stable both-edges');
      expect(document.body.style.overflow).toBe('auto');
    } finally {
      handle.dispose();
      host.remove();
      document.documentElement.style.overflow = originalDocumentOverflow;
      if (originalScrollbarGutter) {
        document.documentElement.style.setProperty('scrollbar-gutter', originalScrollbarGutter);
      } else {
        document.documentElement.style.removeProperty('scrollbar-gutter');
      }
      document.body.style.overflow = originalBodyOverflow;
    }
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

  it('accessibility view renders the complete tree and paints multi-page highlights on select', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
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
    const highlights = host.querySelectorAll('.bpp-cv-sel');
    expect(highlights.length).toBe(2);
    expect(rows[1].getAttribute('aria-selected')).toBe('true');

    handle.dispose();
    host.remove();
  });

  it('geometry lives in the detail pane, not on tree rows', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    // Rows carry identity only — no geometry column.
    expect(host.querySelectorAll('.bpp-tree-size').length).toBe(0);

    // Selecting the multi-page Page node states page span, size, and origin.
    const rows = host.querySelectorAll<HTMLButtonElement>('.bpp-tree-row');
    rows[1].click();
    const geometry = host.querySelector('.bpp-cv-geom')?.textContent ?? '';
    expect(geometry).toContain('Pages 1–2');
    expect(geometry).toContain('180×280 pt');
    expect(geometry).toContain('at 10, 10');
    expect(geometry).toContain('2 fragments');

    handle.dispose();
    host.remove();
  });

  it('reverse linking: clicking the page selects the deepest node in the tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
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
    expect(host.querySelectorAll('.bpp-cv-sel').length).toBeGreaterThan(0);

    handle.dispose();
    host.remove();
  });

  it('programmatically selects nodes and emits source intent on modifier-click', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
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

  it('Accessibility Document and auto-created Page rows clear selection and navigate to the document declaration', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    const snapshot = snapshotFor2Pages();
    snapshot.root.sourceId = 'src:document';
    snapshot.root.children[0].sourceId = 'src:document';
    handle.load(pages(2), { snapshot });

    const selected = vi.fn();
    host.addEventListener('bonniepdf-node-select', selected);
    const rows = host.querySelectorAll<HTMLButtonElement>('.bpp-tree-row');

    rows[2].click();
    expect(host.querySelectorAll('.bpp-cv-sel')).toHaveLength(1);
    expect(host.querySelectorAll('.bpp-tree-row[aria-selected="true"]')).toHaveLength(1);

    rows[0].click();
    expect(host.querySelectorAll('.bpp-cv-sel')).toHaveLength(0);
    expect(host.querySelectorAll('.bpp-tree-row[aria-selected="true"]')).toHaveLength(0);
    expect((selected.mock.calls.at(-1)![0] as CustomEvent).detail).toMatchObject({
      nodeId: 'n0',
      sourceId: 'src:document',
      sourceNavigation: true,
      origin: 'tree',
    });

    rows[2].click();
    rows[1].click();
    expect(host.querySelectorAll('.bpp-cv-sel')).toHaveLength(0);
    expect(host.querySelectorAll('.bpp-tree-row[aria-selected="true"]')).toHaveLength(0);
    expect((selected.mock.calls.at(-1)![0] as CustomEvent).detail).toMatchObject({
      nodeId: 'n1',
      sourceId: 'src:document',
      sourceNavigation: true,
      origin: 'tree',
    });

    rows[2].click();
    const pageEl = host.querySelectorAll('.bpp-page')[0] as HTMLElement;
    pageEl.dispatchEvent(new MouseEvent('click', { clientX: 15, clientY: 100, bubbles: true }));
    expect(host.querySelectorAll('.bpp-tree-row[aria-selected="true"]')).toHaveLength(0);
    expect((selected.mock.calls.at(-1)![0] as CustomEvent).detail).toMatchObject({
      nodeId: 'n1',
      sourceId: 'src:document',
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
      plugins: [sidePanelPlugin('layout', 'Layout'), complianceView({ openByDefault: true })],
    });
    handle.load(pages(2), { snapshot: snapshotFor2Pages() });

    // Exactly one side region. The inspector contributes two tabs of its own
    // (structure and findings), so with the layout plugin that is three.
    expect(host.querySelectorAll('.bpp-side')).toHaveLength(1);
    const tabs = host.querySelectorAll('.bpp-side-tab');
    expect(tabs).toHaveLength(3);
    expect(host.querySelector('.bpp-side-tabs')?.hasAttribute('hidden')).toBe(false);

    const layoutPanel = host.querySelector<HTMLElement>('[data-side-panel="layout"]')!;
    const compliancePanel = host.querySelector<HTMLElement>('[data-side-panel="compliance"]')!;
    expect(Array.from(tabs).map(tab => tab.querySelector('.bpp-side-tab-label')?.textContent)).toEqual([
      'Accessibility',
      'Issues',
      'Layout',
    ]);

    // Layout registered first, so it wins the default-open race; compliance is a quiet tab.
    expect(layoutPanel.hidden).toBe(false);
    expect(compliancePanel.hidden).toBe(true);

    // Switching to the compliance tab hides the layout panel (mutually exclusive).
    const complianceTab = Array.from(tabs).find(t => t.textContent?.includes('Accessibility')) as HTMLButtonElement;
    complianceTab.click();
    expect(compliancePanel.hidden).toBe(false);
    expect(layoutPanel.hidden).toBe(true);

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
      plugins: [sidePanelPlugin('layout', 'Layout'), complianceView()],
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

    // The deprecated structure attribute aliases Accessibility; both together
    // must still register only one inspector.
    expect(element.shadowRoot?.querySelectorAll('[data-side-panel="compliance"]')).toHaveLength(1);
    // One inspector, but two tabs of its own (structure and findings), so the
    // tab strip shows.
    expect(element.shadowRoot?.querySelectorAll('[data-side-panel="compliance-issues"]')).toHaveLength(1);
    expect(element.shadowRoot?.querySelector('.bpp-side-tabs')?.hasAttribute('hidden')).toBe(false);

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

  it('deprecated structureView() aliases the accessibility inspector', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const plugin = structureView();
    expect(plugin.name).toBe('structure-view');
    const handle = createPreviewer(host, { plugins: [plugin] });
    handle.load(pages(1));
    const side = host.querySelector('[data-side-panel="compliance"]');
    expect(side?.textContent).toContain('No structure data');
    handle.dispose();
    host.remove();
  });

  it('renders every built-in toolbar group by default', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, {});
    handle.load(pages(1));
    expect(host.querySelector('[data-toggle-thumbs]')).toBeTruthy();
    expect(host.querySelector('[data-prev]')).toBeTruthy();
    expect(host.querySelector('[data-zoom-select]')).toBeTruthy();
    expect(host.querySelector('[data-fullscreen]')).toBeTruthy();
    expect(host.querySelector('[data-download]')).toBeTruthy();
    handle.dispose();
    host.remove();
  });

  it('omits toolbar groups disabled via the toolbar option (no dangling separators)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { toolbar: { fullscreen: false, download: false } });
    handle.load(pages(1));

    // Disabled groups are gone…
    expect(host.querySelector('[data-fullscreen]')).toBeNull();
    expect(host.querySelector('[data-download]')).toBeNull();
    // …while the rest of the toolbar (and its wiring) is unaffected.
    expect(host.querySelector('[data-toggle-thumbs]')).toBeTruthy();
    expect(host.querySelector('[data-prev]')).toBeTruthy();
    expect(host.querySelector('[data-zoom-select]')).toBeTruthy();
    expect(host.querySelector('[data-toolbar-end]')).toBeTruthy();

    // Three remaining groups (thumbnails / pageNav / zoom) → exactly two
    // separators between them, none left dangling by the removed groups.
    expect(host.querySelectorAll('.bpp-toolbar > .bpp-sep')).toHaveLength(2);
    handle.dispose();
    host.remove();
  });

  it('reads per-group toolbar flags from element attributes', () => {
    const tagName = 'bonnie-pdf-previewer-toolbar-test';
    if (!customElements.get(tagName)) {
      customElements.define(tagName, class extends BonniePdfPreviewerElement {});
    }
    const element = document.createElement(tagName) as BonniePdfPreviewerElement;
    element.setAttribute('show-fullscreen', 'false');
    element.setAttribute('show-download', 'false');
    document.body.append(element);
    element.load(pages(1));

    const root = element.shadowRoot!;
    expect(root.querySelector('[data-fullscreen]')).toBeNull();
    expect(root.querySelector('[data-download]')).toBeNull();
    expect(root.querySelector('[data-zoom-select]')).toBeTruthy();

    element.remove();
  });

  it('reads the selection colour from the custom-element attribute', () => {
    const tagName = 'bonnie-pdf-previewer-selection-colour-test';
    if (!customElements.get(tagName)) {
      customElements.define(tagName, class extends BonniePdfPreviewerElement {});
    }
    const element = document.createElement(tagName) as BonniePdfPreviewerElement;
    element.setAttribute('selection-color', 'var(--app-selection)');
    document.body.append(element);

    expect(element.shadowRoot?.querySelector<HTMLElement>('.bpp')?.style.getPropertyValue('--bpdf-selection')).toBe(
      'var(--app-selection)',
    );

    element.remove();
  });
});
