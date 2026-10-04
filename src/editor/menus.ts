// Menu bar layout. Entries reference command ids only; behaviour lives in commands.
import type { CommandId } from '../lib/commands';

export type MenuEntry = CommandId | '-' | { label: string; items: MenuEntry[] };

export interface Menu {
  label: string;
  items: MenuEntry[];
}

export const MENUS: Menu[] = [
  {
    label: 'File',
    items: [
      'file.open',
      'file.createFromImages',
      '-',
      'file.save',
      'file.saveCopy',
      { label: 'Export as', items: ['tools.compress', 'file.exportImages', 'file.exportText', 'file.exportWord'] },
      '-',
      'file.print',
      '-',
      'file.close',
    ],
  },
  {
    label: 'Edit',
    items: [
      'edit.undo',
      'edit.redo',
      '-',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.delete',
      '-',
      'edit.selectAll',
      'edit.find',
      '-',
      'edit.preferences',
    ],
  },
  {
    label: 'View',
    items: [
      'view.zoomIn',
      'view.zoomOut',
      'view.fitWidth',
      'view.fitPage',
      'view.actualSize',
      '-',
      'view.singlePage',
      'view.continuous',
      'view.twoPages',
      '-',
      'view.thumbnails',
      'view.panel',
      '-',
      'view.fullscreen',
    ],
  },
  {
    label: 'Page',
    items: [
      'page.rotateLeft',
      'page.rotateRight',
      '-',
      'page.delete',
      'page.extract',
      'page.insertBlank',
      'page.insertFromFile',
      '-',
      'page.crop',
      'page.numbers',
      '-',
      'page.goTo',
    ],
  },
  {
    label: 'Tools',
    items: [
      'tools.compress',
      'tools.merge',
      'tools.split',
      '-',
      'tools.protect',
      'tools.unlock',
      '-',
      'tools.watermark',
      'tools.flatten',
      '-',
      'tools.ocr',
      'tools.compare',
      'tools.redact',
    ],
  },
  {
    label: 'Help',
    items: ['help.guide', 'help.shortcuts', 'help.report', '-', 'help.about'],
  },
];
