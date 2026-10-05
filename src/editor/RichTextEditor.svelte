<script lang="ts">
  // The editing surface of a text box (ProseMirror). It lies exactly on the
  // rendered box, laid out by the browser with the same line model as the
  // layout engine, and its own text is invisible: the box underneath (drawn
  // by the shared layout, updated on every change) is what you see, so the
  // text never moves when editing starts or ends. The surface provides the
  // caret, selection, IME, clipboard and undo within the editing session.
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { EditorState, Plugin, TextSelection, type Transaction } from 'prosemirror-state';
  import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
  import { history, undo, redo, closeHistory } from 'prosemirror-history';
  import { keymap } from 'prosemirror-keymap';
  import { baseKeymap, splitBlock } from 'prosemirror-commands';
  import type { TextAnnotation, TextLink, TextParagraph } from '../lib/annotations';
  import { baseRun, paragraphsOf, type RunFormat } from '../lib/text-rich';
  import { cssFamily } from '../lib/fonts';
  import {
    applyFormat,
    autoLinkBefore,
    cssFamilyHook,
    linkRangeAt,
    markLink,
    rangeText,
    removeLink,
    selectedLink,
    setLink,
    type LinkRange,
    docFromParagraphs,
    formatOf,
    formatsInSelection,
    insertPlainText,
    marksFor,
    paragraphsFromDoc,
    plainTextOf,
    selectEnd,
    selectionFormat,
    toggleFormat,
    type SelectionFormat,
  } from '../lib/rich-text/schema';
  import { copiedSlice, markerFromHtml, markerHtml, rememberCopy, RICH_MARK } from '../lib/rich-text/clipboard';
  import type { RichEditorApi } from '../lib/rich-text/api';
  import { TEXT_PADDING } from '../lib/fonts';
  import { alignOf, lineSpacingOf } from '../lib/text-format';
  import { rgbToCss } from '../lib/annotations';
  import { isMac } from '../lib/commands';
  import { linkTarget, openExternal } from '../lib/links';
  import { useViewer } from '../lib/viewer.svelte';
  import LinkPopover from './LinkPopover.svelte';
  import LinkCard from './LinkCard.svelte';

  cssFamilyHook.family = cssFamily;

  let {
    annot,
    geom,
    scale,
    onChange,
    onFinish,
    onComposing,
    onReady,
    onBox,
  }: {
    /** The box being edited: its content to start from, and its box settings (live). */
    annot: TextAnnotation;
    geom: { cx: number; cy: number; w: number; h: number; turn: number };
    scale: number;
    onChange: (paragraphs: TextParagraph[], text: string) => void;
    onFinish: () => void;
    /** True while an input method composes text (its own text shows then). */
    onComposing: (on: boolean) => void;
    /** The editor's controls for the panel and shortcuts. */
    onReady: (api: RichEditorApi) => void;
    /** Box settings changed from the panel while editing. */
    onBox: (changes: Partial<TextAnnotation>, label: string, coalesceKey?: string) => void;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView;
  // svelte-ignore state_referenced_locally (the base format is fixed for the session)
  const fallback: RunFormat = (({ text: _t, ...f }) => f)(baseRun(annot));
  let sel = $state.raw<SelectionFormat>(null as unknown as SelectionFormat);
  let formats = $state.raw<RunFormat[]>([]);
  let composing = $state(false);
  let focused = $state(true);

  const viewer = useViewer();
  const phone = new MediaQuery('(max-width: 720px)');

  /** Every text keeps a full format: text typed where there was none takes the paragraph's (or the box's). */
  const keepFormats = new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = state.tr;
      state.doc.descendants((node, pos, parent) => {
        if (!node.isText) return;
        const missing = ['font', 'size', 'color'].filter((m) => !node.marks.some((x) => x.type.name === m));
        if (!missing.length) return;
        const f = (parent?.attrs.empty as RunFormat | null) ?? fallback;
        for (const m of marksFor(f)) if (missing.includes(m.type.name)) tr.addMark(pos, pos + node.nodeSize, m);
      });
      return tr.docChanged ? tr : null;
    },
  });

  /** While the panel has focus, the selection still shows (as a highlight) so you see what you format. */
  const keepSelectionVisible = new Plugin({
    props: {
      decorations(state) {
        const { from, to, empty } = state.selection;
        const decos: Decoration[] = [];
        if (!focused && !empty) decos.push(Decoration.inline(from, to, { class: 'kept-selection' }));
        // "Type here" in an empty box.
        if (state.doc.childCount === 1 && state.doc.firstChild!.childCount === 0) decos.push(Decoration.node(0, state.doc.firstChild!.nodeSize, { class: 'placeholder', 'data-placeholder': 'Type here' }));
        return DecorationSet.create(state.doc, decos);
      },
    },
  });

  /** Enter (and Shift+Enter) starts a paragraph that keeps the typing style. */
  const newParagraph = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    // An address typed just before Enter becomes a link (after the new line, as its own undo step).
    const typed = state.selection.empty ? autoLinkBefore(state, state.selection.from) : null;
    const done = splitBlock(state, (tr) => {
      const at = tr.selection.$from;
      if (at.parent.childCount === 0) tr.setNodeMarkup(at.before(), undefined, { empty: formatOf(marks, fallback) });
      // A link doesn't carry on into the new paragraph.
      dispatch?.(tr.setStoredMarks(marks.filter((m) => m.type.name !== 'link')));
    });
    if (done && typed && dispatch) autoLink(typed);
    return done;
  };

  // --- Links -------------------------------------------------------------------------------

  /** The link form (Cmd/Ctrl+K, Edit > Add link…, the Text panel, Edit on the card). */
  let linkForm = $state.raw<{ from: number; to: number; text: string; link: TextLink | null; existing: boolean } | null>(null);
  /** The link under the pointer, and the one the caret is in: the card shows for either. */
  let hovered = $state.raw<LinkRange | null>(null);
  let caretLink = $state.raw<LinkRange | null>(null);
  let overCard = false;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const card = $derived(linkForm || composing ? null : (hovered ?? (focused ? caretLink : null)));
  /** Bumped on scroll and resize: the popovers follow the text. */
  let moved = $state(0);
  /** The next change after an automatic link starts a new undo step (so undo takes back only the link). */
  let isolateNext = false;

  /** Where text [from, to) is on screen: its first line. */
  function anchorOf(from: number, to: number) {
    void moved;
    if (!view) return { left: 0, top: 0, bottom: 0 };
    const a = view.coordsAtPos(from, 1);
    const b = view.coordsAtPos(to, -1);
    const sameLine = Math.abs(a.top - b.top) < 2;
    return { left: Math.min(a.left, sameLine ? b.left : a.left), top: a.top, bottom: sameLine ? Math.max(a.bottom, b.bottom) : a.bottom };
  }

  const pages = $derived(viewer.doc.pages.map((p, i) => ({ id: p.id, label: `Page ${i + 1}` })));
  const pageNumber = (pageId: string) => {
    const i = viewer.doc.pages.findIndex((p) => p.id === pageId);
    return i < 0 ? null : i + 1;
  };

  function openLink(range?: LinkRange) {
    syncSelection(view);
    const state = view.state;
    const existing = range ?? selectedLink(state);
    const { from, to } = existing ?? state.selection;
    hovered = null;
    linkForm = { from, to, text: rangeText(state.doc, from, to), link: existing?.link ?? null, existing: !!existing };
  }

  function closeForm() {
    linkForm = null;
    view.focus();
  }

  function applyLink(link: TextLink, text: string | null) {
    const f = linkForm;
    if (!f) return;
    linkForm = null;
    setLink(f, link, text, fallback, f.existing)(view.state, view.dispatch);
    view.focus();
    viewer.announce(f.existing ? 'Link changed' : 'Link added');
  }

  function unlink(range: { from: number; to: number }) {
    linkForm = null;
    hovered = null;
    removeLink(range, fallback)(view.state, view.dispatch);
    view.focus();
    viewer.announce('Link removed');
  }

  /** Open a link: web and email in a new tab (no access back to this one), a page by going there. */
  function follow(link: TextLink) {
    if (link.kind === 'url') {
      if (!openExternal(link.href)) viewer.notify("This link can't be opened: only web, email and phone links are allowed.");
      return;
    }
    const i = viewer.doc.pages.findIndex((p) => p.id === link.pageId);
    if (i >= 0) viewer.goToPage(i);
    else viewer.notify('The page this link went to was deleted.');
  }

  /** Make an address just typed a link, as its own undo step. */
  function autoLink(range: LinkRange) {
    const tr = markLink(view.state.tr, range, range.link, false, fallback);
    view.dispatch(closeHistory(tr).setMeta('autolink', true));
    isolateNext = true;
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    const el = (e.target as Element).closest?.('[data-link]');
    if (el && view.dom.contains(el)) {
      clearTimeout(leaveTimer);
      const range = linkRangeAt(view.state.doc, view.posAtDOM(el, 0), 'both');
      if (range && (hovered?.from !== range.from || hovered?.to !== range.to)) hovered = range;
    } else if (hovered) leaveSoon();
  }

  /** The card stays a moment after the pointer leaves the link, so it can be reached. */
  function leaveSoon() {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (!overCard) hovered = null;
    }, 300);
  }

  function update() {
    sel = selectionFormat(view.state, fallback);
    formats = formatsInSelection(view.state, fallback);
    const { empty, from } = view.state.selection;
    const inLink = empty ? linkRangeAt(view.state.doc, from, 'inside') : null;
    if (inLink?.from !== caretLink?.from || inLink?.to !== caretLink?.to) caretLink = inLink;
  }

  const api: RichEditorApi = {
    toggle: (style) => {
      syncSelection(view);
      toggleFormat(style, fallback)(view.state, view.dispatch);
    },
    format: (changes) => {
      syncSelection(view);
      applyFormat(changes, fallback)(view.state, view.dispatch);
    },
    get selection() {
      return sel;
    },
    get formats() {
      return formats;
    },
    focus: () => view.focus(),
    finish: () => onFinish(),
    openLink: () => openLink(),
    get box() {
      return annot;
    },
    setBox: (changes, label, coalesceKey) => onBox(changes, label, coalesceKey),
  };

  onMount(() => {
    const finish = () => {
      onFinish();
      return true;
    };
    let state = EditorState.create({
      doc: docFromParagraphs(paragraphsOf(annot)),
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-Shift-z': redo,
          'Mod-y': redo,
          'Mod-b': () => (api.toggle('bold'), true),
          'Mod-i': () => (api.toggle('italic'), true),
          'Mod-u': () => (api.toggle('underline'), true),
          'Mod-k': () => (openLink(), true),
          Enter: newParagraph,
          'Shift-Enter': newParagraph,
          Escape: finish,
          'Mod-Enter': finish,
        }),
        keymap(baseKeymap),
        keepFormats,
        keepSelectionVisible,
      ],
    });
    state = state.apply(selectEnd(state));
    view = new EditorView(host, {
      state,
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Text', spellcheck: 'true', class: 'rich-surface' },
      dispatchTransaction(tr) {
        if (isolateNext && tr.docChanged && !tr.getMeta('autolink')) {
          closeHistory(tr);
          isolateNext = false;
        }
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) onChange(paragraphsFromDoc(next.doc, fallback), plainTextOf(next.doc));
        update();
      },
      // Paste: plain text, unless it's our own copy from a text box (kept in memory, with its formats).
      // Before any shortcut runs, take in the latest selection (see syncSelection).
      handleKeyDown(v) {
        syncSelection(v);
        return false;
      },
      // A space after an address makes it a link (one undo takes back just the link).
      handleTextInput(v, from, to, text) {
        if (from !== to || !/^[ \u00a0]$/.test(text)) return false;
        const typed = autoLinkBefore(v.state, from);
        if (!typed) return false;
        v.dispatch(v.state.tr.insertText(text, from, to));
        autoLink(typed);
        return true;
      },
      handlePaste(v, event) {
        syncSelection(v);
        const data = event.clipboardData;
        if (!data) return false;
        const text = data.getData('text/plain');
        const slice = copiedSlice(data.getData(RICH_MARK) || markerFromHtml(data.getData('text/html')), text);
        v.dispatch(slice ? v.state.tr.replaceSelection(slice).scrollIntoView() : insertPlainText(v.state, text, fallback));
        return true;
      },
      // Dropped text from outside is plain text too; moving text inside the box keeps its formats.
      handleDrop(v, event, _slice, moved) {
        if (moved) return false;
        const text = (event as DragEvent).dataTransfer?.getData('text/plain');
        if (!text) return true;
        const pos = v.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        if (pos) v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos.pos)));
        v.dispatch(insertPlainText(v.state, text, fallback));
        return true;
      },
      handleDOMEvents: {
        // Cmd/Ctrl+click opens a link (a plain click puts the caret in it, as in any editor).
        mousedown: (v, e) => {
          linkForm = null;
          const el = (e.target as Element).closest?.('[data-link]');
          if (!el || !(isMac ? e.metaKey : e.ctrlKey)) return false;
          const range = linkRangeAt(v.state.doc, v.posAtDOM(el, 0), 'both');
          if (!range) return false;
          e.preventDefault();
          follow(range.link);
          return true;
        },
        copy: (v, e) => copyOut(v, e, false),
        cut: (v, e) => copyOut(v, e, true),
        compositionstart: () => ((composing = true), onComposing(true), false),
        compositionend: () => ((composing = false), onComposing(false), false),
        focus: (v) => ((focused = true), v.dispatch(v.state.tr.setMeta('focus', true)), false),
        blur: (v) => ((focused = false), v.dispatch(v.state.tr.setMeta('focus', false)), false),
      },
    });
    update();
    onReady(api);
    view.focus();
    const onMove = () => moved++;
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      clearTimeout(leaveTimer);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      view.destroy();
    };
  });

  /** Copy: the system clipboard gets plain text and our marker (never HTML); the formatted copy stays in memory. */
  /**
   * Take in a selection change the browser made a moment ago and ProseMirror
   * hasn't processed yet: a quick Shift+→ then ⌘B (or ⌘→ then ⌘V) would
   * otherwise act on the old selection.
   */
  function syncSelection(v: EditorView) {
    // Without focus the browser's selection may be anywhere (a menu, the panel): the editor's own is right.
    if (!v.hasFocus()) return;
    const s = v.dom.ownerDocument.getSelection();
    if (!s?.anchorNode || !s.focusNode || !v.dom.contains(s.anchorNode) || !v.dom.contains(s.focusNode)) return;
    try {
      const anchor = v.posAtDOM(s.anchorNode, s.anchorOffset);
      const head = v.posAtDOM(s.focusNode, s.focusOffset);
      if (anchor !== v.state.selection.anchor || head !== v.state.selection.head) {
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, anchor, head)));
      }
    } catch {
      // A position ProseMirror can't map: keep its own selection.
    }
  }

  function copyOut(v: EditorView, e: Event, cut: boolean) {
    syncSelection(v);
    const event = e as ClipboardEvent;
    const { empty } = v.state.selection;
    if (empty || !event.clipboardData) return false;
    const slice = v.state.selection.content();
    const text = slice.content.textBetween(0, slice.content.size, '\n', '\n');
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    const id = rememberCopy(slice, text);
    event.clipboardData.setData(RICH_MARK, id);
    event.clipboardData.setData('text/html', markerHtml(id, text));
    if (cut) v.dispatch(v.state.tr.deleteSelection().scrollIntoView());
    return true;
  }
</script>

<!-- The editing surface: same place, size, padding, line height and alignment as the box. -->
<div
  bind:this={host}
  class="rich-editor"
  class:composing
  style:left="{geom.cx}px"
  style:top="{geom.cy}px"
  style:width="{geom.w}px"
  style:min-height="{geom.h}px"
  style:transform="translate(-50%, -50%) rotate({geom.turn}deg)"
  style:padding="{TEXT_PADDING * scale}px"
  style:--s={scale}
  style:--lh={lineSpacingOf(annot)}
  style:text-align={alignOf(annot)}
  style:caret-color={rgbToCss(annot.color)}
  onpointerdown={(e) => e.stopPropagation()}
  onpointermove={onPointerMove}
  onpointerleave={() => hovered && leaveSoon()}
  onkeydown={(e) => e.stopPropagation()}
  role="presentation"
></div>

{#if linkForm}
  <LinkPopover
    anchor={anchorOf(linkForm.from, linkForm.to)}
    phone={phone.current}
    text={linkForm.text}
    link={linkForm.link}
    existing={linkForm.existing}
    {pages}
    onApply={applyLink}
    onRemove={() => linkForm && unlink(linkForm)}
    onCancel={closeForm}
  />
{:else if card}
  {@const c = card}
  <LinkCard
    anchor={anchorOf(c.from, c.to)}
    target={linkTarget(c.link, pageNumber)}
    kind={c.link.kind}
    onEdit={() => openLink(c)}
    onRemove={() => unlink(c)}
    onOpen={() => follow(c.link)}
    onHover={(inside) => {
      overCard = inside;
      if (inside) clearTimeout(leaveTimer);
      else if (hovered) leaveSoon();
    }}
  />
{/if}

<style>
  .rich-editor {
    position: absolute;
    z-index: 7;
    box-sizing: border-box;
    margin: 0;
    transform-origin: 50% 50%;
  }
  /* Wraps like the layout engine: same fonts, no kerning, ligatures or faked styles, pre-wrap, break-word. */
  .rich-editor :global(.rich-surface) {
    outline: none;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: normal;
    font-kerning: none;
    font-variant-ligatures: none;
    font-feature-settings:
      'kern' 0,
      'liga' 0,
      'clig' 0,
      'calt' 0,
      'dlig' 0;
    font-synthesis: none;
  }
  .rich-editor :global(p) {
    margin: 0;
  }
  /* A tiny base font: each paragraph's own line box then sits inside every run's. */
  .rich-editor :global(.rich-surface) {
    font-size: 1px;
    line-height: var(--lh);
  }
  /* Its own text is invisible: the box underneath shows it, drawn by the shared layout. */
  .rich-editor:not(.composing) :global(.rich-surface),
  .rich-editor:not(.composing) :global(.rich-surface *) {
    color: transparent !important;
  }
  .rich-editor :global(.rich-surface ::selection),
  .rich-editor :global(.kept-selection) {
    background: var(--text-selection);
  }
  .rich-editor :global(p.placeholder)::before {
    content: attr(data-placeholder);
    position: absolute;
    color: var(--muted) !important;
    pointer-events: none;
  }
</style>
