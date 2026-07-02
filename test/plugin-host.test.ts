import { describe, it, expect } from 'vitest';
import { createPreviewer } from '../src/controller';
import { structureView } from '../src/structure-view';
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
            { id: 'n2', type: 'TextBlock', name: 'title', rects: [{ page: 0, x: 10, y: 10, width: 180, height: 20 }], children: [] },
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
