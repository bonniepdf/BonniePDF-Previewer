// An ES module consumer of every public entry point, typechecked against dist/.
import { createPreviewer, complianceView, structureView, svgStringsToPages } from '@bonniepdf/previewer';
import { BonniePdfPreviewerElement, defineBonniePdfPreviewer } from '@bonniepdf/previewer/element';

export const surface = [createPreviewer, complianceView, structureView, svgStringsToPages, BonniePdfPreviewerElement, defineBonniePdfPreviewer];
