<script lang="ts" module>
  export type HelpTopic = 'guide' | 'shortcuts' | 'about';
</script>

<script lang="ts">
  import licenses from 'virtual:licenses';
  import { APP_NAME, APP_VERSION } from '../config';
  import { COMMANDS, formatKeys, isMac, type CommandId, type CommandMeta } from '../lib/commands';
  import { MENUS, type MenuEntry } from './menus';

  let { topic, onClose }: { topic: HelpTopic | null; onClose: () => void } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    if (topic && !dialog.open) dialog.showModal();
    else if (!topic && dialog.open) dialog.close();
  });

  const titles: Record<HelpTopic, string> = {
    guide: 'Quick guide',
    shortcuts: 'Keyboard shortcuts',
    about: `About ${APP_NAME}`,
  };

  const mod = isMac ? '⌘' : 'Ctrl';

  // Menu shortcuts come straight from the command registry, so this list can't drift.
  const menuShortcuts = MENUS.map((menu) => {
    const flat = (entries: MenuEntry[]): CommandId[] =>
      entries.flatMap((e) => (e === '-' ? [] : typeof e === 'string' ? [e] : flat(e.items)));
    const rows = flat(menu.items)
      .map((id) => COMMANDS[id] as CommandMeta)
      .filter((m) => m.keys && !m.later)
      .map((m) => ({ label: m.label.replace('…', ''), keys: m.keys!.map(formatKeys) }));
    return { menu: menu.label, rows };
  }).filter((g) => g.rows.length > 0);

  const otherShortcuts = [
    {
      menu: 'Page thumbnails',
      rows: [
        { label: 'Select several pages', keys: ['Shift+click', `${mod}+click`] },
        { label: 'Move selected pages up / down', keys: ['Alt+↑', 'Alt+↓'] },
        { label: 'Previous / next page', keys: ['↑', '↓'] },
        { label: 'Delete selected pages', keys: ['Delete'] },
        { label: 'Page actions menu', keys: ['Shift+F10'] },
        { label: 'Clear selection', keys: ['Esc'] },
      ],
    },
    {
      menu: 'Search and view',
      rows: [
        { label: 'Next / previous result', keys: ['Enter', 'Shift+Enter'] },
        { label: 'Zoom around the pointer', keys: [`${mod}+scroll`, 'pinch'] },
        { label: 'Turn pages (single / two-page view)', keys: ['← →', 'PgUp', 'PgDn'] },
      ],
    },
  ];
</script>

<dialog bind:this={dialog} aria-labelledby="help-title" oncancel={(e) => { e.preventDefault(); onClose(); }}>
  {#if topic}
    <header>
      <h2 id="help-title">{titles[topic]}</h2>
      <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
    </header>

    <div class="body">
      {#if topic === 'guide'}
        <ul class="guide">
          <li><strong>Your files stay on this device.</strong> Nothing is uploaded or stored. Closing the tab clears everything, so save before you leave.</li>
          <li><strong>Pages:</strong> use the thumbnails on the left. Drag to reorder, right-click for rotate, delete and extract. The <em>Page</em> menu has the same actions.</li>
          <li><strong>Tools:</strong> merge, split and other tools are in the <em>Tools</em> menu and open on the right.</li>
          <li><strong>Mistakes:</strong> everything can be undone with {mod}+Z until you close the document.</li>
          <li><strong>Saving:</strong> <em>File › Save</em> downloads the edited PDF. Your original file is never changed.</li>
          <li><strong>Find text:</strong> {mod}+F, then Enter for the next match.</li>
        </ul>
      {:else if topic === 'shortcuts'}
        {#each [...menuShortcuts, ...otherShortcuts] as group (group.menu)}
          <h3>{group.menu}</h3>
          <table>
            <tbody>
              {#each group.rows as row (row.label)}
                <tr>
                  <th scope="row">{row.label}</th>
                  <td>{#each row.keys as k, i (k)}{#if i > 0}<span class="or"> or </span>{/if}<kbd>{k}</kbd>{/each}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/each}
      {:else}
        <p><strong>{APP_NAME}</strong> version {APP_VERSION}</p>
        <p>Works entirely in your browser. Your files are never uploaded, and nothing is stored after you close the tab.</p>
        <h3>Open-source software</h3>
        <p>Built with these libraries. Thank you to their authors.</p>
        <table>
          <tbody>
            {#each licenses as l (l.name)}
              <tr><th scope="row">{l.name} {l.version}</th><td>{l.license}</td></tr>
            {/each}
          </tbody>
        </table>
        <p><a href="THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">Full license texts</a></p>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 2 * var(--space-4)));
    max-height: min(80vh, 720px);
    padding: 0;
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-bg);
    color: var(--color-text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: var(--border-width) solid var(--color-border);
  }
  h2 {
    font-size: var(--font-size-lg);
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--font-size-sm);
  }
  .close {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--font-size-lg);
  }
  .close:hover {
    background: var(--color-surface-strong);
  }
  .body {
    overflow-y: auto;
    padding: var(--space-2) var(--space-5) var(--space-5);
    font-size: var(--font-size-sm);
  }
  .body > p {
    margin-top: var(--space-3);
  }
  .guide {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-3) 0 0;
    padding-left: var(--space-5);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: var(--space-1) 0;
    border-bottom: var(--border-width) solid var(--color-border);
    text-align: left;
    vertical-align: top;
  }
  th {
    font-weight: 400;
  }
  td {
    text-align: right;
    white-space: nowrap;
  }
  kbd {
    padding: 0 var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font-family: inherit;
    font-size: var(--font-size-xs);
  }
  .or {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }
</style>
