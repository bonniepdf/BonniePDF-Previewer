// Side-effecting entry: importing `@bonniepdf/previewer/element` registers the
// <bonnie-pdf-previewer> custom element. Use the main entry instead if you want
// the API without auto-registration (or to register under a custom tag name).
import { defineBonniePdfPreviewer } from './define';

defineBonniePdfPreviewer();

export { BonniePdfPreviewerElement, defineBonniePdfPreviewer } from './define';
