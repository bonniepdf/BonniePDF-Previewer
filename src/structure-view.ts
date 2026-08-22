// Backwards-compatible alias for the unified Accessibility inspector.

import { complianceView } from './compliance-view';
import type { PreviewerPlugin } from './types';

/** @deprecated Use `ComplianceViewOptions` with `complianceView()` instead. */
export interface StructureViewOptions {
  /** Panel header label. Defaults to `'Accessibility'`. */
  label?: string;
  /** Show the panel as soon as a snapshot loads. Defaults to `true`. */
  openByDefault?: boolean;
}

/**
 * @deprecated Use `complianceView()` instead. The accessibility inspector now
 * includes the complete layout tree, geometry, two-way selection, and document
 * source-navigation semantics formerly provided by this plugin.
 */
export function structureView(options: StructureViewOptions = {}): PreviewerPlugin {
  const plugin = complianceView({
    label: options.label,
    openByDefault: options.openByDefault,
  });
  return { ...plugin, name: 'structure-view' };
}
