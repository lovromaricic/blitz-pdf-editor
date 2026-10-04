<script lang="ts">
  import { capturePointer } from '../lib/dom';
  // Markup on one page: draws annotations and handles the markup tools
  // (Highlight, Draw, Shapes, Text, Stamp, Comment, Sign) and Select. Coordinates are converted between screen and PDF
  // space with the page viewport, so rotation and zoom need no special cases.
  import type { PageViewport } from 'pdfjs-dist';
  import { tick } from 'svelte';
  import {
    describe,
    isBoxed,
    NOTE_SIZE,
    rectFromUpright,
    uprightTopLeft,
    type BoxedAnnotation,
    type TextAnnotation,
    mergeLineRects,
    newAnnotationId,
    normRect,
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
  import { CSS_FAMILY, LINE_HEIGHT, loadFonts, TEXT_PADDING } from '../lib/fonts';
  import { DEFAULT_TEXT_WIDTH, layoutText, makeStamp, topLeftForCenter } from '../lib/text-layout';
  import BoxedView from './BoxedView.svelte';
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

  const annots = $derived((page.annots ?? []).map((a) => (preview && a.id === preview.id ? preview : a)));
  const all = $derived(draft ? [...annots, draft] : annots);
  const highlights = $derived(all.filter((a) => a.type === 'highlight'));
  const others = $derived(all.filter((a) => a.type !== 'highlight' && !isBoxed(a)));
  const boxes = $derived(all.filter(isBoxed));
  const pageRotation = $derived(viewer.doc.totalRotation(page));
  const selectedId = $derived(viewer.selectedAnnot?.pageId === page.id ? viewer.selectedAnnot.id : null);
  const selected = $derived(annots.find((a) => a.id === selectedId) ?? null);
  const selecting = $derived(viewer.tool === 'select');
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
    const start = clientToPdf(e.clientX, e.clientY);
    drawing = { pointerId: e.pointerId, start, raw: [start] };
    viewer.selectAnnot(null);
    if (viewer.tool === 'draw') {
      // Snapshot: annotations must be plain data, not live links to the tool settings.
      const t = $state.snapshot(viewer.toolProps.draw);
      draft = { id: newAnnotationId(), type: 'ink', color: t.color, opacity: t.opacity, width: t.width, paths: [[start]] };
    } else {
      const t = $state.snapshot(viewer.toolProps.shapes);
      draft = { id: newAnnotationId(), type: 'shape', shape: t.shape, color: t.color, fill: t.fill, width: t.width, opacity: t.opacity, from: start, to: start };
    }
  }

  function onCaptureMove(e: PointerEvent) {
    if (!drawing || e.pointerId !== drawing.pointerId || !draft) return;
    if (draft.type === 'ink') {
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) drawing.raw.push(clientToPdf(ev.clientX, ev.clientY));
      draft = { ...draft, paths: [simplifyPath(drawing.raw, 0.6 / viewer.zoom)] };
    } else if (draft.type === 'shape') {
      draft = { ...draft, to: constrain(draft.shape, drawing.start, clientToPdf(e.clientX, e.clientY), e.shiftKey) };
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
        const existing = annots.find(
          (a): a is TextAnnotation => a.type === 'text' && at[0] >= a.rect[0] && at[0] <= a.rect[2] && at[1] >= a.rect[1] && at[1] <= a.rect[3],
        );
        if (existing) return startEdit(existing, false);
        const t = $state.snapshot(viewer.toolProps.text);
        const h = t.size * LINE_HEIGHT + 2 * TEXT_PADDING;
        // The box starts at the click, with the first line's middle on it.
        const shifted = topLeftForCenter(at, 0, h, pageRotation);
        return startEdit(
          {
            id: newAnnotationId(),
            type: 'text',
            color: t.color,
            opacity: t.opacity,
            font: t.font,
            size: t.size,
            text: '',
            lines: [''],
            rotate: pageRotation,
            rect: rectFromUpright(shifted, DEFAULT_TEXT_WIDTH, h, pageRotation),
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
  let editing = $state<{ annot: TextAnnotation; isNew: boolean } | null>(null);
  let editText = $state('');
  let editor = $state<HTMLTextAreaElement | null>(null);

  async function startEdit(a: TextAnnotation, isNew: boolean) {
    await commitEdit();
    await loadFonts();
    editing = { annot: a, isNew };
    editText = a.text;
    await tick();
    editor?.focus();
    autoSize();
  }

  async function commitEdit() {
    const e = editing;
    if (!e) return;
    editing = null;
    const text = editText.replace(/\s+$/, '');
    if (!text.trim()) {
      if (!e.isNew) actions.deleteAnnotation(page.id, e.annot.id);
      return;
    }
    if (!e.isNew && text === e.annot.text) return;
    const laid = layoutText({ ...e.annot, text });
    if (e.isNew) actions.addAnnotation(page.id, laid);
    else actions.updateAnnotation(page.id, laid, 'Edit text');
  }

  function autoSize() {
    if (!editor) return;
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  }

  const editGeom = $derived.by(() => {
    if (!editing) return null;
    const a = editing.annot;
    const [x, y] = toScreen(uprightTopLeft(a));
    const g = boxedGeometry(a, toScreen, viewer.scale, pageRotation);
    return { x, y, w: g.w, turn: g.turn };
  });

  // Leaving the Text tool (or the page) finishes the edit.
  $effect(() => {
    if (viewer.tool !== 'text' && viewer.tool !== 'select') void commitEdit();
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

  let moving: { pointerId: number; start: Point; original: Annotation; moved: boolean; resize?: (p: Point) => Annotation } | null = null;

  function select(a: Annotation) {
    viewer.selectAnnot({ pageId: page.id, id: a.id });
  }

  function onAnnotDown(e: PointerEvent, a: Annotation) {
    if (!selecting || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    select(a);
    startDrag(e, a);
  }

  function onHandleDown(e: PointerEvent, resize: (p: Point) => Annotation) {
    if (!selected || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, selected, resize);
  }

  function startDrag(e: PointerEvent, original: Annotation, resize?: (p: Point) => Annotation) {
    moving = { pointerId: e.pointerId, start: clientToPdf(e.clientX, e.clientY), original, moved: false, resize };
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
    const p = clientToPdf(e.clientX, e.clientY);
    if (!moving.moved && Math.hypot(p[0] - moving.start[0], p[1] - moving.start[1]) * viewer.scale < 3) return;
    moving.moved = true;
    preview = moving.resize ? moving.resize(p) : translate(moving.original, p[0] - moving.start[0], p[1] - moving.start[1]);
  }

  function onUiUp(e: PointerEvent) {
    if (!moving || e.pointerId !== moving.pointerId) return;
    const done = preview;
    const wasResize = !!moving.resize;
    moving = null;
    preview = null;
    if (!done) return;
    // Text re-wraps to its new width.
    const final = done.type === 'text' && wasResize ? layoutText(done) : done;
    actions.updateAnnotation(page.id, final, `${wasResize ? 'Resize' : 'Move'} ${describe(done).toLowerCase()}`);
  }

  // Clicking the page outside any annotation deselects.
  $effect(() => {
    if (!selecting) return;
    const host = ui.parentElement!;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.annot, .handle') && viewer.selectedAnnot?.pageId === page.id) viewer.selectAnnot(null);
    };
    host.addEventListener('pointerdown', onDown);
    return () => host.removeEventListener('pointerdown', onDown);
  });

  /** Geometry rectangle used for resizing (without stroke). */
  function geomRect(a: Annotation): Rect | null {
    if (a.type === 'note') return null; // comments have a fixed icon size
    if (isBoxed(a)) return a.rect;
    if (a.type === 'shape' && (a.shape === 'rect' || a.shape === 'ellipse')) return normRect(a.from, a.to);
    if (a.type === 'ink') return unionRects(a.paths.flat().map((p) => [p[0], p[1], p[0], p[1]] as Rect));
    return null;
  }

  const handles = $derived.by(() => {
    const a = preview ?? selected;
    if (!a || !selecting) return [];
    if (a.type === 'shape' && (a.shape === 'line' || a.shape === 'arrow')) {
      const original = a;
      return [
        { at: toScreen(a.from), cursor: 'move', resize: (p: Point) => ({ ...original, from: p }) },
        { at: toScreen(a.to), cursor: 'move', resize: (p: Point) => ({ ...original, to: p }) },
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
    // Stamps and images keep their proportions.
    const keepAspect = a.type === 'stamp' || a.type === 'image';
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

  const selectionBox = $derived.by(() => {
    const a = preview ?? selected;
    if (!a) return null;
    if (isBoxed(a)) {
      const b = screenBox([toScreen([a.rect[0], a.rect[1]]), toScreen([a.rect[2], a.rect[3]])]);
      return [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3];
    }
    const prims = toPrimitives(a, toScreen, viewer.scale);
    const pts = prims.flatMap((p) => (p.kind === 'ellipse' ? [[p.cx - p.rx, p.cy - p.ry], [p.cx + p.rx, p.cy + p.ry]] as Point[] : p.points));
    const b = screenBox(pts);
    const pad = 4 + (a.type === 'highlight' ? 0 : (('width' in a ? a.width : 0) * viewer.scale) / 2);
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  });

  function onAnnotKey(e: KeyboardEvent, a: Annotation) {
    if (e.key === 'Enter' && a.type === 'text') {
      void startEdit(a, false);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      actions.deleteAnnotation(page.id, a.id);
    } else if (e.key === 'Escape') {
      viewer.selectAnnot(null);
      (e.currentTarget as SVGElement).blur();
    } else if (e.key.startsWith('Arrow')) {
      // Nudge in screen direction: 1 px, or 10 px with Shift.
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
      const origin = toPdf(0, 0);
      const moved = toPdf(d[0], d[1]);
      actions.updateAnnotation(page.id, translate(a, moved[0] - origin[0], moved[1] - origin[1]), `Move ${describe(a).toLowerCase()}`, `nudge:${a.id}`);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
</script>

{#snippet shapes(list: Annotation[])}
  {#each list as a (a.id)}
    {@const prims = toPrimitives(a, toScreen, viewer.scale)}
    <!-- Focusable as a button only while the Select tool is active. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <g
      class="annot"
      class:selected={a.id === selectedId}
      class:live={selecting}
      role={selecting ? 'button' : undefined}
      tabindex={selecting && a !== draft ? 0 : undefined}
      aria-label={selecting ? `${describe(a)} (Delete to remove, arrow keys to move)` : undefined}
      onpointerdown={(e) => onAnnotDown(e, a)}
      onkeydown={(e) => onAnnotKey(e, a)}
      onfocus={() => selecting && select(a)}
    >
      {#each prims as p, k (k)}
        {#if p.kind === 'polygon'}
          <polygon points={pointsAttr(p.points)} fill={p.fill} fill-opacity={p.opacity} />
        {:else if p.kind === 'polyline'}
          <polyline class="hit" points={pointsAttr(p.points)} stroke-width={Math.max(p.width, 12)} />
          <polyline points={pointsAttr(p.points)} fill="none" stroke={p.stroke} stroke-width={p.width} stroke-opacity={p.opacity} stroke-linecap="round" stroke-linejoin="round" />
        {:else}
          <ellipse class="hit" cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} stroke-width={Math.max(p.width, 12)} fill={p.fill ? 'transparent' : 'none'} />
          <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={p.fill ?? 'none'} fill-opacity={p.opacity} stroke={p.stroke} stroke-width={p.width} stroke-opacity={p.opacity} />
        {/if}
      {/each}
    </g>
  {/each}
{/snippet}

<svg class="layer multiply" class:live={selecting} width={viewport.width} height={viewport.height} aria-hidden={!selecting}>
  {@render shapes(highlights)}
</svg>
<svg class="layer" class:live={selecting} width={viewport.width} height={viewport.height} aria-hidden={!selecting}>
  {@render shapes(others)}
</svg>

<div class="layer boxes" aria-hidden={!selecting}>
  {#each boxes as a (a.id)}
    <BoxedView {a} {toScreen} scale={viewer.scale} {pageRotation} hidden={editing?.annot.id === a.id} />
  {/each}
  {#if selecting}
    {#each boxes as a (a.id)}
      {@const g = boxedGeometry(a, toScreen, viewer.scale, pageRotation)}
      <div
        class="box-hit annot"
        class:selected={a.id === selectedId}
        role="button"
        tabindex="0"
        aria-label="{describe(a)}{a.type === 'text' ? ': ' + a.text.slice(0, 60) : a.type === 'note' && a.text ? ': ' + a.text.slice(0, 60) : ''}. {a.type === 'text' ? 'Enter to edit, ' : ''}Delete to remove, arrow keys to move."
        title={a.type === 'note' ? a.text || 'Empty comment' : undefined}
        style:left="{g.cx}px"
        style:top="{g.cy}px"
        style:width="{g.w}px"
        style:height="{g.h}px"
        style:transform="translate(-50%, -50%) rotate({g.turn}deg)"
        onpointerdown={(e) => onAnnotDown(e, a)}
        onkeydown={(e) => onAnnotKey(e, a)}
        onfocus={() => select(a)}
        ondblclick={() => a.type === 'text' && startEdit(a, false)}
      ></div>
    {/each}
  {/if}
</div>

{#if editing && editGeom}
  {@const a = editing.annot}
  <textarea
    bind:this={editor}
    bind:value={editText}
    class="text-editor"
    aria-label="Text"
    spellcheck="true"
    style:left="{editGeom.x}px"
    style:top="{editGeom.y}px"
    style:width="{editGeom.w}px"
    style:transform="rotate({editGeom.turn}deg)"
    style:font-family={CSS_FAMILY[a.font]}
    style:font-size="{a.size * viewer.scale}px"
    style:line-height={LINE_HEIGHT}
    style:padding="{TEXT_PADDING * viewer.scale}px"
    style:color="rgb({a.color.map((c) => Math.round(c * 255)).join(' ')})"
    oninput={autoSize}
    onblur={() => void commitEdit()}
    onpointerdown={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        editor?.blur();
      }
    }}
  ></textarea>
{/if}

<svg bind:this={ui} class="layer ui" width={viewport.width} height={viewport.height} aria-hidden="true">
  {#if selectionBox}
    <rect
      class="sel-box"
      x={selectionBox[0]}
      y={selectionBox[1]}
      width={selectionBox[2] - selectionBox[0]}
      height={selectionBox[3] - selectionBox[1]}
    />
  {/if}
  {#each handles as h, i (i)}
    <!-- Resize handles are a pointer convenience; keyboard users move with arrow keys. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <rect
      class="handle"
      x={h.at[0] - 5}
      y={h.at[1] - 5}
      width="10"
      height="10"
      style:cursor={h.cursor}
      onpointerdown={(e) => onHandleDown(e, h.resize)}
    />
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
    filter: drop-shadow(0 0 2px var(--color-focus));
  }
  .hit {
    fill: none;
    stroke: transparent;
  }
  .sel-box {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }
  .handle {
    fill: #fff;
    stroke: var(--color-accent);
    stroke-width: 1.5;
    pointer-events: all;
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
  .boxes {
    width: 100%;
    height: 100%;
  }
  .box-hit {
    position: absolute;
    pointer-events: auto;
    cursor: move;
  }
  .box-hit:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  .text-editor {
    position: absolute;
    z-index: 7;
    box-sizing: border-box;
    min-height: 1em;
    margin: 0;
    border: 1px dashed var(--color-accent);
    background: rgb(255 255 255 / 0.85);
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    transform-origin: 0 0;
    outline: none;
  }
</style>
