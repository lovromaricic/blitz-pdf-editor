// Top-level app state. In memory only: nothing is persisted, by design.
import type { EditorDocument } from './document.svelte';
import type { RejectedFile } from './files';
import { releaseImages } from './image-store';

export const app = $state({
  doc: null as EditorDocument | null,
  /** Files that failed to open alongside ones that succeeded, shown in the editor. */
  openWarnings: [] as RejectedFile[],
  /**
   * The landing screen's opening transition is still playing: Home stays on top
   * (the editor may already be mounted underneath) until the page fills the window.
   */
  landingHold: false,
});

export function setDocument(doc: EditorDocument, warnings: RejectedFile[] = []) {
  const previous = app.doc;
  app.doc = doc;
  app.openWarnings = warnings;
  if (previous && previous !== doc) {
    // Inserted images belong to the closed document.
    releaseImages();
    void previous.destroy();
  }
}

export function closeDocument() {
  const previous = app.doc;
  app.doc = null;
  app.openWarnings = [];
  releaseImages();
  void previous?.destroy();
}
