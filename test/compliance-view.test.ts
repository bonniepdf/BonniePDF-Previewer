import { describe, it, expect } from 'vitest';
import { createPreviewer } from '../src/controller';
import { complianceView } from '../src/compliance-view';
import type { ComplianceReport, LayoutSnapshot, PreviewPage } from '../src/types';

function pageSvg(n: number, w = 200, h = 300): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text>page ${n}</text></svg>`;
}
function pages(count: number): PreviewPage[] {
  return Array.from({ length: count }, (_, i) => ({ svg: pageSvg(i + 1), width: 200, height: 300 }));
}

function snapshot(): LayoutSnapshot {
  return {
    version: 2,
    pages: [{ width: 200, height: 300 }],
    meta: { accessibilityMode: 1, conformance: 'None', language: 'en', title: 'Doc' },
    root: {
      id: 'n0',
      type: 'Document',
      rects: [],
      children: [
        {
          id: 'n1',
          type: 'Page',
          rects: [{ page: 0, x: 10, y: 10, width: 180, height: 280 }],
          children: [
            {
              id: 'n2',
              type: 'Heading',
              a11y: { role: 'H1', tagged: true, artifact: false, headingLevel: 1 },
              rects: [{ page: 0, x: 10, y: 10, width: 180, height: 20 }],
              children: [],
            },
            {
              id: 'n3',
              type: 'QRCode',
              a11y: { role: 'Artifact', tagged: false, artifact: true, imageLike: true },
              rects: [{ page: 0, x: 10, y: 40, width: 60, height: 60 }],
              children: [],
            },
          ],
        },
      ],
    },
  };
}

function report(): ComplianceReport {
  return {
    findings: [
      {
        code: 'figure-missing-alt',
        severity: 'error',
        standard: 'PDF/UA-1',
        clause: 'ISO 14289-1:2014 §7.3',
        message: 'QRCode has no alternate text.',
        fixHint: 'Set altText.',
        nodeId: 'n3',
        role: 'Artifact',
        page: 0,
      },
    ],
    passed: false,
    errorCount: 1,
    warningCount: 0,
    infoCount: 0,
  };
}

/** The same report plus a WCAG 2.2 contrast warning on the Heading. */
function reportWithContrast(): ComplianceReport {
  const base = report();
  return {
    ...base,
    findings: [
      ...base.findings,
      {
        code: 'contrast-insufficient',
        severity: 'warning',
        standard: 'WCAG 2.2',
        clause: 'WCAG 2.2 SC 1.4.3 (AA)',
        message: 'Heading text contrast is 2.60:1 against its background.',
        fixHint: 'Darken the text colour.',
        nodeId: 'n2',
        role: 'H1',
        page: 0,
      },
    ],
    warningCount: 1,
  };
}

/** The error report plus a WCAG warning and a document-level info finding. */
function reportWithDocFinding(): ComplianceReport {
  const base = reportWithContrast();
  return {
    ...base,
    findings: [
      ...base.findings,
      {
        code: 'doc-no-headings',
        severity: 'info',
        standard: 'PDF/UA-1',
        clause: 'ISO 14289-1:2014 §7.4',
        message: 'The document contains no headings.',
        fixHint: 'Use heading() elements.',
      },
    ],
    infoCount: 1,
  };
}

/** Five levels of nesting, to prove the default expansion reaches the bottom. */
function deepSnapshot(): LayoutSnapshot {
  const rect = (y: number) => [{ page: 0, x: 10, y, width: 180, height: 20 }];
  return {
    version: 2,
    pages: [{ width: 200, height: 300 }],
    meta: { accessibilityMode: 1, conformance: 'None', language: 'en', title: 'Doc' },
    root: {
      id: 'n0',
      type: 'Document',
      rects: [],
      children: [
        {
          id: 'n1',
          type: 'Page',
          rects: rect(10),
          children: [
            {
              id: 'n2',
              type: 'Container',
              rects: rect(20),
              children: [
                {
                  id: 'n3',
                  type: 'VerticalStack',
                  rects: rect(30),
                  children: [{ id: 'n4', type: 'TextBlock', rects: rect(40), children: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** The findings count shown on the Issues tab (the tab the count is about). */
function issuesBadge(host: HTMLElement): string | null | undefined {
  const tab = Array.from(host.querySelectorAll('.bpp-side-tab')).find(
    t => t.querySelector('.bpp-side-tab-label')?.textContent === 'Issues'
  );
  return tab?.querySelector('.bpp-side-tab-badge')?.textContent;
}

describe('compliance view plugin', () => {
  it('renders role chips and a severity dot, and a summary verdict', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    // Role chips for H1 and Artifact.
    const roles = Array.from(host.querySelectorAll('.bpp-cv-role')).map(r => r.textContent);
    expect(roles).toContain('H1');
    expect(roles).toContain('Artifact');

    // The QRCode row carries an error dot.
    const errorDot = host.querySelector('.bpp-cv-dot-error');
    expect(errorDot).toBeTruthy();

    // Summary verdict reflects failure.
    expect(host.querySelector('.bpp-cv-verdict-fail')?.textContent).toContain('PDF/UA-1');
    // The panel's host tab badge shows the count (error+warning).
    expect(issuesBadge(host)).toBe('1');

    handle.dispose();
    host.remove();
  });

  it('paints severity-tinted markers on the page for flagged nodes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    // One error marker for n3.
    expect(host.querySelectorAll('.bpp-cv-mark-error').length).toBe(1);

    handle.dispose();
    host.remove();
  });

  it('selecting a flagged row shows the finding detail with the fix hint', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    const rows = Array.from(host.querySelectorAll('.bpp-cv-row')) as HTMLButtonElement[];
    const qrRow = rows.find(r => r.querySelector('.bpp-tree-type')?.textContent === 'QRCode')!;
    qrRow.click();

    const detail = host.querySelector('.bpp-cv-detail-body')!;
    expect(detail.querySelector('.bpp-cv-finding-error')).toBeTruthy();
    expect(detail.querySelector('.bpp-cv-fix')?.textContent).toContain('Set altText');
    // Selection highlight is painted with error tint.
    expect(host.querySelector('.bpp-cv-sel-error')).toBeTruthy();

    handle.dispose();
    host.remove();
  });

  it('"show only issues" filter prunes clean branches', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    const cb = host.querySelector('.bpp-cv-filter input') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));

    const types = Array.from(host.querySelectorAll('.bpp-cv-row .bpp-tree-type')).map(t => t.textContent);
    // The clean H1 heading is pruned; the flagged QRCode (and its ancestors) remain.
    expect(types).toContain('QRCode');
    expect(types).not.toContain('Heading');

    handle.dispose();
    host.remove();
  });

  it('works with a snapshot but no report (badges only, no crash)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot() });

    expect(host.querySelectorAll('.bpp-cv-role').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.bpp-cv-mark-error').length).toBe(0);
    expect(host.querySelector('.bpp-cv-summary')?.textContent).toContain('structure roles only');

    handle.dispose();
    host.remove();
  });

  it('renders as a tree: branches expand and collapse, leaves do not', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    const rowFor = (type: string): HTMLButtonElement =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.bpp-cv-row')).find(
        r => r.querySelector('.bpp-tree-type')?.textContent === type
      )!;

    const pageRow = rowFor('Page');
    const group = pageRow.parentElement!.querySelector('ul')! as HTMLElement;
    expect(pageRow.getAttribute('aria-expanded')).toBe('true');
    expect(group.hidden).toBe(false);

    // Clicking the twisty collapses the branch without selecting the row.
    pageRow.querySelector<HTMLElement>('.bpp-tree-twisty')!.click();
    expect(pageRow.getAttribute('aria-expanded')).toBe('false');
    expect(group.hidden).toBe(true);
    expect(pageRow.getAttribute('aria-selected')).toBe('false');

    // ArrowRight re-expands it.
    pageRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(pageRow.getAttribute('aria-expanded')).toBe('true');

    // Leaves carry no expansion state.
    expect(rowFor('QRCode').hasAttribute('aria-expanded')).toBe(false);

    handle.dispose();
    host.remove();
  });

  it('the tree has a single tab stop that follows the focused row', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>('.bpp-cv-row'));
    expect(rows.filter(r => r.tabIndex === 0)).toHaveLength(1);

    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);

    handle.dispose();
    host.remove();
  });

  it('"Collapse all" and "Expand all" drive the whole tree', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    const action = (text: string): HTMLButtonElement =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.bpp-cv-action')).find(b => b.textContent === text)!;

    action('Collapse all').click();
    // Only the Document row survives collapse; it stays open onto the pages.
    const visibleTypes = (): (string | null | undefined)[] =>
      Array.from(host.querySelectorAll<HTMLElement>('.bpp-cv-row'))
        .filter(r => !r.closest('ul[hidden]'))
        .map(r => r.querySelector('.bpp-tree-type')?.textContent);
    expect(visibleTypes()).toEqual(['Document', 'Page']);

    action('Expand all').click();
    expect(visibleTypes()).toEqual(['Document', 'Page', 'Heading', 'QRCode']);

    handle.dispose();
    host.remove();
  });

  it('hiding WCAG checks removes those findings from the tree, counts, badge and overlay', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: reportWithContrast() });

    // With contrast included: the Heading carries the warning.
    expect(host.querySelectorAll('.bpp-cv-dot-warning').length).toBe(1);
    expect(issuesBadge(host)).toBe('2');
    expect(host.querySelectorAll('.bpp-cv-mark-warning').length).toBe(1);

    const wcagToggle = host.querySelectorAll<HTMLInputElement>('.bpp-cv-filter input')[1];
    wcagToggle.checked = false;
    wcagToggle.dispatchEvent(new Event('change'));

    expect(host.querySelectorAll('.bpp-cv-dot-warning').length).toBe(0);
    expect(host.querySelectorAll('.bpp-cv-mark-warning').length).toBe(0);
    // The badge drops to the PDF/UA-1 error alone; the verdict is unchanged,
    // because no WCAG finding is ever an error.
    expect(issuesBadge(host)).toBe('1');
    expect(host.querySelector('.bpp-cv-verdict-fail')).toBeTruthy();
    const pills = Array.from(host.querySelectorAll('.bpp-cv-pill')).map(p => p.textContent);
    expect(pills).toContain('0 warnings');

    handle.dispose();
    host.remove();
  });

  it('starts with WCAG checks hidden when the option says so', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, {
      plugins: [complianceView({ openByDefault: true, showWcagChecks: false })],
    });
    handle.load(pages(1), { snapshot: snapshot(), report: reportWithContrast() });

    expect(host.querySelectorAll('.bpp-cv-dot-warning').length).toBe(0);
    expect(host.querySelectorAll<HTMLInputElement>('.bpp-cv-filter input')[1].checked).toBe(false);

    handle.dispose();
    host.remove();
  });

  it('expands the whole tree by default, to any depth', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    // No report: an error would expand its own ancestors whatever the depth.
    handle.load(pages(1), { snapshot: deepSnapshot() });

    const visibleTypes = Array.from(host.querySelectorAll<HTMLElement>('.bpp-cv-row'))
      .filter(r => !r.closest('ul[hidden]'))
      .map(r => r.querySelector('.bpp-tree-type')?.textContent);
    // Five levels deep, all open, including the innermost leaf.
    expect(visibleTypes).toEqual(['Document', 'Page', 'Container', 'VerticalStack', 'TextBlock']);

    handle.dispose();
    host.remove();
  });

  it('honours an explicit expand depth when the host asks for one', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, {
      plugins: [complianceView({ openByDefault: true, defaultExpandDepth: 2 })],
    });
    // No report: an error would expand its own ancestors whatever the depth.
    handle.load(pages(1), { snapshot: deepSnapshot() });

    const visibleTypes = Array.from(host.querySelectorAll<HTMLElement>('.bpp-cv-row'))
      .filter(r => !r.closest('ul[hidden]'))
      .map(r => r.querySelector('.bpp-tree-type')?.textContent);
    expect(visibleTypes).toEqual(['Document', 'Page', 'Container']);

    handle.dispose();
    host.remove();
  });

  it('lists every finding on its own tab, grouped by severity', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: reportWithDocFinding() });

    const issues = host.querySelector<HTMLElement>('[data-side-panel="compliance-issues"]')!;
    const titles = Array.from(issues.querySelectorAll('.bpp-cv-section-title')).map(t => t.textContent);
    expect(titles).toEqual(['Error (1)', 'Warning (1)', 'Info (1)']);
    expect(issues.querySelectorAll('.bpp-cv-finding')).toHaveLength(3);

    // Element-scoped findings name their element and offer a jump; the
    // document-level one is marked as such and has nothing to jump to.
    expect(Array.from(issues.querySelectorAll('.bpp-cv-finding-el')).map(e => e.textContent)).toEqual([
      'QRCode',
      'Heading',
    ]);
    expect(issues.querySelectorAll('.bpp-cv-jump')).toHaveLength(2);
    expect(issues.querySelector('.bpp-cv-scope')?.textContent).toBe('Document');

    // Nothing unbounded is left on the tree tab to push the tree down.
    const tree = host.querySelector<HTMLElement>('[data-side-panel="compliance"]')!;
    expect(tree.querySelectorAll('.bpp-cv-finding')).toHaveLength(0);

    handle.dispose();
    host.remove();
  });

  it('"Go to element" switches to the tree tab and selects the element', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: report() });

    const issuesTab = Array.from(host.querySelectorAll<HTMLButtonElement>('.bpp-side-tab')).find(
      t => t.querySelector('.bpp-side-tab-label')?.textContent === 'Issues'
    )!;
    issuesTab.click();
    const treePanel = host.querySelector<HTMLElement>('[data-side-panel="compliance"]')!;
    expect(treePanel.hidden).toBe(true);
    // Overlays survive the tab switch: both tabs are views of one report.
    expect(host.querySelectorAll('.bpp-cv-mark-error').length).toBe(1);

    const jump = host.querySelector<HTMLButtonElement>('[data-side-panel="compliance-issues"] .bpp-cv-jump')!;
    jump.click();

    expect(treePanel.hidden).toBe(false);
    const selected = host.querySelector('.bpp-tree-row[aria-selected="true"]');
    expect(selected?.querySelector('.bpp-tree-type')?.textContent).toBe('QRCode');

    handle.dispose();
    host.remove();
  });

  it('the WCAG switch on the findings tab filters that tab too', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView({ openByDefault: true })] });
    handle.load(pages(1), { snapshot: snapshot(), report: reportWithContrast() });

    const issues = host.querySelector<HTMLElement>('[data-side-panel="compliance-issues"]')!;
    expect(issues.querySelectorAll('.bpp-cv-finding')).toHaveLength(2);

    const wcag = issues.querySelector<HTMLInputElement>('.bpp-cv-filter input')!;
    wcag.checked = false;
    wcag.dispatchEvent(new Event('change'));

    expect(issues.querySelectorAll('.bpp-cv-finding')).toHaveLength(1);
    // And the switch on the other tab agrees — one setting, two views.
    const treeWcag = host.querySelectorAll<HTMLInputElement>('[data-side-panel="compliance"] .bpp-cv-filter input')[1];
    expect(treeWcag.checked).toBe(false);

    handle.dispose();
    host.remove();
  });

  it('shows an empty state when no snapshot is provided', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = createPreviewer(host, { plugins: [complianceView()] });
    handle.load(pages(1));
    const side = host.querySelector('[data-side-panel="compliance"]');
    expect(side?.textContent).toContain('No structure data');
    handle.dispose();
    host.remove();
  });
});
