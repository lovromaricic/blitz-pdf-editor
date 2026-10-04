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
