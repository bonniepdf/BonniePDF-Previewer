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
    expect(host.querySelector('.bpp-side-tab-badge')?.textContent).toBe('1');

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
