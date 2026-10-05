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

/** Cropping inserted images (Image panel, double-click, context menu). */
export const CROP_STRINGS = {
  crop: 'Crop',
  cropMenu: 'Crop…',
  title: 'Crop image',
  ratio: 'Aspect ratio',
  orientation: 'Orientation',
  portrait: 'Portrait',
  landscape: 'Landscape',
  reset: 'Reset crop',
  apply: 'Apply crop',
  cancel: 'Cancel',
  hint: 'Crops become permanent when you save the PDF.',
  keys: 'Drag a handle to resize, drag inside to move the image. Arrow keys move the image (Shift: 10 px), Alt+arrows resize. Enter applies, Escape cancels.',
  undo: 'Crop',
  undoReset: 'Reset crop',
  started: 'Crop mode. Arrow keys move the image, Alt+arrows resize, Enter applies, Escape cancels.',
  size: (w: number, h: number) => `Crop ${w} by ${h} pixels`,
  applied: (w: number, h: number) => `Cropped to ${w} by ${h} pixels`,
  unchanged: 'Crop unchanged',
  cancelled: 'Crop cancelled',
  resetDone: 'Crop reset: the whole image shows',
  frame: 'Crop frame',
  handle: (name: string) => `Crop handle, ${name}`,
  reduced: (n: number) =>
    n === 1
      ? 'A cropped image was too large for this device to cut at full resolution, so it was saved at a lower resolution.'
      : `${n} cropped images were too large for this device to cut at full resolution, so they were saved at a lower resolution.`,
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

/** Selecting several objects and grouping them (Group and Ungroup are in the right-click menu only). */
export const OBJECT_STRINGS = {
  group: 'Group',
  ungroup: 'Ungroup',
  onePage: 'You can only select objects on one page at a time.',
  ungroupToEdit: 'This text box is in a group. Ungroup it to edit its text.',
  textFull: (at: 'page' | 'margin') => `This text box is full: the ${at} ends here.`,
  movedBack: (n: number) => `${n === 1 ? 'An object was' : `${n} objects were`} moved back onto the page.`,
};
