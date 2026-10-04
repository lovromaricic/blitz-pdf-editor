<script lang="ts">
  // Compress: pick a preset or custom settings. Each option shows an honest
  // size estimate, computed by re-encoding the file's images in the worker.
  import { useActions } from '../../lib/actions.svelte';
  import { formatBytes } from '../../lib/files';
  import { isWorthwhile, PRESETS, type CompressLevel, type CompressPreset, type CompressSettings } from '../../lib/pdf/compress';
  import { useViewer } from '../../lib/viewer.svelte';
  import Range from '../../components/Range.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();

  const QUALITY_MIN = 10;
  const QUALITY_MAX = 95;
  const RESOLUTIONS: { value: string; label: string; dpi: number | null }[] = [
    { value: 'original', label: 'Original', dpi: null },
    { value: '300', label: '300 DPI', dpi: 300 },
    { value: '200', label: '200 DPI', dpi: 200 },
    { value: '150', label: '150 DPI', dpi: 150 },
    { value: '96', label: '96 DPI', dpi: 96 },
    { value: '72', label: '72 DPI', dpi: 72 },
  ];

  const presets: { id: CompressPreset; label: string; hint: string }[] = [
    { id: 'light', label: 'Light', hint: 'Best quality, smaller file' },
    { id: 'balanced', label: 'Balanced', hint: 'Good for sharing and email' },
    { id: 'maximum', label: 'Maximum', hint: 'Smallest file, images look softer' },
  ];

  let level = $state<CompressLevel>('balanced');
  /** Custom starts with the Balanced values. Quality in percent. */
  let quality = $state(Math.round(PRESETS.balanced.quality * 100));
  let resolution = $state(String(PRESETS.balanced.dpi));
  let qualityText = $state(String(Math.round(PRESETS.balanced.quality * 100)));
  let qualityError = $state<string | null>(null);

  const customSettings = $derived<CompressSettings>({
    quality: quality / 100,
    dpi: RESOLUTIONS.find((r) => r.value === resolution)?.dpi ?? null,
  });
  const settingsFor = (l: CompressLevel) => (l === 'custom' ? customSettings : PRESETS[l]);

  let info = $state<{ total: number; images: number } | null>(null);
  let presetSizes = $state<Record<CompressPreset, number> | null>(null);
  let presetProgress = $state(0);
  let customSize = $state<number | null>(null);
  let customProgress = $state<number | null>(null);
  let estimateFailed = $state(false);
  let result = $state<{ before: number; after: number; applied: boolean } | null>(null);

  /** The files in use: estimates start over when they change (compress, undo). */
  const sourcesKey = $derived([...new Set(viewer.doc.pages.map((p) => p.sourceId))].join(','));

  // What the file is made of, and the three presets' sizes (one worker job).
  $effect(() => {
    void sourcesKey;
    presetSizes = null;
    estimateFailed = false;
    const controller = new AbortController();
    void actions
      .analyzeCompression()
      .then((list) => {
        if (controller.signal.aborted) return;
        info = { total: list.reduce((n, a) => n + a.totalBytes, 0), images: list.reduce((n, a) => n + a.imageCount, 0) };
      })
      .catch(() => {});
    const ids = presets.map((p) => p.id);
    actions
      .estimateCompression(
        ids.map((id) => PRESETS[id]),
        (p) => (presetProgress = p),
        controller.signal,
      )
      .then((sizes) => (presetSizes = Object.fromEntries(ids.map((id, k) => [id, sizes[k]])) as Record<CompressPreset, number>))
      .catch(() => !controller.signal.aborted && (estimateFailed = true));
    return () => controller.abort();
  });

  /** A preset with the same values already has its size. */
  const samePreset = $derived(
    presets.find((p) => PRESETS[p.id].quality === customSettings.quality && PRESETS[p.id].dpi === customSettings.dpi)?.id,
  );

  // Custom: re-estimate shortly after the settings stop changing; a newer change cancels the older estimate.
  $effect(() => {
    void sourcesKey;
    if (level !== 'custom') return;
    const settings = { ...customSettings };
    customSize = null;
    if (samePreset) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      customProgress = 0;
      actions
        .estimateCompression([settings], (p) => (customProgress = p), controller.signal)
        .then(([size]) => (customSize = size))
        .catch(() => !controller.signal.aborted && (estimateFailed = true))
        .finally(() => !controller.signal.aborted && (customProgress = null));
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
      customProgress = null;
    };
  });

  function sizeOf(l: CompressLevel): number | null {
    if (l !== 'custom') return presetSizes?.[l] ?? null;
    if (samePreset) return presetSizes?.[samePreset] ?? null;
    return customSize;
  }

  /** Every option would save less than the minimum: say so before anyone waits. */
  const cantShrink = $derived(!!info && !!presetSizes && Object.values(presetSizes).every((n) => !isWorthwhile(info!.total, n)));

  // --- Quality number field ------------------------------------------------------

  function setQuality(v: number) {
    quality = v;
    qualityText = String(v);
    qualityError = null;
  }

  function onQualityText(text: string) {
    qualityText = text;
    if (!/^\d+$/.test(text.trim())) {
      qualityError = `Enter a whole number from ${QUALITY_MIN} to ${QUALITY_MAX}.`;
      return;
    }
    const n = Number(text);
    if (n < QUALITY_MIN || n > QUALITY_MAX) {
      qualityError = `Use a value from ${QUALITY_MIN} to ${QUALITY_MAX}.`;
      return;
    }
    qualityError = null;
    quality = n;
  }

  /** Leaving the field: clamp numbers, restore the last valid value otherwise. */
  function onQualityBlur() {
    const n = Number(qualityText.trim());
    if (/^\d+$/.test(qualityText.trim())) setQuality(Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, n)));
    else setQuality(quality);
  }

  async function run() {
    result = (await actions.compress(settingsFor(level))) ?? null;
  }

  /** Back to the options. A compression just applied is undone, so new settings start from the original. */
  function tryAgain() {
    if (result?.applied && viewer.doc.history.undoLabel === 'Compress') viewer.doc.undo();
    result = null;
  }

  const saved = $derived(result ? Math.round((1 - result.after / result.before) * 100) : 0);
  const estimating = $derived(!presetSizes && !estimateFailed);
</script>

<PanelHeader title="Compress PDF" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  {#if result}
    {#if result.applied}
      <p class="result" role="status">
        <strong>{formatBytes(result.before)} to {formatBytes(result.after)}</strong> ({saved}% smaller)
      </p>
      <p class="hint">The document now uses the compressed version. Undo with Ctrl+Z.</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" onclick={() => actions.save()}>Download</button>
        <button type="button" class="btn" onclick={tryAgain}>Try other settings</button>
      </div>
      <p class="hint">Trying other settings starts again from the original.</p>
    {:else}
      <p class="result" role="status"><strong>This file can't be made much smaller.</strong></p>
      <p class="hint">
        Compressing gave about {formatBytes(result.after)}, from {formatBytes(result.before)}. Most of this file is text and drawings,
        which are kept exactly as they are. Your document hasn't been changed.
      </p>
      <div class="actions">
        <button type="button" class="btn" onclick={tryAgain}>Try other settings</button>
      </div>
    {/if}
  {:else}
    <p class="hint">Makes the file smaller by reducing the resolution and quality of photos and images. Text and drawings stay sharp.</p>
    {#if info}
      <p>
        Current size: <strong>about {formatBytes(info.total)}</strong>{info.images ? ` · ${info.images} ${info.images === 1 ? 'image' : 'images'}` : ' · no photos'}
      </p>
    {/if}
    {#if estimating}
      <div class="estimating" role="status">
        <span>Estimating sizes…</span>
        <progress max="1" value={presetProgress || undefined} aria-label="Estimating sizes"></progress>
      </div>
    {:else if estimateFailed}
      <p class="hint" role="status">Couldn't estimate the sizes, but you can still compress.</p>
    {/if}
    {#if cantShrink}
      <p class="note" role="status">
        This file can't be made much smaller: most of it is text and drawings, which compression keeps exactly as they are.
      </p>
    {/if}

    <fieldset>
      <legend>Quality</legend>
      {#each [...presets, { id: 'custom' as const, label: 'Custom', hint: 'Choose image quality and resolution' }] as l (l.id)}
        {@const size = sizeOf(l.id)}
        <div class="choice" class:selected={level === l.id}>
          <label class="choice-head">
            <input type="radio" name="compress-level" value={l.id} bind:group={level} />
            <span class="choice-text">
              <span class="choice-title">
                <strong>{l.label}</strong>
                <span class="estimate">
                  {#if size !== null}about {formatBytes(size)}{:else if !estimateFailed}Calculating…{/if}
                </span>
              </span>
              <span class="hint">{l.hint}</span>
            </span>
          </label>

          {#if l.id === 'custom' && level === 'custom'}
            <div class="custom">
              <div class="field">
                <label for="compress-quality-number">Image quality</label>
                <div class="quality-row">
                  <Range
                    id="compress-quality"
                    min={QUALITY_MIN}
                    max={QUALITY_MAX}
                    step={5}
                    value={quality}
                    label="Image quality"
                    valueText="{quality}%"
                    onInput={setQuality}
                  />
                  <span class="number">
                    <input
                      id="compress-quality-number"
                      type="text"
                      inputmode="numeric"
                      value={qualityText}
                      aria-invalid={!!qualityError}
                      aria-describedby={qualityError ? 'compress-quality-error' : undefined}
                      oninput={(e) => onQualityText(e.currentTarget.value)}
                      onblur={onQualityBlur}
                      onkeydown={(e) => e.key === 'Enter' && onQualityBlur()}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </div>
                {#if qualityError}<p class="error" id="compress-quality-error">{qualityError}</p>{/if}
              </div>
              <div class="field">
                <label for="compress-resolution">Maximum image resolution</label>
                <select id="compress-resolution" bind:value={resolution}>
                  {#each RESOLUTIONS as r (r.value)}
                    <option value={r.value}>{r.label}</option>
                  {/each}
                </select>
              </div>
              {#if customProgress !== null}
                <div class="estimating" role="status">
                  <span>Estimating…</span>
                  <progress max="1" value={customProgress || undefined} aria-label="Estimating size"></progress>
                </div>
              {/if}
              <p class="hint">Lower quality and resolution make a smaller file, but images look softer.</p>
            </div>
          {/if}
        </div>
      {/each}
    </fieldset>
    <div class="actions">
      <button type="button" class="btn btn-primary" disabled={!!viewer.task || (level === 'custom' && !!qualityError)} onclick={run}>Compress</button>
    </div>
    <p class="hint">Sizes are estimates. You can cancel while it runs, and undo afterwards.</p>
  {/if}
</div>

<style>
  .result {
    margin: 0;
  }
  .note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .estimating {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  .estimating progress {
    flex: 1;
    height: 6px;
    accent-color: var(--accent);
  }
  .choice {
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .choice.selected {
    border-color: var(--accent);
  }
  .choice-head {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    padding: var(--space-2);
    font-weight: 400;
    cursor: pointer;
  }
  .choice-head input {
    margin-top: 2px;
  }
  .choice-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .choice-title {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .estimate {
    color: var(--muted);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .custom {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: var(--border-width) solid var(--border);
  }
  .quality-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .number {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-1);
    color: var(--muted);
  }
  .number input {
    width: 3.5rem;
    text-align: right;
  }
  .error {
    margin: 0;
  }
</style>
