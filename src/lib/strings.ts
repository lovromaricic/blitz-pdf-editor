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
