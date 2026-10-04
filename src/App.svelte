<script lang="ts">
  import { app } from './lib/app-state.svelte';
  import { loadEditorModules } from './lib/open-files.svelte';
  import Home from './screens/Home.svelte';
  import PasswordDialog from './components/PasswordDialog.svelte';

  // The editor (and PDF.js inside it) is a separate chunk, fetched in the background
  // once the Home screen is up so it's ready by the time a file is chosen.
  const loadEditor = () => import('./screens/Editor.svelte');
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
  idle(() => {
    void loadEditor();
    void loadEditorModules();
  });
</script>

{#if app.doc}
  {#await loadEditor() then { default: Editor }}
    {#key app.doc}
      <Editor doc={app.doc} />
    {/key}
  {/await}
{:else}
  <Home />
{/if}

<PasswordDialog />
