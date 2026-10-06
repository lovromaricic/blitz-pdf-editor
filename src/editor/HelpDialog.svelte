<script lang="ts" module>
  export type HelpTopic = 'guide' | 'shortcuts' | 'about';
</script>

<script lang="ts">
  import { tabRing } from '../lib/focus';
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
      menu: 'Tools',
      rows: (Object.keys(COMMANDS) as CommandId[])
        .filter((id) => id.startsWith('tool.'))
        .map((id) => ({ label: COMMANDS[id].label, keys: (COMMANDS[id] as CommandMeta).keys!.map(formatKeys) })),
    },
    {
      menu: 'Typing in a text box',
      rows: [
        { label: 'Bold / italic / underline', keys: [`${mod}+B`, `${mod}+I`, `${mod}+U`] },
        { label: 'Add or edit a link', keys: [`${mod}+K`] },
        { label: 'Bulleted / numbered list', keys: [`${mod}+Shift+8`, `${mod}+Shift+7`, '- or 1. then space'] },
        { label: 'List item one level in / out', keys: ['Tab', 'Shift+Tab'] },
        { label: 'Leave a list (in an empty item)', keys: ['Enter'] },
        { label: 'Open the link at the cursor', keys: ['Alt+Enter', `${mod}+click`] },
        { label: 'New paragraph', keys: ['Enter'] },
        { label: 'Finish typing', keys: ['Esc', `${mod}+Enter`] },
      ],
    },
    {
      menu: 'Objects on the page',
      rows: [
        { label: 'Object menu (cut, copy, group, order, delete…)', keys: ['Shift+F10', 'Menu key', 'right-click'] },
        { label: 'Select several objects', keys: ['Shift+click', `${mod}+click`, 'drag on the page'] },
        { label: 'All objects on the page', keys: [`${mod}+A`] },
        { label: 'Select the object underneath (again: further down)', keys: ['Alt+click'] },
        { label: 'Move without snapping to guides', keys: [`${isMac ? 'Option' : 'Alt'}+drag`] },
        { label: 'Next / previous object on the page, bottom first', keys: ['Tab', 'Shift+Tab'] },
        { label: 'Move the selected object (Shift: 10× further)', keys: ['← ↑ → ↓', 'Shift+arrows'] },
      ],
    },
    {
      menu: 'Editing the PDF’s own text and images',
      rows: [
        { label: 'Edit content (the tool)', keys: ['E'] },
        { label: 'Edit text, select an image (with the Select tool)', keys: ['double-click', 'double-tap'] },
        { label: 'Next / previous text block or image, in reading order', keys: ['Tab', 'Shift+Tab'] },
        { label: 'Select several', keys: ['Shift+click'] },
        { label: 'Edit the selected text', keys: ['Enter', 'double-click'] },
        { label: 'Delete from the PDF', keys: ['Delete', 'Backspace'] },
        { label: 'Back to the tool before (after a double-click)', keys: ['Esc', 'click an empty spot'] },
      ],
    },
    {
      menu: 'Cropping an image',
      rows: [
        { label: 'Start cropping the selected image', keys: ['double-click', 'Crop button', 'right-click › Crop…'] },
        { label: 'Move the image under the frame (Shift: 10× further)', keys: ['← ↑ → ↓', 'Shift+arrows'] },
        { label: 'Resize the frame from its bottom-right corner', keys: [`${isMac ? 'Option' : 'Alt'}+arrows`] },
        { label: 'To the crop options in the panel', keys: ['Tab'] },
        { label: 'Apply the crop', keys: ['Enter', 'click outside the image'] },
        { label: 'Cancel', keys: ['Esc'] },
      ],
    },
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

    <!-- Focusable so the content can be scrolled with the keyboard. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="body" {@attach tabRing} tabindex="0" role="region" aria-labelledby="help-title">
      {#if topic === 'guide'}
        <ul class="guide">
          <li><strong>Your files stay on this device.</strong> Nothing is uploaded or stored. Closing the tab clears everything, so save before you leave.</li>
          <li><strong>Pages:</strong> use the thumbnails on the left. Drag to reorder, right-click for rotate, delete and extract. The <em>Page</em> menu has the same actions.</li>
          <li><strong>New PDF:</strong> <em>File › New blank PDF</em> starts a document from empty pages (A4, US Letter, A5, Legal or your own size). It opens as "Untitled.pdf".</li>
          <li><strong>Images:</strong> <em>Page › Insert image</em> puts a picture on the current page; you can also drag an image file onto a page or paste one with {mod}+V. Drag it, its corners and its round handle to move, resize and rotate; the panel on the right has exact sizes, flip, opacity and order.</li>
          <li><strong>Editing the PDF’s own text and images:</strong> double-click text or an image on the page (or pick <em>Edit content</em> in the toolbar, E). Text becomes a text box you can change (set in Arimo, Tinos or Cousine, the closest match to the original font); Delete removes text or an image from the PDF itself, not just from view, together with hidden copies such as its accessibility text. Undo brings back the original exactly. Turned or vertical text, superscripts and some mixed text can only be deleted; lines and shapes can't be edited yet. Saving writes the whole file again, so earlier versions kept inside it are gone too.</li>
          <li><strong>Cropping images:</strong> double-click an image (or use <em>Crop</em> in its panel, or right-click › <em>Crop…</em>). Drag the frame's handles, drag the image to choose what shows, pick a ratio in the panel, then press Enter or click outside it. Nothing is lost until you save: crop again to bring back what you cut off, or use <em>Reset crop</em>. The saved PDF keeps only the cropped part.</li>
          <li><strong>Text:</strong> pick the Text tool and click on the page. Select words to make them bold, bigger or another colour with the panel on the right; with no words selected, the panel sets how the next words look.</li>
          <li><strong>Lists:</strong> type "- " or "1. " at the start of a line, or use the List buttons in the panel. Tab and Shift+Tab change an item's level (up to three); Enter on an empty item ends the list.</li>
          <li><strong>Links:</strong> select words and press {mod}+K (or <em>Edit › Add link</em>) to link them to a web or email address or to a page of this document. Typing an address followed by a space links it too ({mod}+Z undoes just the link). In the saved PDF the links are clickable; links to a page move with that page, and go away if it's deleted. Links in opened PDFs open with {mod}+click while the Select tool is on.</li>
          <li><strong>Several objects:</strong> Shift+click them, or drag across them from an empty part of the page. They move, copy and delete together. To keep them together, right-click and choose <em>Group</em>; <em>Ungroup</em> (same menu) separates them again.</li>
          <li><strong>Tools:</strong> merge, split and other tools are in the <em>Tools</em> menu and open on the right.</li>
          <li><strong>Mistakes:</strong> everything can be undone with {mod}+Z until you close the document.</li>
          <li><strong>Saving:</strong> <em>File › Save</em> downloads the edited PDF. Your original file is never changed.</li>
          <li><strong>Find text:</strong> {mod}+F, then Enter for the next match. Scanned pages need <em>Tools › Make text searchable</em> first.</li>
          <li><strong>Forms:</strong> fill fields with the Fill form tool. <em>Tools › Flatten / lock form</em> makes the answers permanent; you download the result as a new "-flattened" copy, and your original file stays as it is.</li>
          <li><strong>Redact:</strong> <em>Tools › Redact content</em> blacks out areas or every match of a word, and removes what's underneath from the file.</li>
          <li><strong>Compare:</strong> <em>Tools › Compare two PDFs</em> shows the open document next to another file, with the words that differ highlighted.</li>
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
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: var(--border-width) solid var(--border);
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
    background: var(--surface-2);
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
    border-bottom: var(--border-width) solid var(--border);
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
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-family: inherit;
    font-size: var(--font-size-xs);
  }
  .or {
    color: var(--muted);
    font-size: var(--font-size-xs);
  }
  /* The scrollable text shows a ring only when reached with Tab (focus.ts). */
  .body:focus-visible {
    outline: none;
  }
  .body:global([data-tab-focus]):focus-visible {
    outline: var(--focus-ring);
    outline-offset: -2px;
  }
</style>
