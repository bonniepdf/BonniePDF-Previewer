// ---------------------------------------------------------------------------
// Accessibility inspector plugin.
//
// It answers both "what is the layout tree?" and "is this document accessible,
// and where are the problems?". It renders the layout snapshot as a tree and
// decorates every node with its
// accessibility role and a severity dot, surfaces a document-level summary, and
// — its differentiator — paints the flagged elements directly onto the page so an
// author can *see* the inaccessible regions and click straight to the fix.
//
// It consumes two inputs from the host load: the enriched `snapshot` (nodes carry
// `a11y`) and an optional precomputed `report` (from core's
// `evaluateCompliance`). With a report it shows severities and fix hints; with
// only a snapshot it still shows role/tagged/artifact badges. It never modifies
// the SVG and never touches controller internals — everything is drawn into the
// host's per-page overlay layers.
// ---------------------------------------------------------------------------

import type {
  PreviewerPlugin,
  PreviewerPluginContext,
  PreviewerLoadContext,
  SnapshotNode,
  SnapshotRect,
  ComplianceFinding,
  ComplianceReport,
  ComplianceSeverity,
} from './types';

export interface ComplianceViewOptions {
  /** Panel header label. Defaults to `'Accessibility'`. */
  label?: string;
  /** Show the panel as soon as a snapshot loads. Defaults to `true`. */
  openByDefault?: boolean;
  /**
   * Paint a persistent tinted marker over every flagged element on the page
   * (an "issues heatmap") whenever the panel is open. Defaults to `true`.
   */
  markIssuesOnPage?: boolean;
}

/** A painted rect retained so it can be re-scaled on `sync`. */
interface ActiveRect {
  element: HTMLElement;
  rect: SnapshotRect;
}

const SEVERITY_RANK: Record<ComplianceSeverity, number> = { error: 3, warning: 2, info: 1 };
const SEVERITY_LABEL: Record<ComplianceSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

/**
 * Creates the compliance-view plugin. Pass it to `createPreviewer(container, {
 * plugins: [complianceView()] })` and supply the data via
 * `handle.load(pages, { snapshot, report })`.
 */
export function complianceView(options: ComplianceViewOptions = {}): PreviewerPlugin {
  const label = options.label ?? 'Accessibility';
  const openByDefault = options.openByDefault ?? true;
  const markIssues = options.markIssuesOnPage ?? true;

  let ctx: PreviewerPluginContext | null = null;
  let panel: {
    setVisible(v: boolean): void;
    setBadge(text: string | null, tone?: 'error' | 'warning' | 'info' | 'ok'): void;
  } | null = null;
  let panelEl: HTMLElement | null = null;
  // Tracks whether this panel is the active, visible tab (host-driven via
  // onVisibilityChange), so on-page markers only show when the panel is shown.
  let visible = false;
  let onlyIssues = false;

  const rowsById = new Map<string, HTMLElement>();
  const findingsByNode = new Map<string, ComplianceFinding[]>();
  let rootNode: SnapshotNode | null = null;
  let report: ComplianceReport | null = null;

  // Two overlay layers, both re-scaled on sync: persistent issue markers and the
  // transient selection highlight.
  let markerRects: ActiveRect[] = [];
  let selectionRects: ActiveRect[] = [];
  let selectedId: string | null = null;
  let clickAbort: AbortController | null = null;

  /**
   * The synthetic Document and constructor-created first Page share the
   * Document declaration's source id. Treat both as source-navigation/reset
   * targets, matching the former standalone structure inspector.
   */
  function isDocumentNavigationNode(node: SnapshotNode): boolean {
    if (!rootNode) return false;
    if (node.id === rootNode.id) return true;
    return (
      node.type === 'Page' &&
      rootNode.children.includes(node) &&
      rootNode.sourceId !== undefined &&
      node.sourceId === rootNode.sourceId
    );
  }

  // ── Severity helpers ───────────────────────────────────────────────────────

  function worstSeverity(nodeId: string): ComplianceSeverity | null {
    const list = findingsByNode.get(nodeId);
    if (!list || list.length === 0) return null;
    let worst: ComplianceSeverity = 'info';
    for (const f of list) if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) worst = f.severity;
    return worst;
  }

  // ── Overlay painting ───────────────────────────────────────────────────────

  function position(el: HTMLElement, rect: SnapshotRect, scale: number): void {
    el.style.left = `${rect.x * scale}px`;
    el.style.top = `${rect.y * scale}px`;
    el.style.width = `${rect.width * scale}px`;
    el.style.height = `${rect.height * scale}px`;
  }

  function clear(list: ActiveRect[]): void {
    for (const h of list) h.element.remove();
    list.length = 0;
  }

  function paintInto(list: ActiveRect[], node: SnapshotNode, className: string): void {
    if (!ctx) return;
    for (const rect of node.rects) {
      const overlay = ctx.overlayFor(rect.page);
      if (!overlay) continue;
      const el = ctx.ownerDocument.createElement('div');
      el.className = className;
      position(el, rect, ctx.scale());
      overlay.append(el);
      list.push({ element: el, rect });
    }
  }

  /** Paints a faint severity-tinted marker over every flagged node (issues heatmap). */
  function paintAllMarkers(): void {
    clear(markerRects);
    if (!markIssues || !rootNode) return;
    const visit = (node: SnapshotNode): void => {
      const sev = worstSeverity(node.id);
      if (sev) paintInto(markerRects, node, `bpp-cv-mark bpp-cv-mark-${sev}`);
      for (const child of node.children) visit(child);
    };
    visit(rootNode);
  }

  function paintSelection(node: SnapshotNode): void {
    clear(selectionRects);
    const sev = worstSeverity(node.id);
    const cls = sev ? `bpp-cv-sel bpp-cv-sel-${sev}` : 'bpp-cv-sel';
    paintInto(selectionRects, node, cls);
  }

  // ── Hit testing (reverse link from the page) ───────────────────────────────

  function hitTest(pageIndex: number, x: number, y: number): SnapshotNode | null {
    if (!rootNode) return null;
    let best: SnapshotNode | null = null;
    let bestDepth = -1;
    let bestArea = Infinity;
    const visit = (node: SnapshotNode, depth: number): void => {
      for (const r of node.rects) {
        if (r.page !== pageIndex) continue;
        if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
        const area = r.width * r.height;
        if (depth > bestDepth || (depth === bestDepth && area < bestArea)) {
          best = node;
          bestDepth = depth;
          bestArea = area;
        }
      }
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(rootNode, 0);
    return best;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function select(node: SnapshotNode, revealRow = false): void {
    if (!ctx) return;
    if (isDocumentNavigationNode(node)) {
      selectedId = null;
      for (const row of rowsById.values()) row.setAttribute('aria-selected', 'false');
      clear(selectionRects);
      renderDetail(null);
      if (revealRow) {
        const row = rowsById.get(node.id);
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    selectedId = node.id;
    for (const [id, row] of rowsById) row.setAttribute('aria-selected', String(id === node.id));
    paintSelection(node);
    renderDetail(node);
    if (revealRow) {
      const row = rowsById.get(node.id);
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    }
    const first = node.rects[0];
    if (first) ctx.scrollToPage(first.page + 1);
  }

  function emitSelection(node: SnapshotNode, sourceNavigation: boolean, origin: 'page' | 'tree' | 'finding'): void {
    if (!ctx) return;
    ctx.hostElement.dispatchEvent(
      new CustomEvent('bonniepdf-node-select', {
        bubbles: true,
        composed: true,
        detail: {
          nodeId: node.id,
          sourceId: node.sourceId,
          sourceNavigation,
          origin,
        },
      }),
    );
  }

  // ── DOM building ───────────────────────────────────────────────────────────

  function el(tag: string, className?: string, text?: string): HTMLElement {
    const doc = ctx!.ownerDocument;
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * Describes where an element sits and how big it is for the detail pane. Tree
   * rows carry the compact size; the detail adds page location and point units.
   */
  function describeGeometry(node: SnapshotNode): string {
    const r = node.rects[0];
    if (!r) return '';
    const pages = [...new Set(node.rects.map(rect => rect.page))].sort((a, b) => a - b);
    const pageText =
      pages.length === 1 ? `Page ${pages[0] + 1}` : `Pages ${pages[0] + 1}–${pages[pages.length - 1] + 1}`;
    return `${pageText} · ${Math.round(r.width)}×${Math.round(r.height)} pt`;
  }

  /** Compact row geometry retained from the former structure inspector. */
  function formatSize(node: SnapshotNode): string {
    const r = node.rects[0];
    if (!r) return '';
    let size = `${Math.round(r.width)}×${Math.round(r.height)}`;
    if (node.rects.length > 1) size += ` · ${node.rects.length}p`;
    return size;
  }

  // The top call passes role 'tree'; nested calls pass 'group', per the
  // WAI-ARIA tree pattern. Each <li> is presentational so the treeitem button
  // is owned directly by the tree/group, preserving the WAI-ARIA tree pattern.
  function buildTree(nodes: SnapshotNode[], role: 'tree' | 'group'): HTMLElement {
    const ul = el('ul');
    ul.setAttribute('role', role);
    for (const node of nodes) {
      const sev = worstSeverity(node.id);
      const subtreeHasIssue = sev != null || descendantHasIssue(node);
      // In "only issues" mode, prune branches with no findings anywhere below.
      if (onlyIssues && !subtreeHasIssue) continue;

      const li = el('li');
      li.setAttribute('role', 'none');
      const row = el('button', 'bpp-tree-row bpp-cv-row') as HTMLButtonElement;
      row.type = 'button';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', 'false');

      // Severity dot (or a neutral tagged/artifact indicator).
      const dot = el('span', 'bpp-cv-dot');
      if (sev) {
        dot.classList.add(`bpp-cv-dot-${sev}`);
        dot.title = `${SEVERITY_LABEL[sev]}: ${findingsByNode.get(node.id)!.length} finding(s)`;
      } else if (node.a11y?.artifact) {
        dot.classList.add('bpp-cv-dot-artifact');
        dot.title = 'Artifact (not in reading order)';
      } else if (node.a11y?.tagged) {
        dot.classList.add('bpp-cv-dot-ok');
        dot.title = 'Tagged content';
      } else {
        dot.classList.add('bpp-cv-dot-none');
      }
      row.append(dot);

      // Role chip.
      if (node.a11y?.role) {
        const chip = el('span', `bpp-cv-role bpp-cv-role-${chipKind(node.a11y.role)}`, node.a11y.role);
        row.append(chip);
      }

      row.append(el('span', 'bpp-tree-type', node.type));
      if (node.name) row.append(el('span', 'bpp-tree-name', node.name));
      const sizeText = formatSize(node);
      if (sizeText) {
        const size = el('span', 'bpp-tree-size', sizeText);
        size.title = 'width × height in points';
        row.append(size);
      }

      row.addEventListener('click', event => {
        select(node);
        emitSelection(node, isDocumentNavigationNode(node) || event.ctrlKey || event.metaKey, 'tree');
      });
      row.addEventListener('mouseenter', () => {
        if (selectedId !== node.id) paintSelection(node);
      });
      row.addEventListener('mouseleave', () => {
        if (selectedId) {
          const sel = findNode(node => node.id === selectedId);
          if (sel) paintSelection(sel);
        } else {
          clear(selectionRects);
        }
      });

      rowsById.set(node.id, row);
      li.append(row);
      if (node.children.length > 0) {
        const childUl = buildTree(node.children, 'group');
        if (childUl.childElementCount > 0) li.append(childUl);
      }
      ul.append(li);
    }
    return ul;
  }

  /** Broad role category for chip colouring. */
  function chipKind(role: string): string {
    if (/^H[1-6]$/.test(role)) return 'heading';
    if (role === 'Figure') return 'figure';
    if (role === 'Artifact') return 'artifact';
    if (role === 'Table' || role === 'TH' || role === 'TD' || role === 'TR') return 'table';
    return 'default';
  }

  function descendantHasIssue(node: SnapshotNode): boolean {
    for (const child of node.children) {
      if (worstSeverity(child.id)) return true;
      if (descendantHasIssue(child)) return true;
    }
    return false;
  }

  function findNode(pred: (n: SnapshotNode) => boolean): SnapshotNode | null {
    if (!rootNode) return null;
    let found: SnapshotNode | null = null;
    const visit = (n: SnapshotNode): void => {
      if (found) return;
      if (pred(n)) {
        found = n;
        return;
      }
      for (const c of n.children) visit(c);
    };
    visit(rootNode);
    return found;
  }

  // ── Detail pane ─────────────────────────────────────────────────────────────

  function findingCard(f: ComplianceFinding, jumpable: boolean): HTMLElement {
    const card = el('div', `bpp-cv-finding bpp-cv-finding-${f.severity}`);
    const head = el('div', 'bpp-cv-finding-head');
    head.append(el('span', `bpp-cv-badge bpp-cv-badge-${f.severity}`, SEVERITY_LABEL[f.severity]));
    head.append(el('span', 'bpp-cv-clause', f.clause));
    card.append(head);
    card.append(el('p', 'bpp-cv-msg', f.message));
    if (f.fixHint) {
      const fix = el('p', 'bpp-cv-fix');
      fix.append(el('span', 'bpp-cv-fix-label', 'Fix: '));
      fix.append(ctx!.ownerDocument.createTextNode(f.fixHint));
      card.append(fix);
    }
    if (jumpable && f.nodeId) {
      const btn = el('button', 'bpp-cv-jump', `Go to element${f.page != null ? ` (page ${f.page + 1})` : ''}`) as HTMLButtonElement;
      btn.type = 'button';
      btn.addEventListener('click', event => {
        const target = findNode(n => n.id === f.nodeId);
        if (target) {
          select(target, true);
          emitSelection(target, event.ctrlKey || event.metaKey, 'finding');
        }
      });
      card.append(btn);
    }
    return card;
  }

  let detailEl: HTMLElement | null = null;

  function renderDetail(node: SnapshotNode | null): void {
    if (!detailEl) return;
    detailEl.replaceChildren();
    const list = node ? findingsByNode.get(node.id) : undefined;
    if (!node) {
      detailEl.append(el('p', 'bpp-cv-empty', 'Select an element to see its accessibility details.'));
      return;
    }
    const heading = el('div', 'bpp-cv-detail-head');
    heading.append(el('span', 'bpp-cv-detail-type', node.type));
    if (node.a11y?.role) heading.append(el('span', `bpp-cv-role bpp-cv-role-${chipKind(node.a11y.role)}`, node.a11y.role));
    detailEl.append(heading);

    const geometry = describeGeometry(node);
    if (geometry) detailEl.append(el('p', 'bpp-cv-geom', geometry));

    if (node.a11y?.alt) detailEl.append(el('p', 'bpp-cv-attr', `Alt: “${node.a11y.alt}”`));

    if (!list || list.length === 0) {
      detailEl.append(el('p', 'bpp-cv-empty', node.a11y ? 'No accessibility issues on this element.' : 'This element carries no structure role.'));
      return;
    }
    for (const f of list) detailEl.append(findingCard(f, false));
  }

  // ── Summary / document-level findings ───────────────────────────────────────

  /** Reflects the report's error/warning count on the panel's host tab badge. */
  function updateBadge(): void {
    if (!panel) return;
    if (!report) {
      panel.setBadge(null);
      return;
    }
    const { errorCount, warningCount } = report;
    if (errorCount === 0 && warningCount === 0) {
      panel.setBadge('✓', 'ok');
    } else {
      panel.setBadge(String(errorCount + warningCount), errorCount > 0 ? 'error' : 'warning');
    }
  }

  function buildSummary(): HTMLElement {
    const wrap = el('div', 'bpp-cv-summary');
    if (!report) {
      wrap.append(el('span', 'bpp-cv-empty', 'No compliance report; showing structure roles only.'));
      return wrap;
    }
    const pills = el('div', 'bpp-cv-pills');
    const pill = (kind: string, n: number, text: string): void => {
      const p = el('span', `bpp-cv-pill bpp-cv-pill-${kind}${n === 0 ? ' bpp-cv-pill-zero' : ''}`, `${n} ${text}`);
      pills.append(p);
    };
    pill('error', report.errorCount, report.errorCount === 1 ? 'error' : 'errors');
    pill('warning', report.warningCount, report.warningCount === 1 ? 'warning' : 'warnings');
    pill('info', report.infoCount, 'info');
    wrap.append(pills);

    const standard = report.findings[0]?.standard ?? 'PDF/UA-1';
    const verdict = el(
      'div',
      `bpp-cv-verdict ${report.passed ? 'bpp-cv-verdict-pass' : 'bpp-cv-verdict-fail'}`,
      report.passed ? `Passes ${standard} checks` : `Does not meet ${standard}`
    );
    wrap.append(verdict);

    // "Show only issues" filter.
    const filter = el('label', 'bpp-cv-filter');
    const cb = ctx!.ownerDocument.createElement('input');
    cb.type = 'checkbox';
    cb.checked = onlyIssues;
    cb.addEventListener('change', () => {
      onlyIssues = cb.checked;
      rebuildTree();
    });
    filter.append(cb, ctx!.ownerDocument.createTextNode(' Show only elements with issues'));
    wrap.append(filter);

    // Document-level findings (no nodeId).
    const docFindings = report.findings.filter(f => !f.nodeId);
    if (docFindings.length > 0) {
      const docWrap = el('div', 'bpp-cv-doc-findings');
      docWrap.append(el('div', 'bpp-cv-section-title', 'Document'));
      for (const f of docFindings) docWrap.append(findingCard(f, false));
      wrap.append(docWrap);
    }
    return wrap;
  }

  let treeHostEl: HTMLElement | null = null;

  function rebuildTree(): void {
    if (!treeHostEl || !rootNode) return;
    rowsById.clear();
    // buildTree returns the <ul role="tree"> itself; no bare wrapper <ul>.
    const tree = buildTree([rootNode], 'tree');
    tree.classList.add('bpp-tree', 'bpp-cv-tree');
    tree.setAttribute('aria-label', label);
    treeHostEl.replaceChildren(tree);
    // Re-apply selection highlight in the rebuilt tree.
    if (selectedId) {
      const row = rowsById.get(selectedId);
      if (row) row.setAttribute('aria-selected', 'true');
    }
  }

  /** Host-driven visibility: paint the issues heatmap only while this tab shows. */
  function onVisibilityChange(next: boolean): void {
    visible = next;
    if (next) {
      paintAllMarkers();
    } else {
      clear(markerRects);
      clear(selectionRects);
    }
  }

  // ── Plugin lifecycle ────────────────────────────────────────────────────────

  return {
    name: 'compliance-view',

    setup(context) {
      ctx = context;
      const doc = context.ownerDocument;

      // The host owns the toolbar toggle and tab; this plugin only supplies the
      // panel content, a tab badge (via the handle), and reacts to visibility.
      panelEl = doc.createElement('div');
      panelEl.className = 'bpp-cv-host';
      panel = context.addSidePanel({
        id: 'compliance',
        label,
        element: panelEl,
        defaultOpen: openByDefault,
        onVisibilityChange,
      });

      return () => {
        ctx = null;
        panel = null;
        panelEl = null;
      };
    },

    load(context: PreviewerLoadContext) {
      ctx = context;
      rowsById.clear();
      findingsByNode.clear();
      clear(markerRects);
      clear(selectionRects);
      selectedId = null;
      rootNode = null;
      report = context.report ?? null;
      clickAbort?.abort();
      clickAbort = null;
      if (!panelEl) return;

      if (!context.snapshot) {
        panelEl.textContent = 'No structure data for this document.';
        panel?.setBadge(null);
        clear(markerRects);
        clear(selectionRects);
        return;
      }
      rootNode = context.snapshot.root;

      // Index findings by node.
      if (report) {
        for (const f of report.findings) {
          if (!f.nodeId) continue;
          const list = findingsByNode.get(f.nodeId);
          if (list) list.push(f);
          else findingsByNode.set(f.nodeId, [f]);
        }
      }

      // Build the panel: summary, tree, detail.
      panelEl.replaceChildren();
      panelEl.append(buildSummary());
      treeHostEl = el('div', 'bpp-cv-tree-host');
      panelEl.append(treeHostEl);
      const detailWrap = el('div', 'bpp-cv-detail');
      detailWrap.append(el('div', 'bpp-cv-section-title', 'Element'));
      detailEl = el('div', 'bpp-cv-detail-body');
      detailWrap.append(detailEl);
      panelEl.append(detailWrap);

      rebuildTree();
      renderDetail(null);
      updateBadge();

      // Reverse linking: click an element on the page to select it.
      clickAbort = new AbortController();
      for (let i = 0; i < context.pageCount(); i++) {
        const pageEl = context.pageElement(i);
        if (!pageEl) continue;
        const pageIndex = i;
        pageEl.addEventListener(
          'click',
          event => {
            if ((!visible && !event.ctrlKey && !event.metaKey) || !ctx) return;
            const scale = ctx.scale();
            if (scale <= 0) return;
            const bounds = pageEl.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / scale;
            const y = (event.clientY - bounds.top) / scale;
            const node = hitTest(pageIndex, x, y);
            if (node) {
              select(node, /* revealRow */ true);
              emitSelection(node, isDocumentNavigationNode(node) || event.ctrlKey || event.metaKey, 'page');
            }
          },
          { signal: clickAbort.signal }
        );
      }

      // Repaint the issues heatmap if this panel is the active, visible tab
      // (visibility is host-driven; a fresh load rebuilt the page overlays).
      if (visible) paintAllMarkers();
    },

    sync({ scale }) {
      for (const h of markerRects) position(h.element, h.rect, scale);
      for (const h of selectionRects) position(h.element, h.rect, scale);
    },

    selectSnapshotNode(nodeId) {
      const node = findNode(candidate => candidate.id === nodeId);
      if (!node) return false;
      select(node, /* revealRow */ true);
      return true;
    },

    teardown() {
      clear(markerRects);
      clear(selectionRects);
      rowsById.clear();
      findingsByNode.clear();
      selectedId = null;
      rootNode = null;
      report = null;
      clickAbort?.abort();
      clickAbort = null;
    },
  };
}
