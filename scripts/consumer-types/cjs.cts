// A CommonJS consumer of every public entry point, typechecked against dist/.
// `.cts` makes it CommonJS, so these imports resolve through the `require`
// conditions to the `.d.cts` declarations.
import { createPreviewer, complianceView, structureView, svgStringsToPages } from '@bonniepdf/previewer';
import { BonniePdfPreviewerElement, defineBonniePdfPreviewer } from '@bonniepdf/previewer/element';

export const surface = [createPreviewer, complianceView, structureView, svgStringsToPages, BonniePdfPreviewerElement, defineBonniePdfPreviewer];
