<script lang="ts">
  import type { ProtectionSettings } from '../../lib/settings';
  import { useViewer } from '../../lib/viewer.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const viewer = useViewer();
  const doc = viewer.doc;

  const current = $derived(doc.settings.protection);
  let editing = $state(false);
  let password = $state('');
  let confirm = $state('');
  let show = $state(false);
  // svelte-ignore state_referenced_locally (start from the current permissions)
  let allowPrinting = $state(current?.allowPrinting ?? true);
  // svelte-ignore state_referenced_locally
  let allowCopying = $state(current?.allowCopying ?? true);
  // svelte-ignore state_referenced_locally
  let allowEditing = $state(current?.allowEditing ?? true);

  const tooShort = $derived(password.length > 0 && password.length < 4);
  const mismatch = $derived(confirm.length > 0 && confirm !== password);
  const valid = $derived(password.length >= 4 && password === confirm);

  function apply(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    const protection: ProtectionSettings = { password, allowPrinting, allowCopying, allowEditing };
    doc.editSettings(current ? 'Change password' : 'Protect with password', { ...doc.settings, protection });
    editing = false;
    password = confirm = '';
    viewer.notify('Password set. Save to download the protected PDF.');
  }

  function removeProtection() {
    const { protection: _, ...rest } = doc.settings;
    doc.editSettings('Remove password', rest);
  }
</script>

<PanelHeader title="Protect with password" onClose={() => (viewer.panel = null)} />

{#if current && !editing}
  <div class="panel-form">
    <p><strong>This document will be saved with a password.</strong></p>
    <ul class="perms">
      <li>Printing {current.allowPrinting ? 'allowed' : 'not allowed'}</li>
      <li>Copying text {current.allowCopying ? 'allowed' : 'not allowed'}</li>
      <li>Changes {current.allowEditing ? 'allowed' : 'not allowed'}</li>
    </ul>
    <div class="actions">
      <button type="button" class="btn" onclick={() => (editing = true)}>Change password or permissions</button>
      <button type="button" class="btn" onclick={removeProtection}>Remove password</button>
    </div>
  </div>
{:else}
  <form class="panel-form" onsubmit={apply}>
    <p class="hint">Anyone opening the saved PDF will need this password. Encryption: AES-256.</p>
    <div class="field">
      <label for="pw-new">Password</label>
      <input id="pw-new" type={show ? 'text' : 'password'} bind:value={password} autocomplete="new-password" aria-invalid={tooShort} aria-describedby="pw-hint" />
      <span class="hint" id="pw-hint">{tooShort ? 'Use at least 4 characters (longer is safer).' : 'At least 4 characters.'}</span>
    </div>
    <div class="field">
      <label for="pw-confirm">Repeat password</label>
      <input id="pw-confirm" type={show ? 'text' : 'password'} bind:value={confirm} autocomplete="new-password" aria-invalid={mismatch} />
      {#if mismatch}<span class="error" role="alert">The passwords don't match.</span>{/if}
    </div>
    <label class="option"><input type="checkbox" bind:checked={show} /> Show password</label>
    <fieldset>
      <legend>Allow people with the password to</legend>
      <label class="option"><input type="checkbox" bind:checked={allowPrinting} /> Print</label>
      <label class="option"><input type="checkbox" bind:checked={allowCopying} /> Copy text</label>
      <label class="option"><input type="checkbox" bind:checked={allowEditing} /> Make changes</label>
    </fieldset>
    <p class="hint">Restrictions are honoured by most PDF apps but can't stop every program. The password itself is strong protection.</p>
    <p class="hint"><strong>Write the password down.</strong> If it's lost, the file can't be opened. This app never stores it.</p>
    <div class="actions">
      <button type="submit" class="btn btn-primary" disabled={!valid}>{current ? 'Update protection' : 'Protect'}</button>
      {#if editing}<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>{/if}
    </div>
  </form>
{/if}

<style>
  .perms {
    margin: 0;
    padding-left: var(--space-5);
  }
</style>
