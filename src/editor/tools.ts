// The markup tools, in toolbar order. Shared by the desktop toolbar and the mobile tool strip.
import type { Tool } from '../lib/viewer.svelte';

export const MARKUP_TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'text', label: 'Text' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'draw', label: 'Draw' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'stamp', label: 'Stamp' },
  { id: 'comment', label: 'Comment' },
  { id: 'sign', label: 'Sign' },
  { id: 'form', label: 'Fill form' },
];
