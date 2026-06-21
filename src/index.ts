// @bonniepdf/previewer — framework-agnostic PDF preview component.
//
// This entry is side-effect-free: it does NOT auto-register the custom element.
// Either call `defineBonniePdfPreviewer()` yourself, or import the dedicated
// side-effecting entry `@bonniepdf/previewer/element`.

export { createPreviewer } from './controller';
export { BonniePdfPreviewerElement, defineBonniePdfPreviewer } from './define';
export { svgStringsToPages } from './types';
export type {
  PreviewPage,
  FitMode,
  PreviewerOptions,
  LoadOptions,
  PreviewerHandle,
} from './types';
