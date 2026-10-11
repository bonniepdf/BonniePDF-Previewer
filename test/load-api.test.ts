import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPreviewer } from '../src/controller';
import { complianceView } from '../src/compliance-view';
import { BonniePdfPreviewerElement } from '../src/define';
import type { PreviewableDocument, PreviewExport } from '../src/types';

function pageSvg(n: number, w = 200, h = 300): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text>page ${n}</text></svg>`;
}

function exportOf(count: number, extra: Partial<PreviewExport> = {}): PreviewExport {
  return { version: 1, pages: Array.from({ length: count }, (_, i) => pageSvg(i + 1, 200 + i, 300)), ...extra };
}

/** A stand-in for a @bonniepdf/core Document: the previewer checks shape, not class. */
function fakeDocument(title?: string, exported: PreviewExport = exportOf(2)) {
  const doc = {
    metadata: title === undefined ? {} : { title },
    generateSvgDocumentAsync: vi.fn(async (_options?: { captureLayout?: boolean }) => exported),
    generateBytesAsync: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  };
  return doc satisfies PreviewableDocument;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

const q = <T extends Element>(host: Element, sel: string) => host.querySelector<T>(sel);

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clicked: Array<{ href: string; download: string }>;

beforeEach(() => {
  let n = 0;
  createObjectURL = vi.fn(() => `blob:test/${++n}`);
  revokeObjectURL = vi.fn();
  // jsdom implements neither.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.querySelectorAll('[data-bpp-fonts]').forEach(el => el.remove());
});

async function clickDownload(host: Element): Promise<void> {
  q<HTMLButtonElement>(host, '[data-download]')!.click();
  // The handler awaits the PDF source; let it finish.
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('load(export)', () => {
  it('renders the pages, sized from each root <svg>, and injects the font CSS once', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(exportOf(2, { fontFaceCss: '@font-face{font-family:x}' }));

    const pageEls = host.querySelectorAll<HTMLElement>('.bpp-page');
    expect(pageEls).toHaveLength(2);
    expect(pageEls[1].style.width).toBe('201px');
    expect(pageEls[1].style.height).toBe('300px');
    expect(document.head.querySelectorAll('[data-bpp-fonts]')).toHaveLength(1);
    expect(q<HTMLElement>(host, '[data-loading]')!.hidden).toBe(true);
  });

  it('accepts the parsed JSON a .NET server returns, severities as plain strings', async () => {
    const json = JSON.stringify({
      version: 1,
      pages: [pageSvg(1)],
      fontFaceCss: '',
      snapshot: {
        version: 4,
        pages: [{ width: 200, height: 300 }],
        root: { id: 'n0', type: 'Document', rects: [], children: [] },
        meta: { accessibilityMode: 0, conformance: 'None' },
      },
      report: {
        findings: [{ code: 'doc-not-tagged', severity: 'info', standard: 'PDF/UA-1', clause: '§7.1', message: 'Untagged.' }],
        passed: true,
        errorCount: 0,
        warningCount: 0,
        infoCount: 1,
      },
    });
    const host = mount();
    const handle = createPreviewer(host, { plugins: [complianceView()] });
    // No cast: parsed JSON satisfies the previewer's own types.
    const parsed: PreviewExport = JSON.parse(json);
    await handle.load(parsed);

    expect(host.querySelectorAll('.bpp-page')).toHaveLength(1);
  });

  it('hides the download button when no PDF is supplied, rather than disabling it', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(exportOf(1));

    const group = q<HTMLButtonElement>(host, '[data-download]')!.closest<HTMLElement>('.bpp-group')!;
    expect(group.hidden).toBe(true);
    expect((group.previousElementSibling as HTMLElement).hidden).toBe(true);
  });

  it('downloads supplied bytes through an object URL it owns and revokes on the next load and on dispose', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(exportOf(1), { pdf: new Uint8Array([1, 2, 3]), downloadFilename: 'report.pdf' });

    expect(q<HTMLElement>(host, '[data-download]')!.closest<HTMLElement>('.bpp-group')!.hidden).toBe(false);
    await clickDownload(host);
    expect(clicked).toEqual([{ href: 'blob:test/1', download: 'report.pdf' }]);

    await handle.load(exportOf(1), { pdf: new Blob(['x']) });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');

    await clickDownload(host);
    handle.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/2');
  });

  it('never revokes a URL the host supplied', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(exportOf(1), { pdf: 'https://example.com/report.pdf' });
    await clickDownload(host);
    handle.dispose();

    expect(clicked[0].href).toBe('https://example.com/report.pdf');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('names the download from the snapshot title when there is no document', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    const exported = exportOf(1, {
      snapshot: {
        version: 4,
        pages: [{ width: 200, height: 300 }],
        root: { id: 'n0', type: 'Document', rects: [], children: [] },
        meta: { accessibilityMode: 0, conformance: 'None', title: 'Annual Statement' },
      },
    });
    await handle.load(exported, { pdf: 'blob:host' });
    await clickDownload(host);

    expect(clicked[0].download).toBe('annual-statement.pdf');
  });
});

describe('load(doc)', () => {
  it('renders the document itself, skipping layout capture when no inspector needs it', async () => {
    const doc = fakeDocument('Quarterly Report');
    const handle = createPreviewer(mount());
    await handle.load(doc);

    expect(doc.generateSvgDocumentAsync).toHaveBeenCalledWith({ captureLayout: false });
  });

  it('captures layout when an inspector plugin is registered', async () => {
    const doc = fakeDocument();
    const handle = createPreviewer(mount(), { plugins: [complianceView()] });
    await handle.load(doc);

    expect(doc.generateSvgDocumentAsync).toHaveBeenCalledWith({ captureLayout: true });
  });

  it('generates the PDF only when the user downloads, named from the title', async () => {
    const doc = fakeDocument('Quarterly Report: Q3 — Überblick');
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(doc);

    expect(doc.generateBytesAsync).not.toHaveBeenCalled();
    await clickDownload(host);
    await clickDownload(host);

    expect(doc.generateBytesAsync).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(2);
    expect(clicked[0].download).toBe('quarterly-report-q3-uberblick.pdf');
  });

  it("prefers the host's filename over the title, and a per-load filename over both", async () => {
    const host = mount();
    const handle = createPreviewer(host, { downloadFilename: 'host.pdf' });
    await handle.load(fakeDocument('Quarterly Report'));
    await clickDownload(host);
    await handle.load(fakeDocument('Quarterly Report'), { downloadFilename: 'this-one.pdf' });
    await clickDownload(host);

    expect(clicked.map(c => c.download)).toEqual(['host.pdf', 'this-one.pdf']);
  });

  it('falls back to document.pdf when the title is missing', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(fakeDocument());
    await clickDownload(host);

    expect(clicked[0].download).toBe('document.pdf');
  });

  it('accepts a promise of a document', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(Promise.resolve(fakeDocument('Later')));

    expect(host.querySelectorAll('.bpp-page')).toHaveLength(2);
  });
});

describe('loading, superseding and errors', () => {
  it('shows the loading overlay until the first document arrives', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    const pending = deferred<PreviewExport>();
    const done = handle.load(pending.promise);

    expect(q<HTMLElement>(host, '[data-loading]')!.hidden).toBe(false);
    pending.resolve(exportOf(1));
    await done;
    expect(q<HTMLElement>(host, '[data-loading]')!.hidden).toBe(true);
  });

  it('keeps a shown document visible, marked busy, while the next one renders', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(exportOf(1));
    const pending = deferred<PreviewExport>();
    const done = handle.load(pending.promise);

    const shell = q<HTMLElement>(host, '.bpp')!;
    expect(q<HTMLElement>(host, '[data-loading]')!.hidden).toBe(true);
    expect(shell.classList.contains('bpp-busy')).toBe(true);
    expect(shell.getAttribute('aria-busy')).toBe('true');
    pending.resolve(exportOf(3));
    await done;
    expect(shell.classList.contains('bpp-busy')).toBe(false);
    expect(host.querySelectorAll('.bpp-page')).toHaveLength(3);
  });

  it('lets a newer load supersede a slower older one, which then resolves quietly', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    const slow = deferred<PreviewExport>();
    const first = handle.load(slow.promise);
    await handle.load(exportOf(4));

    slow.resolve(exportOf(1));
    await expect(first).resolves.toBeUndefined();
    expect(host.querySelectorAll('.bpp-page')).toHaveLength(4);
  });

  it('shows an error state, fires bpp-load-error and rejects when rendering fails', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    const events: unknown[] = [];
    host.addEventListener('bpp-load-error', e => events.push((e as CustomEvent<{ error: unknown }>).detail.error));
    const doc = fakeDocument();
    doc.generateSvgDocumentAsync.mockRejectedValueOnce(new Error('Font not found'));

    await expect(handle.load(doc)).rejects.toThrow('Font not found');
    const error = q<HTMLElement>(host, '[data-error]')!;
    expect(error.hidden).toBe(false);
    expect(error.classList.contains('bpp-error-banner')).toBe(false);
    expect(q<HTMLElement>(host, '[data-error-detail]')!.textContent).toBe('Font not found');
    expect(q<HTMLElement>(host, '[data-loading]')!.hidden).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('keeps the last good document and shows a banner when a later load fails', async () => {
    const host = mount();
    const handle = createPreviewer(host);
    await handle.load(exportOf(2));

    await expect(handle.load(Promise.reject(new Error('Syntax error')))).rejects.toThrow('Syntax error');
    expect(host.querySelectorAll('.bpp-page')).toHaveLength(2);
    expect(q<HTMLElement>(host, '[data-error]')!.classList.contains('bpp-error-banner')).toBe(true);

    await handle.load(exportOf(1));
    expect(q<HTMLElement>(host, '[data-error]')!.hidden).toBe(true);
  });

  it('rejects input that is neither a document nor an export', async () => {
    const handle = createPreviewer(mount());
    await expect(handle.load({ pages: [42] } as unknown as PreviewExport)).rejects.toThrow(TypeError);
  });
});

describe('<bonnie-pdf-previewer> load()', () => {
  if (!customElements.get('bonnie-pdf-previewer-load-test')) {
    customElements.define('bonnie-pdf-previewer-load-test', class extends BonniePdfPreviewerElement {});
  }

  it('runs a load requested before connection once the element mounts', async () => {
    const el = document.createElement('bonnie-pdf-previewer-load-test') as BonniePdfPreviewerElement;
    const done = el.load(fakeDocument('Early'));
    document.body.append(el);
    await done;

    expect(el.shadowRoot!.querySelectorAll('.bpp-page')).toHaveLength(2);
  });

  it('settles a pending load that a newer one replaces before connection', async () => {
    const el = document.createElement('bonnie-pdf-previewer-load-test') as BonniePdfPreviewerElement;
    const first = el.load(exportOf(1));
    const second = el.load(exportOf(3));
    document.body.append(el);

    await expect(first).resolves.toBeUndefined();
    await second;
    expect(el.shadowRoot!.querySelectorAll('.bpp-page')).toHaveLength(3);
  });

  it('applies bpp-no-border class when hide-border attribute is set', () => {
    const el = document.createElement('bonnie-pdf-previewer-load-test') as BonniePdfPreviewerElement;
    el.setAttribute('hide-border', 'true');
    document.body.append(el);
    expect(el.shadowRoot!.querySelector('.bpp')!.classList.contains('bpp-no-border')).toBe(true);
  });

  it('applies bpp-no-border class when hide-border boolean attribute is set', () => {
    const el = document.createElement('bonnie-pdf-previewer-load-test') as BonniePdfPreviewerElement;
    el.setAttribute('hide-border', '');
    document.body.append(el);
    expect(el.shadowRoot!.querySelector('.bpp')!.classList.contains('bpp-no-border')).toBe(true);
  });
});
