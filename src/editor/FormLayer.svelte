<script lang="ts">
  // PDF.js's annotation layer: fillable form fields and clickable links.
  // Values typed here live in PDF.js's annotation storage until saved.
  import { AnnotationLayer, type PDFPageProxy, type PageViewport } from 'pdfjs-dist';
  import type { PageRef, Source } from '../lib/document.svelte';
  import { fieldObjects } from '../lib/forms';
  import { useViewer } from '../lib/viewer.svelte';
  import { isMac } from '../lib/commands';
  import { isSafeHref, openExternal } from '../lib/links';

  let { pdfPage, viewport, page, source }: { pdfPage: PDFPageProxy; viewport: PageViewport; page: PageRef; source: Source } = $props();

  const viewer = useViewer();
  let host: HTMLDivElement;

  /** The minimum of PDF.js's link service: internal links jump within our page list. */
  function linkService() {
    const doc = viewer.doc;
    const goToSourceIndex = (index: number) => {
      const i = doc.pages.findIndex((p) => p.sourceId === source.id && p.sourceIndex === index);
      if (i >= 0) viewer.goToPage(i);
    };
    return {
      eventBus: null,
      externalLinkEnabled: true,
      addLinkAttributes(link: HTMLAnchorElement, url: string) {
        // Only addresses we would open get an href at all (javascript:, data:, file: … don't).
        if (isSafeHref(url)) link.href = url;
        link.title = `${url}\n${isMac ? '⌘' : 'Ctrl'}+click to open`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow';
      },
      getDestinationHash: () => '#',
      getAnchorUrl: () => '#',
      async goToDestination(dest: string | unknown[]) {
        const explicit = typeof dest === 'string' ? await source.pdf.getDestination(dest) : dest;
        const target = explicit?.[0];
        if (target == null) return;
        const index = typeof target === 'number' ? target : await source.pdf.getPageIndex(target as never);
        goToSourceIndex(index);
      },
      executeNamedAction(action: string) {
        if (action === 'NextPage') viewer.nextPage();
        else if (action === 'PrevPage') viewer.previousPage();
        else if (action === 'FirstPage') viewer.goToPage(0);
        else if (action === 'LastPage') viewer.goToPage(doc.pages.length - 1);
      },
      executeSetOCGState() {},
    };
  }

  interface FieldInfo {
    id: string;
    fieldName?: string;
    alternativeText?: string;
    buttonValue?: string;
    radioButton?: boolean;
  }

  /**
   * Give every field an accessible name. PDFs often lack field descriptions
   * (/TU); then we fall back to a readable version of the field's name.
   */
  function labelFields(annotations: FieldInfo[]) {
    for (const a of annotations) {
      if (!a.fieldName) continue;
      for (const el of host.querySelectorAll<HTMLElement>(`[data-element-id="${a.id}"]`)) {
        if (el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.length) continue;
        const base = a.alternativeText || humanize(a.fieldName);
        el.setAttribute('aria-label', a.radioButton && a.buttonValue ? `${base}: ${humanize(a.buttonValue)}` : base);
      }
    }
  }

  function humanize(name: string) {
    const last = name.split('.').pop() ?? name;
    const words = last.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  let fieldsPromise: Promise<Map<string, object[]>> | null = null;
  function fields() {
    fieldsPromise ??= fieldObjects(source.pdf).then((list) => new Map(list as [string, object[]][]));
    return fieldsPromise;
  }

  /**
   * Links in the PDF open only with Cmd/Ctrl+click (or Cmd/Ctrl+Enter) while
   * the Select tool is active: a plain click is for selecting and marking up.
   * Web links open through the same checks as links in text boxes.
   */
  function onLinkClick(e: MouseEvent) {
    const a = (e.target as Element).closest?.('.linkAnnotation a');
    if (!a) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || viewer.tool !== 'select') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const href = (a as HTMLAnchorElement).getAttribute('href');
    // Page links ("#") are PDF.js's own; it moves to the page.
    if (!href || href === '#') return;
    e.preventDefault();
    e.stopPropagation();
    if (!openExternal(href)) viewer.notify("This link can't be opened: only web, email and phone links are allowed.");
  }

  $effect(() => {
    host.addEventListener('click', onLinkClick, true);
    return () => host.removeEventListener('click', onLinkClick, true);
  });

  $effect(() => {
    const vp = viewport.clone({ dontFlip: true });
    const flattened = !!page.flattenForm;
    let cancelled = false;
    host.replaceChildren();
    (async () => {
      const annotations = await pdfPage.getAnnotations({ intent: 'display' });
      if (cancelled || annotations.length === 0) return;
      const layer = new AnnotationLayer({
        div: host,
        page: pdfPage,
        viewport: vp,
        linkService: linkService(),
        annotationStorage: source.pdf.annotationStorage,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        structTreeLayer: null,
        commentManager: null,
      });
      await layer.render({
        div: host,
        page: pdfPage,
        viewport: vp,
        annotations,
        linkService: linkService() as never,
        annotationStorage: source.pdf.annotationStorage,
        // Flattened pages show their values on the canvas instead.
        renderForms: !flattened,
        fieldObjects: await fields(),
        enableScripting: false,
        hasJSActions: false,
        imageResourcesPath: '',
      });
      labelFields(annotations as FieldInfo[]);
    })().catch(() => {
      // A broken annotation shouldn't stop the page from showing.
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="annotationLayer" class:fill-mode={viewer.tool === 'form'} bind:this={host}></div>

<style>
  .annotationLayer {
    --scale-round-x: 1px;
    --scale-round-y: 1px;
    z-index: 3;
  }
  /* One focus ring, the app's own, instead of PDF.js's border plus outline. */
  /* Specific enough to beat PDF.js's per-widget :focus and :hover rules (its nested CSS weighs more than it looks). */
  .annotationLayer.annotationLayer :global(section:is(.textWidgetAnnotation, .choiceWidgetAnnotation, .buttonWidgetAnnotation) :is(input, textarea, select):focus) {
    border-color: transparent;
    outline: var(--focus-ring);
    outline-offset: 1px;
  }
  /* The Fill form tool makes empty fields easier to spot. */
  .fill-mode :global(:is(input, textarea, select):not(:focus)) {
    outline: 1px dashed var(--border);
  }
</style>
