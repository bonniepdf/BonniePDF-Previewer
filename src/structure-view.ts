// ---------------------------------------------------------------------------
// Structure-view plugin.
//
// Renders the document's layout snapshot as a collapsible tree in a side panel.
// Hovering a node faintly highlights the area it occupied; selecting it paints a
// solid highlight over every rectangle it produced (one per page it spans) and
// scrolls the first into view. The highlights are drawn into per-page overlay
// layers that sit above the SVG with `pointer-events: none`, so the underlying
// preview stays fully interactive and the exported SVG is never modified.
//
// This is the structure view, built
// entirely on the host's plugin contract — it never touches controller internals.
// ---------------------------------------------------------------------------

import type {
  PreviewerPlugin,
  PreviewerPluginContext,
  PreviewerLoadContext,
  SnapshotNode,
  SnapshotRect,
} from './types';

export interface StructureViewOptions {
  /** Panel header label. Defaults to `'Structure'`. */
  label?: string;
  /** Show the panel as soon as a snapshot loads. Defaults to `true`. */
  openByDefault?: boolean;
}

/** A painted highlight rect, retained so it can be re-scaled on `sync`. */
interface ActiveHighlight {
  element: HTMLElement;
  rect: SnapshotRect;
}

/**
 * Creates the structure-view plugin. Pass it to `createPreviewer(container, {
 * plugins: [structureView()] })` and supply the snapshot via
 * `handle.load(pages, { snapshot })`.
 */
export function structureView(options: StructureViewOptions = {}): PreviewerPlugin {
  const label = options.label ?? 'Structure';
  const openByDefault = options.openByDefault ?? true;

  let ctx: PreviewerPluginContext | null = null;
  let panel: { setVisible(v: boolean): void } | null = null;
  let panelEl: HTMLElement | null = null;
  let toggleButton: HTMLButtonElement | null = null;
  let visible = false;

  const rowsById = new Map<string, HTMLElement>();
  let highlights: ActiveHighlight[] = [];
  let selectedId: string | null = null;

  function setVisible(next: boolean): void {
    visible = next;
    panel?.setVisible(next);
    toggleButton?.setAttribute('aria-pressed', String(next));
    toggleButton?.classList.toggle('bpp-btn-active', next);
    if (!next) clearHighlights();
  }

  function clearHighlights(): void {
    for (const h of highlights) h.element.remove();
    highlights = [];
  }

  function paint(node: SnapshotNode, hover: boolean): void {
    if (!ctx) return;
    clearHighlights();
    for (const rect of node.rects) {
      const overlay = ctx.overlayFor(rect.page);
      if (!overlay) continue;
      const el = ctx.ownerDocument.createElement('div');
      el.className = hover ? 'bpp-hl bpp-hl-hover' : 'bpp-hl';
      position(el, rect, ctx.scale());
      overlay.append(el);
      highlights.push({ element: el, rect });
    }
  }

  function position(el: HTMLElement, rect: SnapshotRect, scale: number): void {
    el.style.left = `${rect.x * scale}px`;
    el.style.top = `${rect.y * scale}px`;
    el.style.width = `${rect.width * scale}px`;
    el.style.height = `${rect.height * scale}px`;
  }

  function select(node: SnapshotNode): void {
    if (!ctx) return;
    selectedId = node.id;
    for (const [id, row] of rowsById) row.setAttribute('aria-selected', String(id === node.id));
    paint(node, false);
    const first = node.rects[0];
    if (first) ctx.scrollToPage(first.page + 1);
  }

  /** Builds the <ul> tree for a node's children. */
  function buildTree(doc: Document, nodes: SnapshotNode[]): HTMLElement {
    const ul = doc.createElement('ul');
    for (const node of nodes) {
      const li = doc.createElement('li');
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'bpp-tree-row';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', 'false');

      const type = doc.createElement('span');
      type.className = 'bpp-tree-type';
      type.textContent = node.type;
      row.append(type);
      if (node.name) {
        const name = doc.createElement('span');
        name.className = 'bpp-tree-name';
        name.textContent = node.name;
        row.append(name);
      }

      row.addEventListener('click', () => select(node));
      row.addEventListener('mouseenter', () => {
        if (selectedId !== node.id) paint(node, true);
      });
      row.addEventListener('mouseleave', () => {
        if (selectedId) {
          const sel = rowsById.get(selectedId);
          if (sel) {
            // Restore the selected node's solid highlight.
            const selectedNode = (sel as HTMLElement & { _node?: SnapshotNode })._node;
            if (selectedNode) paint(selectedNode, false);
          }
        } else {
          clearHighlights();
        }
      });
      (row as HTMLElement & { _node?: SnapshotNode })._node = node;

      rowsById.set(node.id, row);
      li.append(row);
      if (node.children.length > 0) li.append(buildTree(doc, node.children));
      ul.append(li);
    }
    return ul;
  }

  return {
    name: 'structure-view',

    setup(context) {
      ctx = context;
      const doc = context.ownerDocument;

      // Toolbar toggle.
      toggleButton = doc.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'bpp-btn';
      toggleButton.textContent = '⌗';
      toggleButton.title = `Toggle ${label.toLowerCase()} panel`;
      toggleButton.setAttribute('aria-label', `Toggle ${label} panel`);
      toggleButton.setAttribute('aria-pressed', 'false');
      toggleButton.addEventListener('click', () => setVisible(!visible));
      context.addToolbarItem(toggleButton);

      // Side panel shell.
      panelEl = doc.createElement('div');
      panelEl.className = 'bpp-tree-host';
      panel = context.addSidePanel({ id: 'structure', label, element: panelEl });

      return () => {
        ctx = null;
        panel = null;
        panelEl = null;
        toggleButton = null;
      };
    },

    load(context: PreviewerLoadContext) {
      ctx = context;
      rowsById.clear();
      highlights = [];
      selectedId = null;
      if (!panelEl) return;

      if (!context.snapshot) {
        panelEl.textContent = 'No structure data for this document.';
        setVisible(false);
        return;
      }

      const doc = context.ownerDocument;
      const tree = doc.createElement('ul');
      tree.className = 'bpp-tree';
      tree.setAttribute('role', 'tree');
      tree.setAttribute('aria-label', label);
      // Root is the Document; show its children (Pages) at the top level.
      tree.append(buildTree(doc, [context.snapshot.root]));
      panelEl.replaceChildren(tree);

      if (openByDefault) setVisible(true);
    },

    sync({ scale }) {
      for (const h of highlights) position(h.element, h.rect, scale);
    },

    teardown() {
      clearHighlights();
      rowsById.clear();
      selectedId = null;
    },
  };
}
