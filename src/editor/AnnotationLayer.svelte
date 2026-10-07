<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { capturePointer } from '../lib/dom';
  import { focusObject, focusSink } from '../lib/focus';
  import { nextBeneath } from '../lib/z-order';
  import { boxOf, clampMove, growInside, inside, newTextBoxSpan, type LimitKind } from '../lib/page-bounds';
  import { marginLabel, ptToMm } from '../lib/margins';
  import { candidates, snapBox, snapEdge, type Candidates, type Guide, type MarginLines } from '../lib/snapping';
  import { addUnits, describeUnits, isGroupId, membersOf, toggleUnit, unionBounds, unitOf, unitsTouching } from '../lib/object-selection';
  import { isMac } from '../lib/commands';
  import { suppressWordSelection } from '../lib/content-route';
  import { OBJECT_STRINGS } from '../lib/strings';
  import { ensureTextFont, metricsState } from '../lib/font-metrics-store.svelte';
  import { alignOf, lineSpacingOf, styleAvailable } from '../lib/text-format';
  import { comboFromEvent } from '../lib/commands';
  import { textStyleForCombo } from '../lib/text-shortcuts';
  // Markup on one page: draws annotations (in stacking order) and handles the markup tools
  // (Highlight, Draw, Shapes, Text, Stamp, Comment, Sign) and Select, including
  // moving, resizing and turning inserted images. Coordinates are converted between screen and PDF
  // space with the page viewport, so rotation and zoom need no special cases.
  import type { PageViewport } from 'pdfjs-dist';
  import { tick, untrack } from 'svelte';
  import {
    describe,
    isBoxed,
    rgbToCss,
    NOTE_SIZE,
    rectFromUpright,
    uprightTopLeft,
    type BoxedAnnotation,
    type ImageAnnotation,
    type TextAnnotation,
    type TextParagraph,
    mergeLineRects,
    newAnnotationId,
    normRect,
    bounds,
    remap,
    round,
    simplifyPath,
    translate,
    unionRects,
    type Annotation,
    type Point,
    type Rect,
  } from '../lib/annotations';
  import { boxedGeometry, pointsAttr, screenBox, toPrimitives } from '../lib/annotation-view';
  import { frameCorners, frameToImage, imageFrame, resizeFrame, turnFrame, turnHandle, MIN_IMAGE_SIZE, type Frame } from '../lib/image-geometry';
  import { cssFamily, loadFonts, resolveStyle, TEXT_PADDING } from '../lib/fonts';
  import { boxHeight } from '../lib/text-box-layout';
  import { DEFAULT_TEXT_WIDTH, layoutText, makeStamp, topLeftForCenter } from '../lib/text-layout';
  import { normalize, paragraphsOf, plainText, runsOf } from '../lib/text-rich';
  import BoxedView from './BoxedView.svelte';
  import CropOverlay from './CropOverlay.svelte';
  import { useActions } from '../lib/actions.svelte';
  import type { PageRef } from '../lib/document.svelte';
  import { useViewer } from '../lib/viewer.svelte';

  let { page, viewport }: { page: PageRef; viewport: PageViewport } = $props();

  const viewer = useViewer();
  const actions = useActions();

  let ui: SVGSVGElement;

  const toScreen = (p: Point): Point => viewport.convertToViewportPoint(p[0], p[1]) as Point;
  const toPdf = (x: number, y: number): Point => {
    const [px, py] = viewport.convertToPdfPoint(x, y);
    return [round(px), round(py)];
  };
  function clientToPdf(clientX: number, clientY: number): Point {
    const r = ui.getBoundingClientRect();
    return toPdf(clientX - r.left, clientY - r.top);
  }

  /** Being drawn right now (not yet in the document). */
  let draft = $state<Annotation | null>(null);
  /** Live geometry of the selected annotation while it's moved or resized. */
  let preview = $state<Annotation | null>(null);
  /** Live geometry of several selected objects (or a group) while they're moved together. */
  let blockPreview = $state.raw<Map<string, Annotation> | null>(null);

  const annots = $derived((page.annots ?? []).map((a) => (preview && a.id === preview.id ? preview : (blockPreview?.get(a.id) ?? a))));
  /** In stacking order: the list order is the order on the page, bottom first, whatever the kind. */
  /**
   * What's on the page, in stacking order. A text box being typed in is drawn
   * from its live draft (laid out as you type), so the editor shows exactly
   * the rendered box: nothing moves when editing starts or ends.
   */
  const all = $derived.by(() => {
    let list: Annotation[] = annots;
    const d = editDraft;
    if (d) list = list.some((a) => a.id === d.id) ? list.map((a) => (a.id === d.id ? d : a)) : [...list, d];
    return draft ? [...list, draft] : list;
  });
  const pageRotation = $derived(viewer.doc.totalRotation(page));
  /** The page as shown (crop applied), in this layer's px: images can't be dragged entirely outside it. */
  const pageArea = $derived.by((): Rect => {
    const crop = viewer.doc.displayedCrop(page);
    const size = viewer.doc.displaySize(page);
    const s = viewer.scale;
    return [crop.left * s, crop.top * s, (crop.left + size.width) * s, (crop.top + size.height) * s];
  });
  const selectedId = $derived(viewer.selectedAnnot?.pageId === page.id ? viewer.selectedAnnot.id : null);
  const selected = $derived(annots.find((a) => a.id === selectedId) ?? null);
  /** Selected units (objects or whole groups) on this page, and their objects. */
  const selUnits = $derived(viewer.objectSelection?.pageId === page.id ? viewer.objectSelection.ids : []);
  const selMembers = $derived(membersOf(annots, selUnits));
  const isSelected = (a: Annotation) => selUnits.includes(unitOf(a));
  /** The page as shown, in PDF space (crop applied): added objects never leave it (zoom doesn't matter). */
  const pagePdf = $derived(viewer.doc.pageBounds(page));
  /** A point kept on the page, `inset` from its edges (a stroke's half width). */
  const onPage = (p: Point, inset = 0): Point => [
    Math.min(Math.max(p[0], pagePdf[0] + inset), pagePdf[2] - inset),
    Math.min(Math.max(p[1], pagePdf[1] + inset), pagePdf[3] - inset),
  ];
  /** Our own objects can be selected, moved and edited (Select; also Edit content, where they take precedence over the PDF's own content). */
  const selecting = $derived(viewer.tool === 'select' || viewer.tool === 'content');
  /** Crop mode for an image on this page: the overlay replaces the object meanwhile. */
  const cropping = $derived(viewer.imageCrop?.pageId === page.id ? viewer.imageCrop : null);
  const placing = $derived(['text', 'stamp', 'comment', 'sign'].includes(viewer.tool));
  const capturing = $derived(viewer.tool === 'draw' || viewer.tool === 'shapes' || placing);

  // --- Draw and Shapes ------------------------------------------------------

  let drawing: { pointerId: number; start: Point; raw: Point[] } | null = null;

  /** Touch points on this page: a second finger means pinch/pan, not drawing. */
  const touches = new Set<number>();

  function cancelDrawing() {
    drawing = null;
    draft = null;
  }

  function onCaptureDown(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touches.add(e.pointerId);
      if (touches.size > 1) return cancelDrawing();
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (placing) {
      void place(clientToPdf(e.clientX, e.clientY));
      return;
    }
    capturePointer(e.currentTarget as Element, e.pointerId);
    const shapeT = viewer.toolProps.shapes;
    const closedNoOutline = shapeT.noOutline && (shapeT.shape === 'rect' || shapeT.shape === 'ellipse');
    const half = viewer.tool === 'draw' ? viewer.toolProps.draw.width / 2 : closedNoOutline ? 0 : shapeT.width / 2;
    const start = onPage(clientToPdf(e.clientX, e.clientY), half);
    drawing = { pointerId: e.pointerId, start, raw: [start] };
    viewer.selectAnnot(null);
    if (viewer.tool === 'draw') {
      // Snapshot: annotations must be plain data, not live links to the tool settings.
      const t = $state.snapshot(viewer.toolProps.draw);
      draft = { id: newAnnotationId(), type: 'ink', color: t.color, opacity: t.opacity, width: t.width, paths: [[start]] };
    } else {
      const t = $state.snapshot(viewer.toolProps.shapes);
      draft = { id: newAnnotationId(), type: 'shape', shape: t.shape, color: t.color, fill: t.fill, width: t.width, opacity: t.opacity, from: start, to: start };
      // Lines and arrows always have their outline; closed shapes take the tool's "no outline".
      if (closedNoOutline) draft = { ...draft, noOutline: true };
    }
  }

  function onCaptureMove(e: PointerEvent) {
    if (!drawing || e.pointerId !== drawing.pointerId || !draft) return;
    if (draft.type === 'ink') {
      const events = e.getCoalescedEvents?.() ?? [e];
      // Strokes stay on the page (the pointer may go past its edge).
      for (const ev of events.length ? events : [e]) drawing.raw.push(onPage(clientToPdf(ev.clientX, ev.clientY), draft.width / 2));
      draft = { ...draft, paths: [simplifyPath(drawing.raw, 0.6 / viewer.zoom)] };
    } else if (draft.type === 'shape') {
      draft = { ...draft, to: onPage(constrain(draft.shape, drawing.start, clientToPdf(e.clientX, e.clientY), e.shiftKey), draft.noOutline ? 0 : draft.width / 2) };
    }
  }

  function onCaptureUp(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (!drawing || e.pointerId !== drawing.pointerId) return;
    const done = draft;
    drawing = null;
    draft = null;
    if (!done) return;
    if (done.type === 'shape' && Math.hypot(done.to[0] - done.from[0], done.to[1] - done.from[1]) < 3) return;
    actions.addAnnotation(page.id, done);
  }

  /** Shift: squares and circles, and lines snapped to 45°. */
  function constrain(shape: string, from: Point, to: Point, shift: boolean): Point {
    if (!shift) return to;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    if (shape === 'rect' || shape === 'ellipse') {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      return [round(from[0] + Math.sign(dx || 1) * d), round(from[1] + Math.sign(dy || 1) * d)];
    }
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [round(from[0] + len * Math.cos(angle)), round(from[1] + len * Math.sin(angle))];
  }

  // --- Text, Stamp, Comment, Sign: click to place ---------------------------------

  async function place(at: Point) {
    viewer.selectAnnot(null);
    switch (viewer.tool) {
      case 'text': {
        // Clicking an existing text box edits it; anywhere else starts a new one.
        // The topmost text box there (the one you see).
        const existing = [...annots].reverse().find(
          (a): a is TextAnnotation => a.type === 'text' && at[0] >= a.rect[0] && at[0] <= a.rect[2] && at[1] >= a.rect[1] && at[1] <= a.rect[3],
        );
        if (existing?.groups) return viewer.notify(OBJECT_STRINGS.ungroupToEdit);
        if (existing) return startEdit(existing, false);
        const t = $state.snapshot(viewer.toolProps.text);
        const h = boxHeight(1, t.size, t.lineSpacing);
        // The box starts at the click, with the first line's middle on it; near the right
        // edge it's narrower (or, with too little room, moved left) so it stays on the page.
        const s = viewer.scale;
        const click = toScreen(at);
        const room = screenBoxOf(viewer.limitFor(page).rect);
        const span = newTextBoxSpan(click[0] / s, DEFAULT_TEXT_WIDTH, room[0] / s, room[2] / s);
        const shifted = topLeftForCenter(toPdf(span.x * s, click[1]), 0, h, pageRotation);
        return startEdit(
          {
            id: newAnnotationId(),
            type: 'text',
            color: t.color,
            opacity: t.opacity,
            font: t.font,
            bold: t.bold,
            italic: t.italic,
            underline: t.underline,
            strike: t.strike,
            align: t.align,
            lineSpacing: t.lineSpacing,
            background: t.background,
            size: t.size,
            text: '',
            lines: [''],
            rotate: pageRotation,
            rect: rectFromUpright(shifted, span.width, h, pageRotation),
          },
          true,
        );
      }
      case 'stamp': {
        await loadFonts();
        const t = $state.snapshot(viewer.toolProps.stamp);
        actions.addAnnotation(page.id, makeStamp(t.label, t.color, at, pageRotation));
        return;
      }
      case 'comment': {
        const note: BoxedAnnotation = {
          id: newAnnotationId(),
          type: 'note',
          color: $state.snapshot(viewer.toolProps.comment.color),
          opacity: 1,
          text: '',
          rotate: pageRotation,
          rect: rectFromUpright(topLeftForCenter(at, NOTE_SIZE, NOTE_SIZE, pageRotation), NOTE_SIZE, NOTE_SIZE, pageRotation),
        };
        actions.addAnnotation(page.id, note);
        viewer.setTool('select');
        viewer.selectAnnot({ pageId: page.id, id: note.id });
        viewer.focusNoteText = true;
        return;
      }
      case 'sign': {
        const sig = viewer.signature;
        if (!sig) {
          viewer.signatureDialog = true;
          return;
        }
        const w = 150;
        const h = (w * sig.height) / sig.width;
        const image: BoxedAnnotation = {
          id: newAnnotationId(),
          type: 'image',
          role: 'signature',
          color: [0, 0, 0],
          opacity: 1,
          dataUrl: sig.dataUrl,
          rotate: pageRotation,
          rect: rectFromUpright(topLeftForCenter(at, w, h, pageRotation), w, h, pageRotation),
        };
        actions.addAnnotation(page.id, image);
        viewer.setTool('select');
        viewer.selectAnnot({ pageId: page.id, id: image.id });
        return;
      }
    }
  }

  // Editing a text box in place.
  /**
   * The text box being typed in. `paragraphs` is what the editing surface
   * holds (null until the first change: the box is drawn exactly as saved).
   */
  // Raw: the paragraphs keep their identity (a deep proxy would make them new
  // on every change, and the layout's per-paragraph cache would never hit).
  // `box`: box settings changed from the panel while typing (part of the session's one undo step).
  let editing = $state.raw<{
    id: string;
    base: TextAnnotation;
    isNew: boolean;
    paragraphs: TextParagraph[] | null;
    text: string;
    composing: boolean;
    box: Partial<TextAnnotation>;
  } | null>(null);
  /** The editing surface, loaded with the editor the first time a box is edited. */
  const loadRichEditor = () => import('./RichTextEditor.svelte').then((m) => m.default);

  /** The saved box being edited (its box settings can change from the panel while typing). */
  const savedEditing = $derived.by(() => {
    const id = editing?.id;
    const a = id ? page.annots?.find((x) => x.id === id) : undefined;
    return a?.type === 'text' ? a : undefined;
  });

  /** What's drawn while typing: the box settings, with the surface's content laid out by the shared layout. */
  const editDraft = $derived.by((): TextAnnotation | null => {
    if (!editing) return null;
    const box = { ...(savedEditing ?? editing.base), ...editing.box };
    if (!editing.paragraphs) return box;
    void metricsState.version;
    return growOnPage(layoutText({ ...box, paragraphs: editing.paragraphs, text: editing.text })).annot;
  });

  /**
   * A text box grown by typing stays on the page: past the bottom edge it moves
   * up (as far as the page top allows). `fits` is false when even that isn't
   * enough: the change that made it grow is refused (RichTextEditor `fits`).
   */
  function growOnPage(a: TextAnnotation): { annot: TextAnnotation; fits: boolean } {
    const b = bounds(a);
    // The limit (page, or margin) from where the box was when typing started.
    // (Text taken over from the PDF keeps to the page only: it was placed by the PDF, not inside our margins.)
    const lim = viewer.limitFor(page, editing ? bounds(editing.base) : null, { ignoreMargin: !!(editing?.base as TextAnnotation | undefined)?.fromPdf });
    fullAt = lim.kind;
    const g = growInside(screenBoxOf(b), screenBoxOf(lim.rect));
    if (!g.dy) return { annot: a, fits: g.fits };
    const o = toPdf(0, 0);
    const d = toPdf(0, g.dy);
    return { annot: translate(a, d[0] - o[0], d[1] - o[1]) as TextAnnotation, fits: g.fits };
  }

  /** What ended the box being typed in: the page, or the margin (for the "box is full" message). */
  let fullAt: LimitKind = 'page';

  /** Would the box being typed in still fit on the page with this content (and these box settings)? */
  function editFits(paragraphs: TextParagraph[], box: Partial<TextAnnotation>) {
    if (!editing) return true;
    const base = { ...(savedEditing ?? editing.base), ...box };
    return growOnPage(layoutText({ ...base, paragraphs, text: plainText(paragraphs) })).fits;
  }

  async function startEdit(a: TextAnnotation, isNew: boolean) {
    await commitEdit();
    await Promise.all([loadFonts(), ...[...new Set(runsOf(a).map((r) => r.font))].map(ensureTextFont), loadRichEditor()]);
    editing = { id: a.id, base: a, isNew, paragraphs: null, text: a.text, composing: false, box: {} };
    // The box stays selected while it's typed in: the panel (chosen from the selection) stays Text.
    if (!isNew) viewer.selectAnnot({ pageId: page.id, id: a.id });
  }

  /** Remove white space and empty paragraphs at the very end (like the plain text field did). */
  function trimEnd(paragraphs: TextParagraph[]): TextParagraph[] {
    const out = normalize(paragraphs);
    while (out.length > 1 && !out[out.length - 1].runs.some((r) => r.text)) out.pop();
    const last = out[out.length - 1];
    const runs = [...last.runs];
    while (runs.length > 1 && !runs[runs.length - 1].text.trim()) runs.pop();
    runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text.replace(/\s+$/, '') };
    out[out.length - 1] = { ...last, runs };
    return out;
  }

  /** Finish editing: one undo step for the whole session (or nothing, if nothing changed). */
  async function commitEdit() {
    const e = editing;
    if (!e) return;
    const saved = savedEditing;
    editing = null;
    viewer.textEditor = null;
    const boxChanged = Object.keys(e.box).length > 0;
    // Text just converted from the PDF: its first session decides whether the conversion stays.
    const converting = actions.isConverting(e.id);
    if (!e.paragraphs && !boxChanged) {
      if (converting) actions.endConversion('unchanged');
      return; // nothing typed (a new box stays unmade)
    }
    if (!e.paragraphs && e.isNew) return;
    const paragraphs = trimEnd(e.paragraphs ?? paragraphsOf(saved ?? e.base));
    const text = plainText(paragraphs);
    if (!text.trim()) {
      if (converting) actions.endConversion(null);
      else if (!e.isNew) actions.deleteAnnotation(page.id, e.id);
      return;
    }
    const sameBox = !saved || (Object.keys(e.box) as (keyof TextAnnotation)[]).every((k) => JSON.stringify(saved[k]) === JSON.stringify(e.box[k]));
    if (!e.isNew && saved && sameBox && JSON.stringify(normalize(paragraphsOf(saved))) === JSON.stringify(paragraphs)) {
      if (converting) actions.endConversion('unchanged');
      return;
    }
    await Promise.all(paragraphs.flatMap((p) => p.runs).map((r) => ensureTextFont(r.font)));
    const laid = growOnPage(layoutText({ ...(saved ?? e.base), ...e.box, paragraphs, text })).annot;
    if (e.isNew) actions.addAnnotation(page.id, laid);
    else if (converting) actions.endConversion(laid);
    else actions.updateAnnotation(page.id, laid, 'Edit text');
  }

  // Requests to edit a box on this page (converted original text): open the editor on it.
  let pendingCaret: [number, number] | null = null;
  $effect(() => {
    const r = viewer.editRequest;
    if (!r || r.pageId !== page.id) return;
    const a = (page.annots ?? []).find((x) => x.id === r.id);
    if (!a || a.type !== 'text') return;
    untrack(() => {
      viewer.editRequest = null;
      pendingCaret = r.caret ?? null;
      void startEdit(a, false);
    });
  });

  /** The edit surface covers the box exactly: same center, size and turn as BoxedView draws it. */
  const editGeom = $derived(editDraft ? boxedGeometry(editDraft, toScreen, viewer.scale, pageRotation) : null);

  // A click outside the box (and outside the panel and its popups) finishes the edit.
  $effect(() => {
    if (!editing) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Element | null;
      // Menus too: a menu command that isn't about the text finishes the edit itself (Editor.svelte).
      if (t?.closest('.rich-editor, .rich-editor-popover, .panel, dialog, [role="dialog"], [role="listbox"], [role="menubar"], [role="menu"]')) return;
      void commitEdit();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  // Leaving the Text tool (or the page) finishes the edit.
  $effect(() => {
    if (viewer.tool !== 'text' && viewer.tool !== 'select' && viewer.tool !== 'content') void commitEdit();
  });

  // --- Highlight --------------------------------------------------------------

  // Text: select text normally, the highlight is made when the mouse is released.
  // No text under the pointer (e.g. a scan): drag a rectangle instead.
  $effect(() => {
    if (viewer.tool !== 'highlight') return;
    const host = ui.parentElement!;
    let area: { pointerId: number; start: Point } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.add(e.pointerId);
        if (touches.size > 1) {
          area = null;
          draft = null;
          return;
        }
      }
      if (e.button !== 0) return;
      const target = e.target as Element;
      // Mouse on text: normal text selection. Touch always drags (and snaps to text).
      if (e.pointerType !== 'touch' && target.closest('.textLayer span')) return;
      e.preventDefault();
      capturePointer(host, e.pointerId);
      const start = clientToPdf(e.clientX, e.clientY);
      area = { pointerId: e.pointerId, start };
      draft = newHighlight([normRect(start, start)]);
    };
    const onMove = (e: PointerEvent) => {
      if (!area || e.pointerId !== area.pointerId || !draft || draft.type !== 'highlight') return;
      draft = { ...draft, rects: [normRect(area.start, clientToPdf(e.clientX, e.clientY))] };
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (area && e.pointerId === area.pointerId) {
        const done = draft;
        const start = area.start;
        area = null;
        draft = null;
        if (done?.type === 'highlight') {
          const end = clientToPdf(e.clientX, e.clientY);
          // Over text: highlight the text lines between start and end. Elsewhere (scans): the box.
          const snapped = snapToText(host, start, end);
          if (snapped) actions.addAnnotation(page.id, newHighlight(snapped));
          else {
            const r = done.rects[0];
            if (r[2] - r[0] > 3 && r[3] - r[1] > 3) actions.addAnnotation(page.id, done);
          }
        }
        return;
      }
      highlightSelection(host);
    };
    // Touch: one finger highlights instead of scrolling (two fingers still pan and zoom).
    const previousTouchAction = host.style.touchAction;
    host.style.touchAction = 'none';
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      host.style.touchAction = previousTouchAction;
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  /**
   * Text lines covered by a drag from `start` to `end` (PDF space), like a text
   * selection: the first line from the start point, the last up to the end
   * point, full lines between. Null if the drag doesn't touch any text.
   */
  function snapToText(host: HTMLElement, start: Point, end: Point): Rect[] | null {
    const textLayer = host.querySelector('.textLayer');
    if (!textLayer) return null;
    const lines = mergeLineRects(
      Array.from(textLayer.querySelectorAll('span'))
        .map((s) => s.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => normRect(clientToPdf(r.left, r.top), clientToPdf(r.right, r.bottom))),
    ).sort((a, b) => b[3] - a[3]); // top to bottom
    const [top, bottom] = start[1] >= end[1] ? [start, end] : [end, start];
    const hit = lines.filter((l) => l[3] >= bottom[1] && l[1] <= top[1]);
    if (hit.length === 0) return null;
    if (hit.length === 1) {
      const [x1, x2] = [Math.min(start[0], end[0]), Math.max(start[0], end[0])];
      const l = hit[0];
      const r: Rect = [Math.max(l[0], x1), l[1], Math.min(l[2], x2), l[3]];
      return r[2] - r[0] > 2 ? [r] : null;
    }
    return hit
      .map((l, i): Rect => {
        if (i === 0) return [Math.max(l[0], top[0]), l[1], l[2], l[3]];
        if (i === hit.length - 1) return [l[0], l[1], Math.min(l[2], bottom[0]), l[3]];
        return l;
      })
      .filter((r) => r[2] - r[0] > 2);
  }

  function newHighlight(rects: Rect[]): Annotation {
    const t = $state.snapshot(viewer.toolProps.highlight);
    return { id: newAnnotationId(), type: 'highlight', color: t.color, opacity: t.opacity, rects };
  }

  /** Turn the current text selection (the part on this page) into a highlight. */
  function highlightSelection(host: HTMLElement) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const textLayer = host.querySelector('.textLayer');
    const range = sel.getRangeAt(0);
    if (!textLayer || !range.intersectsNode(textLayer)) return;

    const box = ui.getBoundingClientRect();
    const toPdfRect = (r: DOMRect): Rect => normRect(clientToPdf(r.left, r.top), clientToPdf(r.right, r.bottom));
    const inPage = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;

    let rects = mergeLineRects(Array.from(range.getClientRects()).filter(inPage).map(toPdfRect));
    if (rects.length === 0) return;
    if (viewer.toolProps.highlight.wholeLine) {
      // Stretch each line to the full extent of the text on that line.
      const spans = Array.from(textLayer.querySelectorAll('span'))
        .map((s) => s.getBoundingClientRect())
        .filter(inPage)
        .map(toPdfRect);
      rects = rects.map((line) => {
        const onLine = spans.filter((s) => Math.min(s[3], line[3]) - Math.max(s[1], line[1]) > 0.5 * Math.min(s[3] - s[1], line[3] - line[1]));
        return onLine.length ? unionRects([line, ...onLine]) : line;
      });
    }
    actions.addAnnotation(page.id, newHighlight(rects));
    // Other pages read the same selection during this event; clear it afterwards.
    setTimeout(() => window.getSelection()?.removeAllRanges());
  }

  // --- Select, move, resize -------------------------------------------------------

  type Reshape = (p: Point, e: PointerEvent) => Annotation;

  let moving: {
    pointerId: number;
    start: Point;
    /** The pointer in this layer's px, for images (moved in screen space so they can be kept on the page). */
    startLocal: Point;
    original: Annotation;
    moved: boolean;
    resize?: Reshape;
    label?: string;
    /** Snapping: the lines that may pull (collected once, at the start), and the object's box on screen then. */
    snap: { cands: Candidates; box: Rect } | null;
    /** Where it may go (the page, or the margin), from where it started. */
    limit: { rect: Rect; kind: LimitKind };
  } | null = null;

  // --- Snapping (smart guides and margins) ---------------------------------------------

  /** Guide lines while an object is snapped (screen px), gone when the drag ends. */
  let guides = $state.raw<Guide[]>([]);
  let lastGuideNotice = 0;

  /** An object's (or block's) box in this layer's px. */
  const screenBoxOf = (r: Rect) => screenBox([toScreen([r[0], r[1]]), toScreen([r[2], r[3]])]);

  /** The margin on this page (points) while the guides show: the margin, or the value being typed in View › Margin size. */
  const guideMargin = $derived(viewer.guideMarginOn(page));

  /** The margin lines on this page (screen px), when shown. */
  const marginLines = $derived.by((): MarginLines | null => {
    if (guideMargin === null) return null;
    const m = guideMargin * viewer.scale;
    return { left: pageArea[0] + m, right: pageArea[2] - m, top: pageArea[1] + m, bottom: pageArea[3] - m };
  });

  /**
   * The lines that may pull a drag, collected once when it starts: margins (when
   * shown), the page center and the other objects near the visible part of the
   * page (with smart guides). Nothing at all when both are off.
   */
  function snapCandidates(moving: ReadonlySet<string>): Candidates | null {
    if (!marginLines && !viewer.smartGuides) return null;
    let others: { box: Rect; label: string }[] = [];
    if (viewer.smartGuides) {
      const r = ui.getBoundingClientRect();
      const v = document.getElementById('document-view')?.getBoundingClientRect();
      const near: Rect = v ? [v.left - r.left - 200, v.top - r.top - 200, v.right - r.left + 200, v.bottom - r.top + 200] : [-Infinity, -Infinity, Infinity, Infinity];
      others = annots
        .filter((a) => !moving.has(a.id))
        .map((a) => ({ box: screenBoxOf(bounds(a)), label: describe(a) }))
        .filter((o) => o.box[2] >= near[0] && o.box[0] <= near[2] && o.box[3] >= near[1] && o.box[1] <= near[3]);
    }
    return candidates({ page: pageArea, margins: marginLines, smart: viewer.smartGuides, others });
  }

  /** Where the dragged object is (screen px), so guide labels keep clear of it. */
  let dragBox = $state.raw<Rect | null>(null);

  /**
   * A small label beside each guide line, saying what it matched: near the top
   * of a vertical line, the left end of a horizontal one; left out where it
   * would cover the object being dragged (or another label).
   */
  const guideLabels = $derived.by(() => {
    const out: { x: number; y: number; text: string }[] = [];
    const taken: Rect[] = dragBox ? [dragBox] : [];
    for (const g of guides) {
      const w = g.label.length * 6;
      const x = g.axis === 'x' ? g.at + 4 : pageArea[0] + 4;
      const y = g.axis === 'x' ? pageArea[1] + 14 : g.at - 4;
      const r: Rect = [x, y - 11, x + w, y + 2];
      if (taken.some((t) => r[0] < t[2] && t[0] < r[2] && r[1] < t[3] && t[1] < r[3])) continue;
      taken.push(r);
      out.push({ x, y, text: g.label });
    }
    return out;
  });

  /** Show the guides and say what was matched (at most once a second). */
  function showGuides(next: Guide[], box: Rect | null = null) {
    guides = next;
    dragBox = next.length ? box : null;
    const now = Date.now();
    if (next.length && now - lastGuideNotice > 1000) {
      lastGuideNotice = now;
      viewer.announce(`Snapped: ${[...new Set(next.map((g) => g.label))].join(', ')}`);
    }
  }

  /**
   * A move (PDF space) with snapping and the limit (page edge, or margin): snap
   * first (unless Alt is held), then keep it within the limit; a snap the
   * limit would undo is dropped.
   */
  function snappedMove(snap: { cands: Candidates; box: Rect } | null, boxPdf: Rect, dxPdf: number, dyPdf: number, e: PointerEvent, limit: Rect) {
    const plain = clampMove(boxPdf, limit, dxPdf, dyPdf);
    if (!snap || e.altKey) {
      showGuides([]);
      return plain;
    }
    const o = toScreen([0, 0]);
    const d = toScreen([dxPdf, dyPdf]);
    const [sx, sy] = [d[0] - o[0], d[1] - o[1]];
    const b = snap.box;
    const r = snapBox([b[0] + sx, b[1] + sy, b[2] + sx, b[3] + sy], snap.cands);
    if (!r.guides.length) {
      showGuides([]);
      return plain;
    }
    const p0 = toPdf(0, 0);
    const p1 = toPdf(r.dx, r.dy);
    const want = [dxPdf + p1[0] - p0[0], dyPdf + p1[1] - p0[1]];
    const m = clampMove(boxPdf, limit, want[0], want[1]);
    // Snapped onto the limit itself (a margin line), rounding may overshoot it by a hair: that's still the snap.
    const hair = 0.5 / viewer.scale;
    if (m.limited && Math.abs(m.dx - want[0]) <= hair && Math.abs(m.dy - want[1]) <= hair) {
      showGuides(r.guides, [b[0] + sx + r.dx, b[1] + sy + r.dy, b[2] + sx + r.dx, b[3] + sy + r.dy]);
      return { ...m, limited: false };
    }
    if (m.limited) {
      showGuides([]);
      return plain;
    }
    showGuides(r.guides, [b[0] + sx + r.dx, b[1] + sy + r.dy, b[2] + sx + r.dx, b[3] + sy + r.dy]);
    return m;
  }

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const r = ui.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pdfAt = (x: number, y: number) => toPdf(x, y);
  const frameOf = (a: ImageAnnotation) => imageFrame(a, toScreen, viewer.scale, pageRotation);
  const fromFrame = (a: ImageAnnotation, f: Frame) => frameToImage(a, f, pdfAt, viewer.scale, pageRotation);

  // The panel shows the selected object's size and position live while it's dragged.
  $effect(() => {
    const live = preview && preview.id === selectedId ? preview : null;
    untrack(() => {
      if (live) viewer.livePreview = live;
      else if (viewer.livePreview && (page.annots ?? []).some((a) => a.id === viewer.livePreview!.id)) viewer.livePreview = null;
    });
  });

  /** Select what a click on this object selects: the object, or its (outermost) group. */
  function select(a: Annotation) {
    viewer.selectObjects({ pageId: page.id, ids: [unitOf(a)] });
  }

  function announceSelection() {
    const sel = viewer.objectSelection;
    if (!sel) viewer.announce('Selection cleared');
    else viewer.announce(`${describeUnits(viewer.doc.pages.find((p) => p.id === sel.pageId)?.annots ?? [], sel.ids, true)} selected`);
  }

  /** Shift or Cmd/Ctrl+click: add the object (its unit) to the selection, or take it out. One page at a time. */
  function toggleSelect(a: Annotation) {
    const r = toggleUnit(viewer.objectSelection, page.id, unitOf(a));
    if ('otherPage' in r) {
      viewer.notify(OBJECT_STRINGS.onePage);
      return;
    }
    viewer.selectObjects(r.selection);
    announceSelection();
    if (r.selection?.ids.includes(unitOf(a))) focusObject(a.id);
  }

  /**
   * Move several objects (a multi-selection or a group) together; the whole
   * block stays on the page. A click without a drag on one of several selected
   * objects selects just that one (`clicked`), as usual.
   */
  function startBlockDrag(e: PointerEvent, ids: readonly string[], clicked?: string, noSnap = false) {
    const members = membersOf(annots, ids);
    const box = boxOf(members);
    if (!box) return;
    const cands = noSnap ? null : snapCandidates(new Set(members.map((a) => a.id)));
    const snap = cands ? { cands, box: screenBoxOf(box) } : null;
    const limit = viewer.limitFor(page, box);
    const start = clientToPdf(e.clientX, e.clientY);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const p = clientToPdf(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p[0] - start[0], p[1] - start[1]) * viewer.scale < 3) return;
      moved = true;
      const m = snappedMove(snap, box, p[0] - start[0], p[1] - start[1], ev, limit.rect);
      if (m.limited) viewer.limitHit(page.id, limit.kind);
      blockPreview = new Map(members.map((a) => [a.id, translate(a, m.dx, m.dy)]));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      showGuides([]);
      const done = blockPreview;
      blockPreview = null;
      if (done) actions.updateAnnotations([...done.values()].map((annot) => ({ pageId: page.id, annot })), `Move ${describeUnits(annots, ids)}`);
      else if (clicked && ids.length > 1) viewer.selectObjects({ pageId: page.id, ids: [clicked] });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // --- Context menu: right-click, or a long press on touch -------------------------

  /** Open the canvas context menu for an object (selecting it) or for an empty spot of this page. */
  function openMenu(x: number, y: number, a: Annotation | null) {
    // On something already selected the menu is for the whole selection; on anything else, just for that.
    if (a && !isSelected(a)) select(a);
    viewer.contextMenu = { x, y, pageId: page.id, objectId: a?.id ?? null, point: a ? null : clientToPdf(x, y) };
  }

  function onAnnotMenu(e: MouseEvent, a: Annotation) {
    if (!selecting) return;
    e.preventDefault();
    e.stopPropagation();
    // Already open for it (a long press, then the browser's own long-press menu event).
    if (viewer.contextMenu?.objectId === a.id) return;
    openMenu(e.clientX, e.clientY, a);
  }

  const LONG_PRESS_MS = 550;
  /** A finger held still on an object opens its menu. */
  function watchLongPress(e: PointerEvent, a: Annotation) {
    const start = { x: e.clientX, y: e.clientY };
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const onMove = (m: PointerEvent) => {
      if (m.pointerId === e.pointerId && Math.hypot(m.clientX - start.x, m.clientY - start.y) > 8) stop();
    };
    const timer = setTimeout(() => {
      stop();
      openMenu(start.x, start.y, a);
    }, LONG_PRESS_MS);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  /**
   * Alt+click: select the next object beneath the pointer (repeated, it goes on
   * down and wraps around), without moving anything. So an object that's
   * completely covered can still be selected, and brought forward.
   */
  function selectBeneath(e: PointerEvent) {
    const pageEl = ui.closest('.page');
    const stack = [
      ...new Set(
        document
          .elementsFromPoint(e.clientX, e.clientY)
          .filter((el) => el.closest('.page') === pageEl)
          .map((el) => el.closest<HTMLElement | SVGElement>('[data-annot-id]')?.dataset.annotId)
          .filter((id): id is string => !!id),
      ),
    ];
    // Per unit: a group counts once, wherever its objects are.
    const units = [...new Set(stack.map((id) => annots.find((x) => x.id === id)).filter((x): x is Annotation => !!x).map(unitOf))];
    const id = nextBeneath(units, selUnits.length === 1 ? selUnits[0] : null);
    if (!id) return;
    viewer.selectObjects({ pageId: page.id, ids: [id] });
    const top = membersOf(annots, [id]).at(-1)!;
    focusObject(top.id);
    viewer.announce(`${describeUnits(annots, [id], true)} selected, ${units.indexOf(id) + 1} of ${units.length} at this point`);
  }

  /**
   * Alt (Option) on an object: a click selects the object beneath; a drag moves
   * the object with snapping off for that drag.
   */
  function altDown(e: PointerEvent, a: Annotation) {
    const start = { x: e.clientX, y: e.clientY };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      stop();
      const unit = unitOf(a);
      const inSelection = selUnits.includes(unit);
      if (!inSelection) select(a);
      if ((inSelection && selUnits.length > 1) || isGroupId(unit)) startBlockDrag(e, inSelection ? selUnits : [unit], unit, true);
      else startDrag(e, a, undefined, undefined, true);
      // The move that started it counts too.
      window.dispatchEvent(new PointerEvent('pointermove', ev));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      stop();
      selectBeneath(e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
  }

  function onAnnotDown(e: PointerEvent, a: Annotation) {
    if (!selecting || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.altKey) return altDown(e, a);
    if (e.shiftKey || (isMac ? e.metaKey : e.ctrlKey)) return toggleSelect(a);
    if (e.pointerType === 'touch') watchLongPress(e, a);
    // Part of a multi-selection, or in a group: they all move together.
    const unit = unitOf(a);
    const inSelection = selUnits.includes(unit);
    if ((inSelection && selUnits.length > 1) || isGroupId(unit)) {
      if (!inSelection) select(a);
      return startBlockDrag(e, inSelection ? selUnits : [unit], unit);
    }
    if (e.pointerType === 'touch' && a.type === 'image' && a.id === selectedId && onImageTouchDown(e, a)) return;
    select(a);
    startDrag(e, a);
  }

  function onHandleDown(e: PointerEvent, h: Handle) {
    if (!selected || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, selected, h.resize, h.label, !!h.turn);
  }

  function startDrag(e: PointerEvent, original: Annotation, resize?: Reshape, label?: string, noSnap = false) {
    const cands = noSnap ? null : snapCandidates(new Set([original.id]));
    moving = {
      pointerId: e.pointerId,
      start: clientToPdf(e.clientX, e.clientY),
      startLocal: toLocal(e),
      original,
      moved: false,
      resize,
      label,
      snap: cands ? { cands, box: screenBoxOf(bounds(original)) } : null,
      limit: viewer.limitFor(page, bounds(original)),
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onUiMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onUiUp(ev);
    };
    window.addEventListener('pointermove', onUiMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function onUiMove(e: PointerEvent) {
    if (!moving || e.pointerId !== moving.pointerId) return;
    let p = clientToPdf(e.clientX, e.clientY);
    if (!moving.moved && Math.hypot(p[0] - moving.start[0], p[1] - moving.start[1]) * viewer.scale < 3) return;
    moving.moved = true;
    const o = moving.original;
    if (moving.resize) {
      // The dragged handle snaps to margins and guides (not with Alt), then stops at the page edge:
      // past it, the object keeps its last size on the page.
      if (moving.snap && !e.altKey) {
        const ps = toScreen(p);
        const sx = snapEdge('x', ps[0], moving.snap.cands);
        const sy = snapEdge('y', ps[1], moving.snap.cands);
        const snapped = toPdf(sx.v, sy.v);
        const sized = moving.resize(snapped, e);
        if (inside(bounds(sized), moving.limit.rect)) {
          p = snapped;
          showGuides([...sx.guides, ...sy.guides], screenBoxOf(bounds(sized)));
        } else showGuides([]);
      } else showGuides([]);
      const next = moving.resize(onPage(p), e);
      if (inside(bounds(next), moving.limit.rect)) preview = next;
      else viewer.limitHit(page.id, moving.limit.kind);
    } else {
      // The whole object (a turned one by its upright box) stays on the page; it snaps first.
      const m = snappedMove(moving.snap, bounds(o), p[0] - moving.start[0], p[1] - moving.start[1], e, moving.limit.rect);
      if (m.limited) viewer.limitHit(page.id, moving.limit.kind);
      preview = translate(o, m.dx, m.dy);
    }
  }

  function onUiUp(e: PointerEvent) {
    if (!moving || e.pointerId !== moving.pointerId) return;
    showGuides([]);
    const done = preview;
    const wasResize = !!moving.resize;
    const label = moving.label;
    moving = null;
    preview = null;
    if (!done) return;
    // Text re-wraps to its new width.
    const final = done.type === 'text' && wasResize ? layoutText(done) : done;
    actions.updateAnnotation(page.id, final, label ?? `${wasResize ? 'Resize' : 'Move'} ${describe(done).toLowerCase()}`);
  }

  // --- Touch: pinch a selected image to resize it ------------------------------

  const imageTouches = new Map<number, Point>();
  let pinch: { original: ImageAnnotation; frame: Frame; d0: number; ids: number[] } | null = null;

  /** Two fingers on the selected image resize it (instead of zooming the page). */
  function onImageTouchDown(e: PointerEvent, a: ImageAnnotation) {
    imageTouches.set(e.pointerId, toLocal(e));
    if (imageTouches.size !== 2) return false;
    // The first finger had started a move: drop it.
    moving = null;
    preview = null;
    const fingers = new Map(imageTouches);
    const [p, q] = [...fingers.values()];
    pinch = { original: a, frame: frameOf(a), d0: Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, ids: [...fingers.keys()] };
    const move = (ev: PointerEvent) => {
      if (!pinch || !fingers.has(ev.pointerId)) return;
      fingers.set(ev.pointerId, toLocal(ev));
      const [m, n] = [...fingers.values()];
      const f = pinch.frame;
      const k = Math.max(MIN_IMAGE_SIZE / Math.min(f.w, f.h), Math.hypot(m[0] - n[0], m[1] - n[1]) / pinch.d0);
      const next = fromFrame(pinch.original, { ...f, w: f.w * k, h: f.h * k });
      const lim = viewer.limitFor(page, bounds(pinch.original));
      if (inside(bounds(next), lim.rect)) preview = next;
      else viewer.limitHit(page.id, lim.kind);
    };
    const up = (ev: PointerEvent) => {
      if (!pinch?.ids.includes(ev.pointerId)) return;
      imageTouches.clear();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const done = preview;
      pinch = null;
      preview = null;
      if (done) actions.updateAnnotation(page.id, done, 'Resize image');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return true;
  }

  /** Keep the page from zooming while two fingers are on the selected image. */
  function holdPagePinch(node: HTMLElement) {
    const stop = (e: TouchEvent) => {
      if (node.classList.contains('selected') && node.dataset.kind === 'image') e.stopPropagation();
    };
    const forget = (e: PointerEvent) => imageTouches.delete(e.pointerId);
    node.addEventListener('touchstart', stop, { passive: true });
    node.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('pointerup', forget);
    window.addEventListener('pointercancel', forget);
    return () => {
      node.removeEventListener('touchstart', stop);
      node.removeEventListener('touchmove', stop);
      window.removeEventListener('pointerup', forget);
      window.removeEventListener('pointercancel', forget);
    };
  }

  // Clicking the page outside any annotation deselects (Select tool; Edit content handles its own clicks).
  $effect(() => {
    if (viewer.tool !== 'select') return;
    const host = ui.parentElement!;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      // The text being edited isn't "outside" (its box stays selected while typing).
      if (t.closest('.annot, .handle, .rich-editor') || e.button !== 0) return;
      if (!e.shiftKey && viewer.objectSelection?.pageId === page.id) viewer.selectObjects(null);
      // A mouse drag from blank paper draws a selection rectangle. (Fingers scroll; a drag
      // that starts on the PDF's own text selects that text, as before.)
      if (e.pointerType !== 'touch' && !t.closest('.textLayer span')) startMarquee(e, e.shiftKey);
    };
    // Right-click on an empty spot: the page's menu ("Paste here"). Not over text
    // selected in the PDF (the browser's own menu copies it), nor in a text box being typed in.
    const onMenu = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest('.annot, .handle, .rich-editor')) return;
      const sel = window.getSelection();
      if (t.closest('.textLayer') && sel && !sel.isCollapsed && sel.containsNode(t, true)) return;
      e.preventDefault();
      openMenu(e.clientX, e.clientY, null);
    };
    // Double-click (or double-tap) on the PDF's own content: Edit content at that point.
    // Our objects handle their own double-click (a text box edits, an image crops).
    const own = (t: Element) => !!t.closest(OWN_TARGETS);
    // A double-tap the browser also reports as a dblclick opens once: the dblclick right after it is skipped.
    let tapOpened = -Infinity;
    const openAt = (x: number, y: number) => {
      window.getSelection()?.removeAllRanges();
      void actions.enterContentEditing({ pageId: page.id, point: clientToPdf(x, y), caret: [x, y], edit: true, byDoubleClick: true });
    };
    const onDbl = (e: MouseEvent) => {
      if (e.button !== 0 || own(e.target as Element) || performance.now() - tapOpened < 500) return;
      openAt(e.clientX, e.clientY);
    };
    let lastTap: { t: number; x: number; y: number } | null = null;
    const onTapUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || own(e.target as Element)) return;
      const now = performance.now();
      if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
        lastTap = null;
        tapOpened = now;
        openAt(e.clientX, e.clientY);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    // The second press of a double-click on the PDF's text would select a word first: not here.
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (suppressWordSelection({ detail: e.detail, button: e.button, tool: viewer.tool, onOriginalText: !!t.closest('.textLayer'), onOwnObject: own(t) })) e.preventDefault();
    };
    // A drag that starts on the gray background next to this page draws the marquee here.
    viewer.marquees.set(page.id, (e, add) => startMarquee(e, add));
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('contextmenu', onMenu);
    host.addEventListener('dblclick', onDbl);
    host.addEventListener('pointerup', onTapUp);
    host.addEventListener('mousedown', onMouseDown);
    return () => {
      viewer.marquees.delete(page.id);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('contextmenu', onMenu);
      host.removeEventListener('dblclick', onDbl);
      host.removeEventListener('pointerup', onTapUp);
      host.removeEventListener('mousedown', onMouseDown);
    };
  });

  /** Our own objects and their editing surfaces: double-clicks there are theirs. */
  const OWN_TARGETS = '.annot, .handle, .rich-editor, .crop-mode, .content-layer, input, textarea, select, button, [contenteditable]';

  // --- Marquee: drag on an empty spot to select every object it touches -----------------

  let marquee = $state.raw<{ start: Point; end: Point } | null>(null);

  function startMarquee(e: PointerEvent, add: boolean) {
    const start = toLocal(e);
    let active = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const end = toLocal(ev);
      if (!active && Math.hypot(end[0] - start[0], end[1] - start[1]) < 4) return;
      active = true;
      window.getSelection()?.removeAllRanges();
      marquee = { start, end };
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const m = marquee;
      marquee = null;
      if (!m) return;
      const hits = unitsTouching(annots, normRect(toPdf(m.start[0], m.start[1]), toPdf(m.end[0], m.end[1])));
      // Nothing touched: the selection stays cleared (as a plain click on the page does).
      const next = add ? addUnits(viewer.objectSelection, page.id, hits) : hits.length ? { pageId: page.id, ids: hits } : null;
      if (add && viewer.objectSelection && viewer.objectSelection.pageId !== page.id && hits.length) {
        viewer.notify(OBJECT_STRINGS.onePage);
        return;
      }
      viewer.selectObjects(next);
      if (hits.length || add) announceSelection();
      const top = next ? membersOf(annots, next.ids).at(-1) : undefined;
      if (top) focusObject(top.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** A multi-selection or a group: one dashed box around it all, each object lightly outlined. */
  const blockOutline = $derived.by(() => {
    if (selected || !selMembers.length) return null;
    const boxOf = (r: Rect) => screenBox([toScreen([r[0], r[1]]), toScreen([r[2], r[3]])]);
    const all = boxOf(unionBounds(selMembers)!);
    // Inside the real bounds, like a single object's frame.
    return { all: [all[0] + 0.75, all[1] + 0.75, all[2] - 0.75, all[3] - 0.75], parts: selMembers.map((a) => boxOf(bounds(a))).map((b) => [b[0] + 0.5, b[1] + 0.5, b[2] - 0.5, b[3] - 0.5]) };
  });

  /** Geometry rectangle used for resizing (without stroke). */
  function geomRect(a: Annotation): Rect | null {
    if (a.type === 'note') return null; // comments have a fixed icon size
    if (isBoxed(a)) return a.rect;
    if (a.type === 'shape' && (a.shape === 'rect' || a.shape === 'ellipse')) return normRect(a.from, a.to);
    if (a.type === 'ink') return unionRects(a.paths.flat().map((p) => [p[0], p[1], p[0], p[1]] as Rect));
    return null;
  }

  interface Handle {
    at: Point;
    cursor: string;
    resize: Reshape;
    /** Undo label, when not "Resize …". */
    label?: string;
    /** The round handle that turns an image. */
    turn?: boolean;
    /** A line's end (drawn on the point), not a corner (drawn inside it). */
    end?: boolean;
  }

  /** Handles' targets: at least 24 px, 44 px for fingers (they reach past the frame, invisibly). */
  const coarse = new MediaQuery('(pointer: coarse), (max-width: 720px)');
  const HANDLE = 10;
  /** A corner handle sits inside its corner (its outer edges on the bounds), toward the frame's middle. */
  const inward = (h: Handle, all: Handle[]): Point => {
    if (h.turn || h.end) return [0, 0];
    const corners = all.filter((x) => !x.turn && !x.end);
    const cx = corners.reduce((n, x) => n + x.at[0], 0) / corners.length;
    const cy = corners.reduce((n, x) => n + x.at[1], 0) / corners.length;
    return [Math.sign(cx - h.at[0]) * (HANDLE / 2), Math.sign(cy - h.at[1]) * (HANDLE / 2)];
  };

  /** Distance of an image's turn handle above its top edge, in px. */
  const TURN_HANDLE_GAP = 24;

  /** Images: handles on the turned box; resize keeps proportions unless unlocked, Alt resizes from the center. */
  function imageHandles(a: ImageAnnotation): Handle[] {
    const f = frameOf(a);
    const lock = a.role === 'signature' || viewer.imageAspectLock;
    const list: Handle[] = frameCorners(f).map((at, i) => ({
      at,
      cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize',
      resize: (p, e) => fromFrame(a, resizeFrame(f, i, toScreen(p), { lock, fromCenter: e.altKey })),
    }));
    if (a.role === 'image') {
      const base = f.turn - (a.angle ?? 0);
      list.push({ at: turnHandle(f, TURN_HANDLE_GAP), cursor: 'grab', turn: true, label: 'Rotate image', resize: (p, e) => fromFrame(a, turnFrame(f, toScreen(p), base, e.shiftKey)) });
    }
    return list;
  }

  const handles = $derived.by((): Handle[] => {
    const a = editDraft ?? preview ?? selected;
    if (!a || (!selecting && !editing) || cropping?.id === a.id) return [];
    if (a.type === 'image') return imageHandles(a);
    if (a.type === 'shape' && (a.shape === 'line' || a.shape === 'arrow')) {
      const original = a;
      return [
        { at: toScreen(a.from), cursor: 'move', end: true, resize: (p: Point) => ({ ...original, from: p }) },
        { at: toScreen(a.to), cursor: 'move', end: true, resize: (p: Point) => ({ ...original, to: p }) },
      ];
    }
    const r = geomRect(a);
    if (!r) return [];
    const corners: Point[] = [
      [r[0], r[1]],
      [r[2], r[1]],
      [r[2], r[3]],
      [r[0], r[3]],
    ];
    const original = a;
    // Stamps keep their proportions.
    const keepAspect = a.type === 'stamp';
    return corners.map((c, i) => {
      const fixed = corners[(i + 2) % 4];
      const resize = (p: Point) => {
        if (!keepAspect) return remap(original, r, normRect(fixed, p));
        const w = r[2] - r[0];
        const h = r[3] - r[1];
        const k = Math.max(Math.abs(p[0] - fixed[0]) / w, Math.abs(p[1] - fixed[1]) / h, 0.1);
        const to: Point = [fixed[0] + Math.sign(c[0] - fixed[0]) * w * k, fixed[1] + Math.sign(c[1] - fixed[1]) * h * k];
        return remap(original, r, normRect(fixed, to));
      };
      return { at: toScreen(c), cursor: 'nwse-resize', resize };
    });
  });

  /** An image's selection outline, following its turn. */
  const imageOutline = $derived.by(() => {
    const a = preview ?? selected;
    if (!a || a.type !== 'image' || cropping?.id === a.id) return null;
    const f = frameOf(a);
    return { corners: frameCorners(f, -0.5), top: turnHandle(f, 0), handle: a.role === 'image' ? turnHandle(f, TURN_HANDLE_GAP) : null };
  });

  const selectionBox = $derived.by(() => {
    // While typing, the outline follows the box as it grows.
    const a = editDraft ?? preview ?? selected;
    if (!a || a.type === 'image') return null;
    // On the object's real bounds (stroke and arrowheads included), the outline's
    // 1px line inside them: a frame snapped to a margin never seems to cross it.
    const b = screenBoxOf(bounds(a));
    return [b[0] + 0.5, b[1] + 0.5, b[2] - 0.5, b[3] - 0.5];
  });

  function onAnnotKey(e: KeyboardEvent, a: Annotation) {
    if (e.key === 'Enter' && a.type === 'text') {
      if (a.groups) viewer.notify(OBJECT_STRINGS.ungroupToEdit);
      else void startEdit(a, false);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (isSelected(a)) actions.deleteSelection();
      else actions.deleteAnnotation(page.id, a.id);
    } else if (e.key === 'Escape') {
      viewer.selectAnnot(null);
      focusSink();
    } else if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey) {
      // Nudge (Cmd/Ctrl+arrows change the layer order: the app's shortcuts handle them) in screen direction: 1 px, or 10 px with Shift.
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
      const origin = toPdf(0, 0);
      const moved = toPdf(d[0], d[1]);
      if (!isSelected(a)) select(a);
      // Several objects (or a group) stop at the page edge as a whole.
      const members = isSelected(a) ? selMembers : membersOf(annots, [unitOf(a)]);
      const box = boxOf(members)!;
      const lim = viewer.limitFor(page, box);
      const m = clampMove(box, lim.rect, moved[0] - origin[0], moved[1] - origin[1]);
      if (m.limited) viewer.limitHit(page.id, lim.kind);
      if (m.dx || m.dy) actions.nudgeSelection(m.dx, m.dy);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
</script>

{#snippet shape(a: Annotation)}
  {@const prims = toPrimitives(a, toScreen, viewer.scale)}
  <!-- Focusable as a button only while the Select tool is active. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <g
    class="annot"
    class:selected={isSelected(a)}
    role={selecting ? 'button' : undefined}
    tabindex={selecting && a !== draft ? 0 : undefined}
    data-annot-id={a.id}
    aria-label={selecting ? `${describe(a)} (Delete to remove, arrow keys to move)` : undefined}
    onpointerdown={(e) => onAnnotDown(e, a)}
    oncontextmenu={(e) => onAnnotMenu(e, a)}
    onkeydown={(e) => onAnnotKey(e, a)}
    onfocus={() => selecting && !isSelected(a) && select(a)}
  >
    {#each prims as p, k (k)}
      {#if p.kind === 'polygon'}
        <polygon points={pointsAttr(p.points)} fill={p.fill} fill-opacity={p.opacity} />
      {:else if p.kind === 'polyline'}
        <polyline class="hit" points={pointsAttr(p.points)} stroke-width={Math.max(p.width, 12)} />
        <polyline points={pointsAttr(p.points)} fill="none" stroke={p.stroke} stroke-width={p.width} stroke-opacity={p.opacity} stroke-linecap="round" stroke-linejoin="round" />
      {:else}
        <ellipse class="hit" cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} stroke-width={Math.max(p.width, 12)} fill={p.fill ? 'transparent' : 'none'} />
        <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={p.fill ?? 'none'} fill-opacity={p.opacity} stroke={p.stroke ?? 'none'} stroke-width={p.width} stroke-opacity={p.opacity} />
      {/if}
    {/each}
  </g>
{/snippet}

<!-- One element per object, in stacking order (bottom first), all on the same level:
     what's drawn on top is also what's clicked and tabbed to last. -->
{#each all as a (a.id)}
  {#if cropping?.id === a.id && a.type === 'image'}
    <CropOverlay session={cropping} frame={frameOf(cropping.base)} scale={viewer.scale} />
  {:else if isBoxed(a)}
    <BoxedView {a} {toScreen} scale={viewer.scale} {pageRotation} z={4} hideText={editing?.composing && a.id === editing.id} />
    {#if selecting}
      {@const g = boxedGeometry(a, toScreen, viewer.scale, pageRotation)}
      <div
        class="box-hit annot"
        class:selected={isSelected(a)}
        role="button"
        tabindex="0"
        data-annot-id={a.id}
        data-kind={a.type}
        aria-label="{describe(a)}{a.type === 'text' ? ': ' + a.text.slice(0, 60) : a.type === 'note' && a.text ? ': ' + a.text.slice(0, 60) : ''}. {a.type === 'text' ? 'Enter to edit, ' : ''}Delete to remove, arrow keys to move."
        title={a.type === 'note' ? a.text || 'Empty comment' : undefined}
        style:left="{g.cx}px"
        style:top="{g.cy}px"
        style:width="{g.w}px"
        style:height="{g.h}px"
        style:transform="translate(-50%, -50%) rotate({g.turn}deg)"
        onpointerdown={(e) => onAnnotDown(e, a)}
        oncontextmenu={(e) => onAnnotMenu(e, a)}
        onkeydown={(e) => onAnnotKey(e, a)}
        onfocus={() => !isSelected(a) && select(a)}
        ondblclick={() => {
          if (a.type === 'image') return actions.startCrop({ pageId: page.id, id: a.id });
          if (a.type !== 'text') return;
          if (a.groups) viewer.notify(OBJECT_STRINGS.ungroupToEdit);
          else void startEdit(a, false);
        }}
        {@attach holdPagePinch}
      ></div>
    {/if}
  {:else}
    <svg class="layer" class:multiply={a.type === 'highlight'} class:live={selecting} width={viewport.width} height={viewport.height} aria-hidden={!selecting}>
      {@render shape(a)}
    </svg>
  {/if}
{/each}

{#if editing && editGeom && editDraft}
  {#await loadRichEditor() then RichTextEditor}
    {#key editing.id}
      <RichTextEditor
        fits={editFits}
        onFull={() => viewer.notify(OBJECT_STRINGS.textFull(fullAt))}
        annot={editDraft}
        geom={editGeom}
        scale={viewer.scale}
        onChange={(paragraphs, text) => editing && (editing = { ...editing, paragraphs, text })}
        onComposing={(on) => editing && (editing = { ...editing, composing: on })}
        onReady={(api) => {
          viewer.textEditor = api;
          // Opened by a double-click on converted text: the caret goes where it was clicked.
          if (pendingCaret) api.caretAt(...pendingCaret);
          pendingCaret = null;
        }}
        onBox={(box) => editing && (editing = { ...editing, box })}
        onFinish={() => {
          void commitEdit();
          // The surface goes away with the edit: keep focus in the editor, not on <body>.
          focusSink();
        }}
      />
    {/key}
  {/await}
{/if}

<svg bind:this={ui} class="layer ui" width={viewport.width} height={viewport.height} aria-hidden="true">
  {#if selectionBox}
    <rect
      class="sel-box"
      class:editing={!!editing}
      x={selectionBox[0]}
      y={selectionBox[1]}
      width={selectionBox[2] - selectionBox[0]}
      height={selectionBox[3] - selectionBox[1]}
    />
  {/if}
  {#if marginLines}
    {@const m = marginLines}
    {@const label = marginLabel(ptToMm(guideMargin ?? 0), viewer.marginUnit)}
    <!-- Margin guides: never saved, printed or exported, and never in the way of the pointer. The label is this page's margin (a small page gets less). -->
    <rect class="margin-guide" class:flash={viewer.marginFlash === page.id} x={m.left} y={m.top} width={m.right - m.left} height={m.bottom - m.top} />
    <text class="margin-label" x={m.left} y={m.top - pageArea[1] >= 14 ? m.top - 4 : m.top + 12}>{label}</text>
  {/if}
  {#each guides as g, i (i)}
    {#if g.axis === 'x'}
      <line class="guide" x1={g.at} x2={g.at} y1={pageArea[1]} y2={pageArea[3]} />
    {:else}
      <line class="guide" x1={pageArea[0]} x2={pageArea[2]} y1={g.at} y2={g.at} />
    {/if}
  {/each}
  {#each guideLabels as l, i (i)}
    <text class="guide-label" x={l.x} y={l.y}>{l.text}</text>
  {/each}
  {#if blockOutline}
    {#each blockOutline.parts as b, i (i)}
      <rect class="member-box" x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} />
    {/each}
    <rect class="sel-box block" x={blockOutline.all[0]} y={blockOutline.all[1]} width={blockOutline.all[2] - blockOutline.all[0]} height={blockOutline.all[3] - blockOutline.all[1]} />
  {/if}
  {#if marquee}
    {@const r = screenBox([marquee.start, marquee.end])}
    <rect class="marquee" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
  {/if}
  {#if imageOutline}
    <polygon class="sel-box" points={pointsAttr(imageOutline.corners)} />
    {#if imageOutline.handle}
      <line class="turn-stem" x1={imageOutline.top[0]} y1={imageOutline.top[1]} x2={imageOutline.handle[0]} y2={imageOutline.handle[1]} />
    {/if}
  {/if}
  {#each handles as h, i (i)}
    {@const hit = coarse.current ? 44 : 24}
    {@const o = inward(h, handles)}
    <!-- Handles are a pointer convenience; keyboard users use arrow keys and the panel's fields. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g style:cursor={h.cursor} style:pointer-events={editing ? 'none' : undefined} onpointerdown={(e) => onHandleDown(e, h)}>
      <!-- The target: at least 24 px (44 px for fingers), centered on the corner. -->
      <rect class="handle-touch" x={h.at[0] - hit / 2} y={h.at[1] - hit / 2} width={hit} height={hit} />
      {#if h.turn}
        <circle class="handle" cx={h.at[0]} cy={h.at[1]} r="6" />
      {:else}
        <!-- While typing the handles show where the box is, but resizing waits until editing ends. -->
        <rect class="handle" class:inert={!!editing} x={h.at[0] + o[0] - HANDLE / 2} y={h.at[1] + o[1] - HANDLE / 2} width={HANDLE} height={HANDLE} />
      {/if}
    </g>
  {/each}
</svg>

{#if capturing}
  <div
    class="capture"
    class:placing
    onpointerdown={onCaptureDown}
    onpointermove={onCaptureMove}
    onpointerup={onCaptureUp}
    onpointercancel={onCaptureUp}
    role="presentation"
  ></div>
{/if}

<style>
  .layer {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 4;
    overflow: visible;
    pointer-events: none;
  }
  .multiply {
    mix-blend-mode: multiply;
  }
  .ui {
    z-index: 5;
  }
  .live .annot {
    pointer-events: visiblePainted;
    cursor: move;
  }
  .annot:focus {
    outline: none;
  }
  .annot:focus-visible polygon,
  .annot:focus-visible polyline:not(.hit),
  .annot:focus-visible ellipse:not(.hit) {
    filter: drop-shadow(0 0 2px var(--accent));
  }
  .hit {
    fill: none;
    stroke: transparent;
  }
  .sel-box {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  /* Several objects or a group: the dashed box around all, each object lightly outlined. */
  .sel-box.block {
    stroke-width: 1.5;
  }
  .member-box {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    stroke-opacity: 0.45;
  }
  /* Margin guides (View › Show margins) and snapping guides: editor-only overlays. */
  .margin-guide {
    fill: none;
    stroke: var(--accent);
    stroke-opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  /* An object just stopped at the margin. */
  .margin-guide.flash {
    stroke: var(--danger);
    stroke-opacity: 1;
    stroke-width: 2;
  }
  .margin-label {
    fill: var(--accent);
    fill-opacity: 0.7;
    font-size: 11px;
    font-family: var(--font-sans);
  }
  .guide {
    stroke: var(--accent);
    stroke-width: 1;
  }
  .guide-label {
    fill: var(--accent);
    font-size: 11px;
    font-family: var(--font-sans);
  }
  /* The rectangle dragged to select objects. */
  .marquee {
    fill: var(--accent-soft);
    fill-opacity: 0.5;
    stroke: var(--accent);
    stroke-width: 1;
  }
  .handle {
    fill: var(--surface);
    stroke: var(--accent);
    stroke-width: 1.5;
    pointer-events: all;
  }
  .turn-stem {
    stroke: var(--accent);
    stroke-width: 1;
  }
  .handle-touch {
    fill: transparent;
    pointer-events: all;
    touch-action: none;
  }
  .capture {
    position: absolute;
    inset: 0;
    z-index: 6;
    cursor: crosshair;
    touch-action: none;
  }
  .capture.placing {
    cursor: copy;
  }
  .box-hit {
    position: absolute;
    z-index: 4;
    pointer-events: auto;
    cursor: move;
  }
  /* A selected image follows one finger (and two pinch it) instead of scrolling the page. */
  .box-hit.selected[data-kind='image'] {
    touch-action: none;
  }
  .box-hit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* Editing: the selection outline is solid accent instead of dashed. */
  .sel-box.editing {
    stroke-dasharray: none;
    stroke-width: 1.5;
  }
  .handle.inert {
    pointer-events: none;
  }
</style>
