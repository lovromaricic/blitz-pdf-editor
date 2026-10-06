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
      'file.newBlank',
      'file.open',
      'file.createFromImages',
      '-',
      'file.save',
      'file.saveCopy',
      { label: 'Export as', items: ['tools.compress', 'file.exportImages', 'file.exportText'] },
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
      'edit.duplicate',
      'edit.delete',
      { label: 'Order', items: ['object.bringToFront', 'object.bringForward', 'object.sendBackward', 'object.sendToBack'] },
      '-',
      'edit.selectAll',
      'edit.find',
      '-',
      'text.link',
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
      'view.margins',
      'view.keepInMargins',
      'view.smartGuides',
      { label: 'Margin size', items: ['view.margin6', 'view.margin12', 'view.margin20', 'view.margin25'] },
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
      'page.insertImage',
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
