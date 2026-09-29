// ---------------------------------------------------------------------------
// Accessibility inspector plugin.
//
// It answers both "what is the layout tree?" and "is this document accessible,
// and where are the problems?". It renders the layout snapshot as an expandable
// tree and decorates every node with its
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
//
// The tree follows the WAI-ARIA tree pattern: one tab stop, roving focus,
// arrow-key navigation, and per-node expand/collapse. Rows carry identity
// (role, type, name, severity) only — geometry belongs to the detail pane, which
// has room to state it in full rather than truncating it into a column.
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
  /** Label for the structure tab. Defaults to `'Accessibility'`. */
  label?: string;
  /**
   * Label for the findings tab. Defaults to `'Issues'`.
   *
   * The findings live on their own tab because they are unbounded: a
   * colour-rich document can carry hundreds, and listing them beside the tree
   * pushes the tree off the bottom of the panel. The tree tab keeps only the
   * fixed-height summary.
   */
  issuesLabel?: string;
  /** Show the panel as soon as a snapshot loads. Defaults to `true`. */
  openByDefault?: boolean;
  /**
   * Paint a persistent tinted marker over every flagged element on the page
   * (an "issues heatmap") whenever the panel is open. Defaults to `true`.
   */
  markIssuesOnPage?: boolean;
  /**
   * Include the WCAG 2.2 findings (text contrast) supplied in the report.
   * Defaults to `true`.
   *
   * This is the viewer-side twin of core's `evaluateCompliance(snapshot, {
   * includeWcag })`: a host that already evaluated with the family switched off
   * simply has no such findings to hide. Turning it off here removes those
   * findings from the tree, the detail pane, the counts, the tab badge, and the
   * on-page markers — PDF/UA-1 findings are untouched.
   *
   * The user can flip it in the panel; this option only sets the initial state.
   */
  showWcagChecks?: boolean;
  /**
   * Show only elements that have findings (or contain one). Defaults to `false`.
   * The user can flip it in the panel.
   */
  onlyIssues?: boolean;
  /**
   * How many levels of the tree are expanded on load. Defaults to every level:
   * the tree is the map of the document, and a map you have to unfold before it
   * says anything is a worse default than a long one you can collapse. Pass a
   * number to open only that many levels (`2` = the document and its pages);
   * branches containing an error are always expanded, however deep they sit.
   */
  defaultExpandDepth?: number;
  /**
   * `localStorage` key under which the panel's own settings (the two filter
   * toggles) persist, mirroring the host element's `preference-key`. Omitted =
   * nothing is stored.
   */
  preferenceKey?: string;
}

/** A painted rect retained so it can be re-scaled on `sync`. */
interface ActiveRect {
  element: HTMLElement;
  rect: SnapshotRect;
}

/** The panel's persisted user settings. */
interface PanelPreferences {
  onlyIssues: boolean;
  showWcag: boolean;
}

const SEVERITY_RANK: Record<ComplianceSeverity, number> = { error: 3, warning: 2, info: 1 };
const SEVERITY_LABEL: Record<ComplianceSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

/** The `standard` value core stamps on contrast findings. */
const WCAG_STANDARD_PREFIX = 'WCAG';

/**
 * Creates the compliance-view plugin. Pass it to `createPreviewer(container, {
 * plugins: [complianceView()] })` and supply the data via
 * `handle.load(pages, { snapshot, report })`.
 */
export function complianceView(options: ComplianceViewOptions = {}): PreviewerPlugin {
  const label = options.label ?? 'Accessibility';
  const issuesLabel = options.issuesLabel ?? 'Issues';
  const openByDefault = options.openByDefault ?? true;
  const markIssues = options.markIssuesOnPage ?? true;
  const defaultExpandDepth = Math.max(0, options.defaultExpandDepth ?? Infinity);
  const preferenceKey = options.preferenceKey;

  interface PanelHandle {
    setVisible(v: boolean): void;
    setBadge(text: string | null, tone?: 'error' | 'warning' | 'info' | 'ok'): void;
  }

  let ctx: PreviewerPluginContext | null = null;
  // Two tabs in the host's shared inspector region: the structure tree and the
  // findings list. They share all state — they are two views of one report.
  let treePanel: PanelHandle | null = null;
  let issuesPanel: PanelHandle | null = null;
  let panelEl: HTMLElement | null = null;
  let issuesEl: HTMLElement | null = null;
  // Whether *either* tab is the active, visible one (host-driven via
  // onVisibilityChange), so on-page markers show for both views of the report.
  let treeVisible = false;
  let issuesVisible = false;
  const isVisible = (): boolean => treeVisible || issuesVisible;

  // ── User settings (persisted when a preference key is supplied) ─────────────
  const stored = readPreferences(preferenceKey);
  let onlyIssues = stored?.onlyIssues ?? options.onlyIssues ?? false;
  let showWcag = stored?.showWcag ?? options.showWcagChecks ?? true;

  const rowsById = new Map<string, HTMLElement>();
  const nodesById = new Map<string, SnapshotNode>();
  const parentById = new Map<string, SnapshotNode>();
  /** Findings that survive the current filters, indexed by node. */
  const findingsByNode = new Map<string, ComplianceFinding[]>();
  /** Node ids whose children are shown. */
  const expanded = new Set<string>();
  let rootNode: SnapshotNode | null = null;
  let report: ComplianceReport | null = null;
  /** The row that owns the tree's single tab stop. */
  let focusedId: string | null = null;

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

  // ── Settings persistence ───────────────────────────────────────────────────

  function readPreferences(key: string | undefined): PanelPreferences | undefined {
    if (!key) return undefined;
    try {
      const raw = globalThis.localStorage?.getItem(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Partial<PanelPreferences>;
      return {
        onlyIssues: parsed.onlyIssues === true,
        showWcag: parsed.showWcag !== false,
      };
    } catch {
      // Storage can be unavailable (privacy mode, sandboxed frames, quotas).
      return undefined;
    }
  }

  function writePreferences(): void {
    if (!preferenceKey) return;
    try {
      globalThis.localStorage?.setItem(preferenceKey, JSON.stringify({ onlyIssues, showWcag }));
    } catch {
      // Storage can be unavailable; the setting simply doesn't survive a reload.
    }
  }

  // ── Finding filtering ──────────────────────────────────────────────────────

  function isWcag(finding: ComplianceFinding): boolean {
    return finding.standard.toUpperCase().startsWith(WCAG_STANDARD_PREFIX);
  }

  /** The findings the current settings admit, in report order. */
  function activeFindings(): ComplianceFinding[] {
    if (!report) return [];
    return showWcag ? [...report.findings] : report.findings.filter(f => !isWcag(f));
  }

  /** Rebuilds the per-node finding index from the current filter state. */
  function indexFindings(): void {
    findingsByNode.clear();
    for (const f of activeFindings()) {
      if (!f.nodeId) continue;
      const list = findingsByNode.get(f.nodeId);
      if (list) list.push(f);
      else findingsByNode.set(f.nodeId, [f]);
    }
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

  // ── Expansion state ────────────────────────────────────────────────────────

  /**
   * Seeds expansion on load: the top `defaultExpandDepth` levels, plus every
   * ancestor of an error so the worst problems are visible without hunting.
   */
  function seedExpansion(): void {
    expanded.clear();
    if (!rootNode) return;
    const visit = (node: SnapshotNode, depth: number): boolean => {
      let hasError = worstSeverity(node.id) === 'error';
      for (const child of node.children) {
        if (visit(child, depth + 1)) hasError = true;
      }
      if (node.children.length > 0 && (depth < defaultExpandDepth || hasError)) expanded.add(node.id);
      return hasError;
    };
    visit(rootNode, 0);
    // Filtering down to issues and then hiding them behind collapsed branches
    // would defeat the filter, so that mode opens the path to every finding.
    if (onlyIssues) expandIssueAncestors();
  }

  /** Opens the path to every node that currently has a finding. */
  function expandIssueAncestors(): void {
    for (const nodeId of findingsByNode.keys()) expandAncestors(nodeId);
  }

  /** Expands every ancestor of a node so its row can be revealed. */
  function expandAncestors(nodeId: string): void {
    let parent = parentById.get(nodeId);
    while (parent) {
      expanded.add(parent.id);
      parent = parentById.get(parent.id);
    }
  }

  function setExpanded(node: SnapshotNode, open: boolean): void {
    if (node.children.length === 0) return;
    if (open) expanded.add(node.id);
    else expanded.delete(node.id);
    applyExpansion(node.id);
  }

  /** Reflects one node's expansion into the DOM without rebuilding the tree. */
  function applyExpansion(nodeId: string): void {
    const row = rowsById.get(nodeId);
    if (!row) return;
    const group = row.parentElement?.querySelector<HTMLElement>(':scope > ul');
    if (!group) return;
    const open = expanded.has(nodeId);
    row.setAttribute('aria-expanded', String(open));
    group.hidden = !open;
  }

  function expandAll(open: boolean): void {
    if (!rootNode) return;
    expanded.clear();
    if (open) {
      const visit = (node: SnapshotNode): void => {
        if (node.children.length > 0) expanded.add(node.id);
        for (const child of node.children) visit(child);
      };
      visit(rootNode);
    } else {
      // The root itself stays open: a tree collapsed to a single row is not a
      // useful state to be dropped into.
      if (rootNode.children.length > 0) expanded.add(rootNode.id);
    }
    rebuildTree();
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function select(node: SnapshotNode, revealRow = false): void {
    if (!ctx) return;
    if (isDocumentNavigationNode(node)) {
      selectedId = null;
      for (const row of rowsById.values()) row.setAttribute('aria-selected', 'false');
      clear(selectionRects);
      renderDetail(null);
      if (revealRow) revealNode(node.id);
      return;
    }
    selectedId = node.id;
    for (const [id, row] of rowsById) row.setAttribute('aria-selected', String(id === node.id));
    paintSelection(node);
    renderDetail(node);
    if (revealRow) revealNode(node.id);
    const first = node.rects[0];
    if (first) ctx.scrollToPage(first.page + 1);
  }

  /** Expands the path to a node, scrolls its row into view, and gives it the tab stop. */
  function revealNode(nodeId: string): void {
    expandAncestors(nodeId);
    let parent = parentById.get(nodeId);
    while (parent) {
      applyExpansion(parent.id);
      parent = parentById.get(parent.id);
    }
    const row = rowsById.get(nodeId);
    if (!row) return;
    setTabStop(nodeId);
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
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
   * Describes where an element sits and how big it is for the detail pane. This
   * is the *only* place geometry appears: tree rows carry identity, not numbers,
   * so a deep tree stays readable at a narrow panel width.
   */
  function describeGeometry(node: SnapshotNode): string {
    const r = node.rects[0];
    if (!r) return '';
    const pages = [...new Set(node.rects.map(rect => rect.page))].sort((a, b) => a - b);
    const pageText =
      pages.length === 1 ? `Page ${pages[0] + 1}` : `Pages ${pages[0] + 1}–${pages[pages.length - 1] + 1}`;
    const size = `${Math.round(r.width)}×${Math.round(r.height)} pt`;
    const at = `at ${Math.round(r.x)}, ${Math.round(r.y)}`;
    const span = node.rects.length > 1 ? ` · ${node.rects.length} fragments` : '';
    return `${pageText} · ${size} ${at}${span}`;
  }

  // The top call passes role 'tree'; nested calls pass 'group', per the
  // WAI-ARIA tree pattern. Each <li> is presentational so the treeitem button
  // is owned directly by the tree/group, preserving the WAI-ARIA tree pattern.
  function buildTree(nodes: SnapshotNode[], role: 'tree' | 'group', level: number): HTMLElement {
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
      row.setAttribute('aria-level', String(level));
      row.dataset.nodeId = node.id;
      // One tab stop for the whole tree (roving tabindex); arrows do the rest.
      row.tabIndex = -1;

      // Expand/collapse affordance. It is a span inside the treeitem, not a
      // nested <button>: nesting interactive elements is invalid, and ARIA gives
      // expansion to the treeitem itself via aria-expanded.
      const hasChildren = node.children.length > 0;
      const twisty = el('span', hasChildren ? 'bpp-tree-twisty' : 'bpp-tree-twisty bpp-tree-twisty-leaf');
      twisty.setAttribute('aria-hidden', 'true');
      row.append(twisty);

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

      row.addEventListener('click', event => {
        // A click on the twisty toggles the branch and selects nothing, so the
        // page view doesn't jump when the user is only navigating the tree.
        if (hasChildren && (event.target as Element | null)?.closest('.bpp-tree-twisty')) {
          setExpanded(node, !expanded.has(node.id));
          setTabStop(node.id);
          return;
        }
        setTabStop(node.id);
        select(node);
        emitSelection(node, isDocumentNavigationNode(node) || event.ctrlKey || event.metaKey, 'tree');
      });
      row.addEventListener('keydown', event => onRowKeyDown(event, node));
      row.addEventListener('focus', () => setTabStop(node.id));
      row.addEventListener('mouseenter', () => {
        if (selectedId !== node.id) paintSelection(node);
      });
      row.addEventListener('mouseleave', () => {
        if (selectedId) {
          const sel = nodesById.get(selectedId);
          if (sel) paintSelection(sel);
        } else {
          clear(selectionRects);
        }
      });

      rowsById.set(node.id, row);
      li.append(row);
      if (hasChildren) {
        const childUl = buildTree(node.children, 'group', level + 1);
        if (childUl.childElementCount > 0) {
          const open = expanded.has(node.id);
          row.setAttribute('aria-expanded', String(open));
          childUl.hidden = !open;
          li.append(childUl);
        } else {
          // Every child was filtered away: the row is a leaf in this view.
          twisty.classList.add('bpp-tree-twisty-leaf');
        }
      }
      ul.append(li);
    }
    return ul;
  }

  // ── Keyboard navigation (WAI-ARIA tree pattern) ────────────────────────────

  /** Rows in visual order, skipping anything inside a collapsed branch. */
  function visibleRows(): HTMLElement[] {
    if (!treeHostEl) return [];
    const all = Array.from(treeHostEl.querySelectorAll<HTMLElement>('.bpp-tree-row'));
    return all.filter(row => {
      let ancestor: HTMLElement | null = row.parentElement;
      while (ancestor && ancestor !== treeHostEl) {
        if (ancestor.tagName === 'UL' && (ancestor as HTMLElement).hidden) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }

  /** Moves the tree's single tab stop to a row. */
  function setTabStop(nodeId: string): void {
    focusedId = nodeId;
    for (const [id, row] of rowsById) row.tabIndex = id === nodeId ? 0 : -1;
  }

  function focusRow(row: HTMLElement | undefined): void {
    if (!row) return;
    const id = row.dataset.nodeId;
    if (id) setTabStop(id);
    row.focus();
  }

  function onRowKeyDown(event: KeyboardEvent, node: SnapshotNode): void {
    const rows = visibleRows();
    const current = rowsById.get(node.id);
    const index = current ? rows.indexOf(current) : -1;
    const hasChildren = node.children.length > 0 && rowsById.get(node.id)?.hasAttribute('aria-expanded') === true;
    const isOpen = expanded.has(node.id);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(rows[index + 1]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(rows[index - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (hasChildren && !isOpen) setExpanded(node, true);
        else if (hasChildren) focusRow(rows[index + 1]);
        break;
      case 'ArrowLeft': {
        event.preventDefault();
        if (hasChildren && isOpen) {
          setExpanded(node, false);
          break;
        }
        const parent = parentById.get(node.id);
        if (parent) focusRow(rowsById.get(parent.id));
        break;
      }
      case 'Home':
        event.preventDefault();
        focusRow(rows[0]);
        break;
      case 'End':
        event.preventDefault();
        focusRow(rows[rows.length - 1]);
        break;
      case '*':
        // The pattern's "expand every sibling" shortcut, widened to the tree.
        event.preventDefault();
        expandAll(true);
        focusRow(rowsById.get(node.id));
        break;
      default:
        break;
    }
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
    for (const node of nodesById.values()) if (pred(node)) return node;
    return null;
  }

  /** Indexes the tree once per load: id → node, and id → parent. */
  function indexNodes(root: SnapshotNode): void {
    nodesById.clear();
    parentById.clear();
    const visit = (node: SnapshotNode): void => {
      nodesById.set(node.id, node);
      for (const child of node.children) {
        parentById.set(child.id, node);
        visit(child);
      }
    };
    visit(root);
  }

  // ── Detail pane ─────────────────────────────────────────────────────────────

  function findingCard(f: ComplianceFinding, jumpable: boolean): HTMLElement {
    const card = el('div', `bpp-cv-finding bpp-cv-finding-${f.severity}`);
    const head = el('div', 'bpp-cv-finding-head');
    head.append(el('span', `bpp-cv-badge bpp-cv-badge-${f.severity}`, SEVERITY_LABEL[f.severity]));
    head.append(el('span', 'bpp-cv-clause', f.clause));
    card.append(head);

    // On the findings tab a card is detached from the tree, so it has to say
    // which element it is about. In the detail pane the element is the heading
    // right above it, and repeating it would be noise.
    const target = f.nodeId ? nodesById.get(f.nodeId) : undefined;
    if (jumpable && target) {
      const where = el('p', 'bpp-cv-finding-where');
      where.append(el('span', 'bpp-cv-finding-el', target.name ? `${target.type} “${target.name}”` : target.type));
      if (f.page != null) where.append(el('span', 'bpp-cv-finding-page', ` · page ${f.page + 1}`));
      card.append(where);
    }

    card.append(el('p', 'bpp-cv-msg', f.message));
    if (f.fixHint) {
      const fix = el('p', 'bpp-cv-fix');
      fix.append(el('span', 'bpp-cv-fix-label', 'Fix: '));
      fix.append(ctx!.ownerDocument.createTextNode(f.fixHint));
      card.append(fix);
    }
    if (jumpable && f.nodeId) {
      const btn = el('button', 'bpp-cv-jump', 'Go to element') as HTMLButtonElement;
      btn.type = 'button';
      btn.addEventListener('click', event => {
        const node = target ?? findNode(n => n.id === f.nodeId);
        if (!node) return;
        // The jump lands on the tree: switch tabs first so the revealed row is
        // on screen when select() scrolls it into view.
        treePanel?.setVisible(true);
        select(node, /* revealRow */ true);
        rowsById.get(node.id)?.focus();
        emitSelection(node, event.ctrlKey || event.metaKey, 'finding');
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
    if (node.name) heading.append(el('span', 'bpp-cv-detail-name', node.name));
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

  /** Severity counts over the findings the current filters admit. */
  function activeCounts(): { error: number; warning: number; info: number } {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const f of activeFindings()) counts[f.severity]++;
    return counts;
  }

  /**
   * Reflects the filtered error/warning count on the Issues tab badge — the tab
   * the count is about, and the one the user should open when it is non-zero.
   * The host aggregates tab badges into the collapsed toolbar toggle's dot.
   */
  function updateBadge(): void {
    if (!issuesPanel) return;
    if (!report) {
      issuesPanel.setBadge(null);
      return;
    }
    const { error, warning } = activeCounts();
    if (error === 0 && warning === 0) {
      issuesPanel.setBadge('✓', 'ok');
    } else {
      issuesPanel.setBadge(String(error + warning), error > 0 ? 'error' : 'warning');
    }
  }

  /** A labelled checkbox for the settings row. */
  function toggle(text: string, checked: boolean, title: string, onChange: (next: boolean) => void): HTMLElement {
    const wrap = el('label', 'bpp-cv-filter');
    wrap.title = title;
    const cb = ctx!.ownerDocument.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    wrap.append(cb, ctx!.ownerDocument.createTextNode(` ${text}`));
    return wrap;
  }

  let summaryEl: HTMLElement | null = null;

  /**
   * The pills and the verdict — the fixed-height part of the summary, shown at
   * the top of both tabs. Everything unbounded (the findings themselves) lives
   * on the Issues tab, so nothing can push the tree off the bottom of the panel.
   */
  function buildHeader(): HTMLElement {
    const wrap = el('div', 'bpp-cv-header');
    if (!report) {
      wrap.append(el('span', 'bpp-cv-empty', 'No compliance report; showing structure roles only.'));
      return wrap;
    }
    const counts = activeCounts();
    const pills = el('div', 'bpp-cv-pills');
    const pill = (kind: string, n: number, text: string): void => {
      pills.append(el('span', `bpp-cv-pill bpp-cv-pill-${kind}${n === 0 ? ' bpp-cv-pill-zero' : ''}`, `${n} ${text}`));
    };
    pill('error', counts.error, counts.error === 1 ? 'error' : 'errors');
    pill('warning', counts.warning, counts.warning === 1 ? 'warning' : 'warnings');
    pill('info', counts.info, 'info');
    wrap.append(pills);

    // The verdict tracks errors only, so hiding the (warning/info) WCAG family
    // never changes it — it stays the answer to "does this document conform?".
    const standard = report.findings.find(f => f.standard.startsWith('PDF/UA'))?.standard ?? 'PDF/UA-1';
    wrap.append(
      el(
        'div',
        `bpp-cv-verdict ${report.passed ? 'bpp-cv-verdict-pass' : 'bpp-cv-verdict-fail'}`,
        report.passed ? `Passes ${standard} checks` : `Does not meet ${standard}`
      )
    );
    return wrap;
  }

  function rebuildSummary(): void {
    if (!summaryEl) return;
    summaryEl.replaceChildren(buildHeader(), buildSettings());
  }

  /** The tree tab's controls: the two filter toggles and expand/collapse. */
  function buildSettings(): HTMLElement {
    const wrap = el('div', 'bpp-cv-settings');

    const filters = el('div', 'bpp-cv-filters');
    if (report) {
      filters.append(
        toggle('Show only elements with issues', onlyIssues, 'Hide every branch of the tree with no findings in it', next => {
          onlyIssues = next;
          if (onlyIssues) expandIssueAncestors();
          writePreferences();
          rebuildTree();
        })
      );
      filters.append(wcagToggle());
    }
    wrap.append(filters);

    const actions = el('div', 'bpp-cv-tree-actions');
    const action = (text: string, title: string, onClick: () => void): void => {
      const btn = el('button', 'bpp-cv-action', text) as HTMLButtonElement;
      btn.type = 'button';
      btn.title = title;
      btn.addEventListener('click', onClick);
      actions.append(btn);
    };
    action('Expand all', 'Expand every branch of the tree', () => expandAll(true));
    action('Collapse all', 'Collapse the tree back to the document', () => expandAll(false));
    wrap.append(actions);

    return wrap;
  }

  /** The WCAG switch, which both tabs carry — it filters what both of them show. */
  function wcagToggle(): HTMLElement {
    return toggle(
      'Include WCAG contrast checks',
      showWcag,
      'WCAG 2.2 SC 1.4.3 text-contrast findings. PDF/UA-1 sets no numeric contrast requirement, so these are a separate standard you may be tracking separately.',
      next => {
        showWcag = next;
        writePreferences();
        applyFilters();
      }
    );
  }

  // ── Findings tab ────────────────────────────────────────────────────────────

  /**
   * Every finding, grouped most-severe first. This is the unbounded view, and it
   * gets a whole tab to itself so it never competes with the tree for height.
   */
  function rebuildIssues(): void {
    if (!issuesEl) return;
    issuesEl.replaceChildren();
    if (!report) {
      issuesEl.append(
        el('p', 'bpp-cv-empty', 'No compliance report was supplied, so there are no findings to list.')
      );
      return;
    }

    const head = el('div', 'bpp-cv-issues-head');
    head.append(buildHeader());
    head.append(wcagToggle());
    issuesEl.append(head);

    const list = el('div', 'bpp-cv-issues-list');
    const findings = activeFindings();
    const order: ComplianceSeverity[] = ['error', 'warning', 'info'];
    for (const severity of order) {
      const group = findings.filter(f => f.severity === severity);
      if (group.length === 0) continue;
      const section = el('section', 'bpp-cv-issues-group');
      section.append(
        el('div', 'bpp-cv-section-title', `${SEVERITY_LABEL[severity]}${group.length === 1 ? '' : 's'} (${group.length})`)
      );
      for (const f of group) {
        // Document-level findings have no element to jump to; the rest do.
        const card = findingCard(f, f.nodeId != null);
        if (!f.nodeId) card.prepend(el('span', 'bpp-cv-scope', 'Document'));
        section.append(card);
      }
      list.append(section);
    }
    if (list.childElementCount === 0) {
      list.append(
        el(
          'p',
          'bpp-cv-empty',
          showWcag
            ? 'No findings. This document passes every check the preflight runs.'
            : 'No findings, with contrast checks excluded. Include them to check text contrast too.'
        )
      );
    }
    issuesEl.append(list);
  }

  let treeHostEl: HTMLElement | null = null;

  /** Re-applies the finding filters everywhere they show. */
  function applyFilters(): void {
    indexFindings();
    if (onlyIssues) expandIssueAncestors();
    rebuildSummary();
    rebuildIssues();
    rebuildTree();
    const selected = selectedId ? nodesById.get(selectedId) : null;
    renderDetail(selected ?? null);
    updateBadge();
    if (isVisible()) paintAllMarkers();
    if (selected) paintSelection(selected);
    else clear(selectionRects);
  }

  function rebuildTree(): void {
    if (!treeHostEl || !rootNode) return;
    rowsById.clear();
    // buildTree returns the <ul role="tree"> itself; no bare wrapper <ul>.
    const tree = buildTree([rootNode], 'tree', 1);
    tree.classList.add('bpp-tree', 'bpp-cv-tree');
    tree.setAttribute('aria-label', label);
    treeHostEl.replaceChildren(tree);
    // A filter that prunes everything must say so; a blank pane reads as a bug.
    if (tree.childElementCount === 0) {
      treeHostEl.append(
        el(
          'p',
          'bpp-cv-empty',
          showWcag
            ? 'No elements with issues. Clear the filter to see the whole document.'
            : 'No elements with issues. Contrast checks are hidden — include them, or clear the filter to see the whole document.'
        )
      );
    }
    // Re-apply selection highlight in the rebuilt tree.
    if (selectedId) {
      const row = rowsById.get(selectedId);
      if (row) row.setAttribute('aria-selected', 'true');
    }
    // Restore the tab stop, falling back to the first visible row.
    const keep = focusedId && rowsById.has(focusedId) ? focusedId : visibleRows()[0]?.dataset.nodeId;
    if (keep) setTabStop(keep);
  }

  /**
   * Host-driven visibility: paint the issues heatmap while either of this
   * plugin's tabs shows. Switching between them must not flicker the overlays,
   * so the two callbacks are folded into one visibility state.
   */
  function onVisibilityChange(which: 'tree' | 'issues', next: boolean): void {
    const was = isVisible();
    if (which === 'tree') treeVisible = next;
    else issuesVisible = next;
    const now = isVisible();
    if (now === was) return;
    if (now) {
      paintAllMarkers();
    } else {
      clear(markerRects);
      clear(selectionRects);
    }
  }

  // ── Plugin lifecycle ────────────────────────────────────────────────────────

  return {
    name: 'compliance-view',
    needsLayout: true,

    setup(context) {
      ctx = context;
      const doc = context.ownerDocument;

      // The host owns the toolbar toggle and the tab strip; this plugin supplies
      // two panels' content, a tab badge (via the handle), and reacts to
      // visibility. Two tabs, because the tree wants a fixed frame and the
      // findings list is unbounded — sharing one panel makes them fight for it.
      panelEl = doc.createElement('div');
      panelEl.className = 'bpp-cv-host';
      treePanel = context.addSidePanel({
        id: 'compliance',
        label,
        element: panelEl,
        defaultOpen: openByDefault,
        onVisibilityChange: next => onVisibilityChange('tree', next),
      });

      issuesEl = doc.createElement('div');
      issuesEl.className = 'bpp-cv-host bpp-cv-issues';
      issuesPanel = context.addSidePanel({
        id: 'compliance-issues',
        label: issuesLabel,
        element: issuesEl,
        onVisibilityChange: next => onVisibilityChange('issues', next),
      });

      return () => {
        ctx = null;
        treePanel = null;
        issuesPanel = null;
        panelEl = null;
        issuesEl = null;
      };
    },

    load(context: PreviewerLoadContext) {
      ctx = context;
      rowsById.clear();
      nodesById.clear();
      parentById.clear();
      findingsByNode.clear();
      expanded.clear();
      clear(markerRects);
      clear(selectionRects);
      selectedId = null;
      focusedId = null;
      rootNode = null;
      report = context.report ?? null;
      clickAbort?.abort();
      clickAbort = null;
      if (!panelEl) return;

      if (!context.snapshot) {
        panelEl.textContent = 'No structure data for this document.';
        if (issuesEl) issuesEl.textContent = 'No structure data for this document.';
        issuesPanel?.setBadge(null);
        clear(markerRects);
        clear(selectionRects);
        return;
      }
      rootNode = context.snapshot.root;
      indexNodes(rootNode);
      indexFindings();
      seedExpansion();

      // Build the panel: summary, tree, detail.
      panelEl.replaceChildren();
      summaryEl = el('div', 'bpp-cv-summary');
      panelEl.append(summaryEl);
      treeHostEl = el('div', 'bpp-cv-tree-host');
      panelEl.append(treeHostEl);
      const detailWrap = el('div', 'bpp-cv-detail');
      detailWrap.append(el('div', 'bpp-cv-section-title', 'Element'));
      detailEl = el('div', 'bpp-cv-detail-body');
      detailWrap.append(detailEl);
      panelEl.append(detailWrap);

      rebuildSummary();
      rebuildIssues();
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
            if ((!isVisible() && !event.ctrlKey && !event.metaKey) || !ctx) return;
            const scale = ctx.scale();
            if (scale <= 0) return;
            const bounds = pageEl.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / scale;
            const y = (event.clientY - bounds.top) / scale;
            const node = hitTest(pageIndex, x, y);
            if (node) {
              // Clicking an element on the page is a request to inspect it, so
              // land on the tab that shows elements.
              if (!treeVisible) treePanel?.setVisible(true);
              select(node, /* revealRow */ true);
              emitSelection(node, isDocumentNavigationNode(node) || event.ctrlKey || event.metaKey, 'page');
            }
          },
          { signal: clickAbort.signal }
        );
      }

      // Repaint the issues heatmap if this panel is the active, visible tab
      // (visibility is host-driven; a fresh load rebuilt the page overlays).
      if (isVisible()) paintAllMarkers();
    },

    sync({ scale }) {
      for (const h of markerRects) position(h.element, h.rect, scale);
      for (const h of selectionRects) position(h.element, h.rect, scale);
    },

    selectSnapshotNode(nodeId) {
      const node = nodesById.get(nodeId);
      if (!node) return false;
      if (!treeVisible) treePanel?.setVisible(true);
      select(node, /* revealRow */ true);
      return true;
    },

    teardown() {
      clear(markerRects);
      clear(selectionRects);
      rowsById.clear();
      nodesById.clear();
      parentById.clear();
      findingsByNode.clear();
      expanded.clear();
      selectedId = null;
      focusedId = null;
      rootNode = null;
      report = null;
      clickAbort?.abort();
      clickAbort = null;
    },
  };
}
