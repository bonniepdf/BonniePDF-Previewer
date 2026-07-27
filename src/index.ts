// @bonniepdf/previewer — framework-agnostic PDF preview component.
//
// This entry is side-effect-free: it does NOT auto-register the custom element.
// Either call `defineBonniePdfPreviewer()` yourself, or import the dedicated
// side-effecting entry `@bonniepdf/previewer/element`.

export { createPreviewer } from './controller';
export { BonniePdfPreviewerElement, defineBonniePdfPreviewer } from './define';
export { svgStringsToPages } from './types';
export { structureView } from './structure-view';
export type { StructureViewOptions } from './structure-view';
export { complianceView } from './compliance-view';
export type { ComplianceViewOptions } from './compliance-view';
export type {
  PreviewPage,
  FitMode,
  PreviewerZoomState,
  PreviewerOptions,
  ToolbarConfig,
  LoadOptions,
  PreviewerHandle,
  PreviewerPlugin,
  PreviewerPluginContext,
  PreviewerLoadContext,
  PreviewerSyncContext,
  PreviewerViewState,
  LayoutSnapshot,
  SnapshotNode,
  SnapshotRect,
  NodeAccessibility,
  SnapshotMeta,
  ComplianceReport,
  ComplianceFinding,
  ComplianceSeverity,
} from './types';
