import { describe, expect, it } from 'vitest';
import { COMMANDS, CommandRegistry } from '../src/lib/commands';
import { MENUS, type MenuEntry } from '../src/editor/menus';

describe('CommandRegistry', () => {
  it('disables commands without an implementation and "later" commands', () => {
    const reg = new CommandRegistry({ 'file.open': { run: () => {} }, 'file.exportWord': { run: () => {} } });
    expect(reg.isEnabled('file.open')).toBe(true);
    expect(reg.isEnabled('file.save')).toBe(false);
    expect(reg.isEnabled('file.exportWord')).toBe(false);
  });

  it('runs only enabled commands', () => {
    let ran = 0;
    const reg = new CommandRegistry({ 'view.zoomIn': { run: () => ran++, enabled: () => false } });
    expect(reg.run('view.zoomIn')).toBe(false);
    expect(ran).toBe(0);
  });
});

describe('menus', () => {
  it('only reference known command ids', () => {
    const walk = (entries: MenuEntry[]): string[] =>
      entries.flatMap((e) => (e === '-' ? [] : typeof e === 'string' ? [e] : walk(e.items)));
    for (const id of MENUS.flatMap((m) => walk(m.items))) expect(COMMANDS).toHaveProperty(id);
  });
});

describe('shortcuts', () => {
  it('never assign the same key to two commands', () => {
    const seen = new Map<string, string>();
    for (const [id, meta] of Object.entries(COMMANDS) as [string, { keys?: readonly string[] }][]) {
      for (const k of meta.keys ?? []) {
        expect(seen.get(k), `${k} used by ${seen.get(k)} and ${id}`).toBeUndefined();
        seen.set(k, id);
      }
    }
  });

  it('single-key shortcuts never fire while typing', () => {
    for (const meta of Object.values(COMMANDS) as { keys?: readonly string[]; nativeInFields?: boolean }[]) {
      if (meta.keys?.some((k) => !k.includes('mod+') && k.length <= 7 && k !== 'f11')) expect(meta.nativeInFields).toBe(true);
    }
  });
});

describe('Flatten / lock form', () => {
  it('is in the Tools menu under its new name', () => {
    const tools = MENUS.find((m) => m.label === 'Tools')!;
    const flat = (entries: MenuEntry[]): string[] => entries.flatMap((e) => (e === '-' ? [] : typeof e === 'string' ? [e] : flat(e.items)));
    expect(flat(tools.items)).toContain('tools.flatten');
    expect(COMMANDS['tools.flatten'].label).toBe('Flatten / lock form…');
    expect(Object.values(COMMANDS).some((c) => (c.label as string) === 'Flatten form')).toBe(false);
  });
});

describe('Insert image', () => {
  const flat = (entries: MenuEntry[]): string[] => entries.flatMap((e) => (e === '-' ? [] : typeof e === 'string' ? [e] : flat(e.items)));

  it('comes right after "Insert blank page" in the Page menu (desktop and the phone accordion share it)', () => {
    const page = flat(MENUS.find((m) => m.label === 'Page')!.items);
    expect(page.indexOf('page.insertImage')).toBe(page.indexOf('page.insertBlank') + 1);
    expect(COMMANDS['page.insertImage'].label).toBe('Insert image…');
  });

  it('is in no other menu and has no toolbar tool', async () => {
    const elsewhere = MENUS.filter((m) => m.label !== 'Page').flatMap((m) => flat(m.items));
    expect(elsewhere).not.toContain('page.insertImage');
    const { MARKUP_TOOLS } = await import('../src/editor/tools');
    expect(MARKUP_TOOLS.map((t) => String(t.id))).not.toContain('image');
  });
});

describe('Edit menu', () => {
  const flat = (entries: MenuEntry[]): string[] => entries.flatMap((e) => (e === '-' ? [] : typeof e === 'string' ? [e] : flat(e.items)));

  it('has no Preferences item (desktop and the phone accordion share the menus)', () => {
    expect(Object.values(COMMANDS).some((c) => (c.label as string).startsWith('Preferences'))).toBe(false);
    for (const m of MENUS) expect(flat(m.items).some((id) => id.includes('preferences'))).toBe(false);
  });

  it('never starts or ends a menu with a separator, or has two in a row', () => {
    const check = (items: MenuEntry[]) => {
      expect(items[0]).not.toBe('-');
      expect(items.at(-1)).not.toBe('-');
      items.forEach((e, i) => {
        if (e === '-') expect(items[i + 1]).not.toBe('-');
        if (typeof e === 'object') check(e.items);
      });
    };
    for (const m of MENUS) check(m.items);
    expect(MENUS.find((m) => m.label === 'Edit')!.items.at(-1)).toBe('text.link');
  });
});

describe('New blank PDF', () => {
  it('is the first item of the File menu (desktop and phone share it), with no shortcut', () => {
    const file = MENUS.find((m) => m.label === 'File')!.items;
    expect(file[0]).toBe('file.newBlank');
    expect(file[1]).toBe('file.open');
    expect(file.indexOf('file.createFromImages')).toBe(2);
    expect(COMMANDS['file.newBlank'].label).toBe('New blank PDF…');
    expect((COMMANDS['file.newBlank'] as { keys?: string[] }).keys).toBeUndefined();
  });
});

describe('shortcut hints', () => {
  it('only show keys a web page can actually receive', () => {
    const keys = (id: keyof typeof COMMANDS) => (COMMANDS[id] as { keys?: readonly string[] }).keys ?? [];
    // Browsers keep these for themselves (close tab, new window/tab, tab switching, full screen).
    const reserved = ['mod+w', 'mod+n', 'mod+t', 'mod+shift+n', 'mod+shift+t', 'mod+tab', 'f11'];
    for (const id of Object.keys(COMMANDS) as (keyof typeof COMMANDS)[]) {
      for (const k of keys(id)) expect(reserved, `${id} uses ${k}`).not.toContain(k);
    }
    expect(keys('file.close')).toEqual([]);
    expect(keys('view.fullscreen')).toEqual([]);
  });
});
