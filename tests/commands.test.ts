import { describe, expect, it } from 'vitest';
import { COMMANDS, CommandRegistry } from '../src/lib/commands';
import { MENUS, type MenuEntry } from '../src/editor/menus';

describe('CommandRegistry', () => {
  it('disables commands without an implementation and "later" commands', () => {
    const reg = new CommandRegistry({ 'file.open': { run: () => {} }, 'tools.ocr': { run: () => {} } });
    expect(reg.isEnabled('file.open')).toBe(true);
    expect(reg.isEnabled('file.save')).toBe(false);
    expect(reg.isEnabled('tools.ocr')).toBe(false);
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
