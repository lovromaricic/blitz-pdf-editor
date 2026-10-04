<script lang="ts">
  import { useActions } from '../../lib/actions.svelte';
  import type { PageRef } from '../../lib/document.svelte';
  import { OCR_LANGUAGES, pagesWithoutText, type OcrLanguage } from '../../lib/ocr';
  import { formatPageRange } from '../../lib/page-ops';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();
  const doc = viewer.doc;

  let scans = $state<PageRef[] | null>(null);
  let scope = $state<'scans' | 'targets' | 'all'>('scans');
  let languages = $state<OcrLanguage[]>(['eng']);

  // Find pages without a text layer (likely scans).
  $effect(() => {
    let cancelled = false;
    void pagesWithoutText(doc, doc.pages).then((found) => {
      if (cancelled) return;
      scans = found;
      if (found.length === 0) scope = 'targets';
    });
    return () => {
      cancelled = true;
    };
  });

  const targets = $derived(viewer.targetPages());
  const pages = $derived(scope === 'scans' ? (scans ?? []) : scope === 'all' ? doc.pages : targets);
  const range = (list: readonly PageRef[]) => formatPageRange(list.map((p) => doc.pages.indexOf(p)));

  function toggle(lang: OcrLanguage, on: boolean) {
    languages = on ? [...new Set([...languages, lang])] : languages.filter((l) => l !== lang);
  }
</script>

<PanelHeader title="Make text searchable" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  <p class="hint">
    Recognizes the text in scanned pages (OCR) and adds it invisibly, so you can search, select and copy it. The pages look exactly
    the same. Everything runs on this device.
  </p>

  <fieldset>
    <legend>Pages</legend>
    <label class="option">
      <input type="radio" name="ocr-scope" value="scans" bind:group={scope} disabled={!scans?.length} />
      {#if scans === null}
        Pages without text (checking…)
      {:else if scans.length}
        Pages without text ({range(scans)})
      {:else}
        Pages without text (none found)
      {/if}
    </label>
    <label class="option">
      <input type="radio" name="ocr-scope" value="targets" bind:group={scope} />
      {targets.length === 1 ? 'Current page' : 'Selected pages'} ({range(targets)})
    </label>
    <label class="option">
      <input type="radio" name="ocr-scope" value="all" bind:group={scope} />
      All pages
    </label>
  </fieldset>

  <fieldset>
    <legend>Language of the text</legend>
    {#each OCR_LANGUAGES as l (l.id)}
      <label class="option">
        <input type="checkbox" checked={languages.includes(l.id)} onchange={(e) => toggle(l.id, e.currentTarget.checked)} />
        {l.label}
      </label>
    {/each}
  </fieldset>

  <div class="actions">
    <button
      type="button"
      class="btn btn-primary"
      disabled={!pages.length || !languages.length || !!viewer.task}
      onclick={() => actions.ocr(pages, languages)}
    >
      Recognize text{pages.length ? ` on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` : ''}
    </button>
  </div>
  <p class="hint">Takes a few seconds per page. The first run loads the recognition engine (about 7 MB) from this site.</p>
</div>
