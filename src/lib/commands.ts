// Command registry. Every user-facing action has exactly one command id.
// Menus, keyboard shortcuts, context menus and toolbar shortcuts all invoke
// commands by id, so each feature is built once.

export interface CommandMeta {
  label: string;
  /** Key combos, e.g. 'mod+shift+z'. The first one is shown in menus. */
  keys?: string[];
  /** Not in version 1: always disabled, marked "Later" in menus. */
  later?: boolean;
  /** Let the browser handle this shortcut while typing in a text field. */
  nativeInFields?: boolean;
}

export interface CommandImpl {
  run: () => void;
  /** Overrides the menu label, e.g. "Undo Rotate right". */
  label?: () => string;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export const COMMANDS = {
  // File
  'file.open': { label: 'Open…', keys: ['mod+o'] },
  'file.createFromImages': { label: 'Create PDF from images…' },
  'file.save': { label: 'Save', keys: ['mod+s'] },
  'file.saveCopy': { label: 'Save a copy…', keys: ['mod+shift+s'] },
  'file.exportImages': { label: 'Images (JPG / PNG)…' },
  'file.exportText': { label: 'Plain text' },
  'file.exportWord': { label: 'Word', later: true },
  'file.print': { label: 'Print…', keys: ['mod+p'] },
  'file.close': { label: 'Close', keys: ['mod+w'] },

  // Edit
  'edit.undo': { label: 'Undo', keys: ['mod+z'], nativeInFields: true },
  'edit.redo': { label: 'Redo', keys: ['mod+shift+z', 'mod+y'], nativeInFields: true },
  'edit.cut': { label: 'Cut', keys: ['mod+x'], nativeInFields: true },
  'edit.copy': { label: 'Copy', keys: ['mod+c'], nativeInFields: true },
  'edit.paste': { label: 'Paste', keys: ['mod+v'], nativeInFields: true },
  'edit.delete': { label: 'Delete', keys: ['delete', 'backspace'], nativeInFields: true },
  'edit.selectAll': { label: 'Select all', keys: ['mod+a'], nativeInFields: true },
  'edit.find': { label: 'Find…', keys: ['mod+f'] },
  'edit.preferences': { label: 'Preferences…' },

  // View
  'view.zoomIn': { label: 'Zoom in', keys: ['mod+=', 'mod++'] },
  'view.zoomOut': { label: 'Zoom out', keys: ['mod+-'] },
  'view.fitWidth': { label: 'Fit width' },
  'view.fitPage': { label: 'Fit page' },
  'view.actualSize': { label: 'Actual size', keys: ['mod+0'] },
  'view.singlePage': { label: 'Single page' },
  'view.continuous': { label: 'Continuous scroll' },
  'view.twoPages': { label: 'Two pages side by side' },
  'view.thumbnails': { label: 'Show page thumbnails' },
  'view.panel': { label: 'Show properties panel' },
  'view.fullscreen': { label: 'Full screen', keys: ['f11'] },

  // Page
  'page.rotateLeft': { label: 'Rotate left' },
  'page.rotateRight': { label: 'Rotate right' },
  'page.delete': { label: 'Delete pages' },
  'page.extract': { label: 'Extract pages…' },
  'page.insertBlank': { label: 'Insert blank page' },
  'page.insertFromFile': { label: 'Insert pages from file…' },
  'page.crop': { label: 'Crop pages…' },
  'page.numbers': { label: 'Add page numbers…' },
  'page.goTo': { label: 'Go to page…', keys: ['mod+g'] },

  // Tools
  'tools.compress': { label: 'Compress PDF…' },
  'tools.merge': { label: 'Merge PDFs…' },
  'tools.split': { label: 'Split PDF…' },
  'tools.protect': { label: 'Protect with password…' },
  'tools.unlock': { label: 'Remove password…' },
  'tools.watermark': { label: 'Add watermark…' },
  'tools.flatten': { label: 'Flatten form' },
  'tools.ocr': { label: 'Make text searchable (OCR)…' },
  'tools.compare': { label: 'Compare two PDFs…' },
  'tools.redact': { label: 'Redact content…' },

  // Help
  'help.guide': { label: 'Quick guide' },
  'help.shortcuts': { label: 'Keyboard shortcuts', keys: ['shift+?', '?'], nativeInFields: true },
  'help.report': { label: 'Report a problem' },
  'help.about': { label: 'About' },

  // Markup tools (toolbar, not menus). Single keys, ignored while typing.
  'tool.select': { label: 'Select', keys: ['v'], nativeInFields: true },
  'tool.text': { label: 'Text', keys: ['t'], nativeInFields: true },
  'tool.highlight': { label: 'Highlight', keys: ['h'], nativeInFields: true },
  'tool.draw': { label: 'Draw', keys: ['d'], nativeInFields: true },
  'tool.shapes': { label: 'Shapes', keys: ['s'], nativeInFields: true },
  'tool.stamp': { label: 'Stamp', keys: ['p'], nativeInFields: true },
  'tool.comment': { label: 'Comment', keys: ['c'], nativeInFields: true },
  'tool.sign': { label: 'Sign', keys: ['g'], nativeInFields: true },
  'tool.form': { label: 'Fill form', keys: ['f'], nativeInFields: true },
} as const satisfies Record<string, CommandMeta>;

export type CommandId = keyof typeof COMMANDS;

export type CommandImpls = Partial<Record<CommandId, CommandImpl>>;

export class CommandRegistry {
  constructor(private impls: CommandImpls) {}

  meta(id: CommandId): CommandMeta {
    return COMMANDS[id];
  }

  label(id: CommandId): string {
    return this.impls[id]?.label?.() ?? COMMANDS[id].label;
  }

  /** Has an implementation (it may still be disabled right now). */
  isBuilt(id: CommandId): boolean {
    return !!this.impls[id] && !(COMMANDS[id] as CommandMeta).later;
  }

  /** Built and currently usable. Commands with no implementation yet are disabled. */
  isEnabled(id: CommandId): boolean {
    const impl = this.impls[id];
    if (!impl || (COMMANDS[id] as CommandMeta).later) return false;
    return impl.enabled ? impl.enabled() : true;
  }

  isChecked(id: CommandId): boolean | undefined {
    return this.impls[id]?.checked?.();
  }

  run(id: CommandId): boolean {
    if (!this.isEnabled(id)) return false;
    this.impls[id]!.run();
    return true;
  }

  /** Handle a keydown. Returns true if a command ran. */
  handleKey(e: KeyboardEvent): boolean {
    const combo = comboFromEvent(e);
    if (!combo) return false;
    const inField = isTextField(e.target);
    for (const id of Object.keys(COMMANDS) as CommandId[]) {
      const meta: CommandMeta = COMMANDS[id];
      if (!meta.keys?.includes(combo)) continue;
      if (inField && meta.nativeInFields) return false;
      if (!this.isEnabled(id)) continue;
      e.preventDefault();
      this.run(id);
      return true;
    }
    return false;
  }
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.shiftKey && key !== '+') parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

/** Human-readable shortcut, e.g. 'Ctrl+Shift+S' or '⇧⌘S'. */
export function formatKeys(combo: string): string {
  const parts = combo.split('+').filter(Boolean);
  // 'mod++' splits into ['mod'], restore the plus key.
  if (combo.endsWith('++')) parts.push('+');
  const key = parts[parts.length - 1];
  const keyLabel = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  const mods = parts.slice(0, -1);
  if (isMac) {
    const sym: Record<string, string> = { shift: '⇧', alt: '⌥', mod: '⌘' };
    return ['alt', 'shift', 'mod'].filter((m) => mods.includes(m)).map((m) => sym[m]).join('') + keyLabel;
  }
  const name: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' };
  return [...['mod', 'shift', 'alt'].filter((m) => mods.includes(m)).map((m) => name[m]), keyLabel].join('+');
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'color'].includes(target.type);
  }
  return false;
}
