// User-facing text of the landing screen, in one place so a translation
// (Croatian first) can be added later. The app name itself lives in config.ts.
export const HOME_STRINGS = {
  headline: 'Edit PDFs at the speed of light.',
  dropLine: 'Drop a PDF or images anywhere on this page.',
  dropLineCharged: 'Release to open',
  chargedAnnouncement: 'Release to open your files',
  chooseFiles: 'Choose files',
  opening: 'Opening…',
  unsupported: "That file type isn't supported. Try a PDF, JPG or PNG.",
  couldNotOpenOne: 'This file could not be opened',
  couldNotOpenMany: 'These files could not be opened',
} as const;

/** Flatten / lock form (Tools menu, Fill form panel). */
export const FLATTEN_STRINGS = {
  command: 'Flatten / lock form…',
  title: 'Flatten / lock form',
  message: 'This makes your answers permanent in the saved file, so they can no longer be edited. Your original file stays as it is.',
  confirm: 'Flatten',
  cancel: 'Cancel',
  noFields: 'This PDF has no fillable fields.',
  already: 'This form is already flattened. Undo (Ctrl+Z) brings the fields back.',
  done: 'Form flattened. Download the new copy to keep it.',
  undoLabel: 'Flatten / lock form',
  /** Suffix for the copy saved after flattening. */
  copySuffix: '-flattened',
  panelPending: 'The form is flattened: the answers will be part of the page in the copy you download. Undo with Ctrl+Z.',
  panelHint: 'Flattening locks the answers into the page, so nobody can change them later. You download it as a new copy.',
} as const;

/** Insert image (Page menu, drag and drop, paste) and the Image panel. */
export const IMAGE_STRINGS = {
  command: 'Insert image…',
  unsupported: "That image type isn't supported. Try JPG or PNG.",
  dropPdf: 'To add pages from a PDF, use Page › Insert pages from file…',
  adding: 'Adding image…',
  undoOne: 'Insert image',
  undoMany: (n: number) => `Insert ${n} images`,
  downscaled: (name: string, from: [number, number], to: [number, number]) =>
    `${name} was very large (${from[0]} × ${from[1]} px), so it was reduced to ${to[0]} × ${to[1]} px.`,
  panelTitle: 'Image',
  position: 'Position and size',
  x: 'X (mm)',
  y: 'Y (mm)',
  width: 'Width (mm)',
  height: 'Height (mm)',
  lockAspect: 'Lock aspect ratio',
  invalidNumber: 'Enter a number.',
  tooSmall: 'Too small: use at least 1 mm.',
  tooLarge: 'Too large for the page area.',
  offPage: 'That would move the image off the page.',
  rotation: 'Rotation (°)',
  resetRotation: 'Reset rotation',
  flip: 'Flip',
  flipHorizontal: 'Flip horizontal',
  flipVertical: 'Flip vertical',
  opacity: 'Opacity',
  resetSize: 'Reset size',
  delete: 'Delete',
  hint: 'Drag to move, drag a corner to resize (Alt: from the center), drag the round handle to rotate (Shift: 15° steps). Arrow keys nudge.',
} as const;

/** File › New blank PDF… */
export const NEW_PDF_STRINGS = {
  command: 'New blank PDF…',
  title: 'New blank PDF',
  pageSize: 'Page size',
  custom: 'Custom',
  width: 'Width',
  height: 'Height',
  unit: 'Unit',
  units: { mm: 'mm', in: 'in', pt: 'pt' },
  orientation: 'Orientation',
  portrait: 'Portrait',
  landscape: 'Landscape',
  pages: 'Number of pages',
  preview: (size: string) => `Page preview: ${size}`,
  create: 'Create',
  cancel: 'Cancel',
  creating: 'Creating PDF…',
  fileName: 'Untitled.pdf',
  created: (pages: number) => `New blank PDF created, ${pages} ${pages === 1 ? 'page' : 'pages'}`,
  unsavedTitle: 'Save a copy first?',
  unsavedMessage: "This document has changes that haven't been saved. They'll be lost when the new PDF opens.",
  saveCopy: 'Save a copy…',
  discard: 'Discard changes',
} as const;
