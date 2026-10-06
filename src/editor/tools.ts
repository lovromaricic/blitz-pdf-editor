// The markup tools, in toolbar order, with their Lucide icons (ISC licence).
// Shared by the desktop floating toolbar and the mobile tool strip.
import type { Component } from 'svelte';
import FilePenLine from '@lucide/svelte/icons/file-pen-line';
import Highlighter from '@lucide/svelte/icons/highlighter';
import MessageSquare from '@lucide/svelte/icons/message-square';
import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
import Pen from '@lucide/svelte/icons/pen';
import Shapes from '@lucide/svelte/icons/shapes';
import Signature from '@lucide/svelte/icons/signature';
import SquareCheck from '@lucide/svelte/icons/square-check';
import Stamp from '@lucide/svelte/icons/stamp';
import Type from '@lucide/svelte/icons/type';
import type { Tool } from '../lib/viewer.svelte';

export const MARKUP_TOOLS: { id: Tool; label: string; icon: Component; tip?: string; desktopOnly?: boolean }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  // The PDF's own text and images.
  { id: 'content', label: 'Edit content', tip: 'Edit text and images', icon: FilePenLine },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'draw', label: 'Draw', icon: Pen },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'stamp', label: 'Stamp', icon: Stamp },
  { id: 'comment', label: 'Comment', icon: MessageSquare },
  { id: 'sign', label: 'Sign', icon: Signature },
  { id: 'form', label: 'Fill form', icon: SquareCheck },
];

/** Icon size and stroke used across the app (Lucide style). */
export const ICON = { size: 20, strokeWidth: 1.7 } as const;
