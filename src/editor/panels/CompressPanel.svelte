<script lang="ts">
  import { useActions } from '../../lib/actions.svelte';
  import { formatBytes } from '../../lib/files';
  import type { Analysis, CompressLevel } from '../../lib/pdf/compress';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const actions = useActions();

  let level = $state<CompressLevel>('balanced');
  let analysis = $state<{ total: number; images: number; estimates: Record<CompressLevel, number> } | null>(null);
  let failed = $state(false);
  let result = $state<{ before: number; after: number } | null>(null);

  const levels: { id: CompressLevel; label: string; hint: string }[] = [
    { id: 'light', label: 'Light', hint: 'Best quality, smaller file' },
    { id: 'balanced', label: 'Balanced', hint: 'Good for sharing and email' },
    { id: 'maximum', label: 'Maximum', hint: 'Smallest file, images look softer' },
  ];

  $effect(() => {
    let cancelled = false;
    actions
      .analyzeCompression()
      .then((list: Analysis[]) => {
        if (cancelled) return;
        const sum = (f: (a: Analysis) => number) => list.reduce((n, a) => n + f(a), 0);
        analysis = {
          total: sum((a) => a.totalBytes),
          images: sum((a) => a.imageCount),
          estimates: {
            light: sum((a) => a.estimates.light),
            balanced: sum((a) => a.estimates.balanced),
            maximum: sum((a) => a.estimates.maximum),
          },
        };
      })
      .catch(() => !cancelled && (failed = true));
    return () => {
      cancelled = true;
    };
  });

  async function run() {
    result = (await actions.compress(level)) ?? null;
  }

  const saved = $derived(result ? Math.round((1 - result.after / result.before) * 100) : 0);
</script>

<PanelHeader title="Compress PDF" onClose={() => (viewer.panel = null)} />

<div class="panel-form">
  {#if result}
    {#if result.after < result.before}
      <p><strong>{formatBytes(result.before)} → {formatBytes(result.after)}</strong> ({saved}% smaller)</p>
      <p class="hint">The document now uses the compressed version. Undo with Ctrl+Z.</p>
    {:else}
      <p>This PDF is already compact; compressing didn't make it smaller.</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn btn-primary" onclick={() => actions.save()}>Download</button>
      <button type="button" class="btn" onclick={() => (result = null)}>Try another level</button>
    </div>
  {:else}
    <p class="hint">Makes the file smaller by reducing the resolution and quality of photos and images. Text stays sharp.</p>
    {#if failed}
      <p class="hint">Couldn't estimate the result, but you can still compress.</p>
    {:else if !analysis}
      <p class="hint" aria-live="polite">Checking the file…</p>
    {:else}
      <p>Current size: <strong>{formatBytes(analysis.total)}</strong>{analysis.images ? ` · ${analysis.images} ${analysis.images === 1 ? 'image' : 'images'}` : ''}</p>
      {#if analysis.images === 0}
        <p class="hint">No images to shrink: the gain will be small.</p>
      {/if}
    {/if}
    <fieldset>
      <legend>Quality</legend>
      {#each levels as l (l.id)}
        <label class="choice">
          <input type="radio" name="compress-level" value={l.id} bind:group={level} />
          <span>
            <strong>{l.label}</strong>
            {#if analysis}<span class="estimate">about {formatBytes(analysis.estimates[l.id])}</span>{/if}
            <span class="hint">{l.hint}</span>
          </span>
        </label>
      {/each}
    </fieldset>
    <div class="actions">
      <button type="button" class="btn btn-primary" disabled={!!viewer.task} onclick={run}>Compress</button>
    </div>
  {/if}
</div>

<style>
  .choice {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    font-weight: 400;
  }
  .choice span {
    display: grid;
  }
  .estimate {
    font-size: var(--font-size-xs);
  }
</style>
