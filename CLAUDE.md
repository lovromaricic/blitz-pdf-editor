# Blitz PDF Editor: project rules

A free, browser-only PDF editor (Svelte 5 runes + Vite + TypeScript, static build). See `README.md` for commands, structure and deployment.

## Principles

- Everything runs in the browser. No uploads, no backend, no storage beyond the open tab.
- **No network requests of any kind** besides the app's own static files (no CDNs, analytics, or third-party fonts).
- One home per feature: actions are implemented once (`src/lib/actions.svelte.ts`, command ids in `src/lib/commands.ts`) and every entry point (menu, shortcut, context menu, panel, mobile UI) calls the same command.
- Dependencies must be permissively licensed (MIT, Apache-2.0, BSD, ISC, OFL for fonts). Never GPL or AGPL. Check before adding.

## Design rules ("Mist")

- **Only use the CSS variables in `src/styles/tokens.css`** for color, radius, shadow, font and size. No hex, `rgb()` or font names in components. If something needs a new value, add a token there (with a comment) and mention it.
  - Document content colors (highlight swatches, ink, stamp colors, comment icon outline) are data, not theme: they live as constants in `src/lib/annotations.ts` / `src/lib/signature.ts`, never in component CSS.
- Font: Manrope, bundled via `@fontsource/manrope` (imported in `src/main.ts`). Never load fonts from Google Fonts or any CDN.
- Icons: Lucide (`@lucide/svelte`, ISC), 20px, stroke 1.7, via the shared `ICON` constant in `src/editor/tools.ts`. Import individual icons (`@lucide/svelte/icons/<name>`).
- Reuse existing building blocks instead of restyling ad hoc:
  - `src/editor/Toolbar.svelte`: the floating pill toolbar (desktop and tablet only; never on phones).
  - On desktop and tablet the toolbar pill and the bottom controls (`BottomBar.svelte`) float over the pages (`CanvasView.svelte`). Their wrappers are `pointer-events: none`, only the pills take input. The page layout is padded by `FLOATING_INSETS` (`src/lib/viewer.svelte.ts`), and anything that scrolls to a page or match must use `viewer.insetTop` / `goToPage` so the target never lands under a pill.
  - `src/editor/panels/PanelHeader.svelte` + `src/editor/panels/panel.css` for every properties/tool panel.
  - `src/components/Swatches.svelte`, `src/components/Range.svelte` for colors and sliders.
  - Global classes: `.btn`, `.btn-primary`, `.btn-soft`, `.btn-danger`, `.card`, `.card-error`, `.section-label`.
- Panels are separated by 1px borders, not shadows. Only the floating pills (toolbar, bottom controls) and pages have shadows; overlays (menus, dialogs, toasts) use `--shadow-overlay`.
- Small text on `--accent-soft` uses `--accent-strong` (contrast); icons may use `--accent`.
- Every interactive element keeps a visible `:focus-visible` ring (2px accent). Touch targets are at least 44px on touch devices and in the phone layout.
- The phone layout starts below 720px (`MediaQuery('(max-width: 720px)')` in `src/screens/Editor.svelte`): top bar, accordion menu, bottom tool strip, bottom sheets. Restyle both layouts when changing styles.
- No gradients, glows, blur, emoji or decorative animation. Transitions 120–150ms (`--transition-fast`); `prefers-reduced-motion` is respected globally.

## Quality

- Run `npm run check`, `npm test` and `npm run build` before committing.
- Accessibility: real buttons/inputs with labels, ARIA patterns for menus and toolbars, axe-core clean on Home, editor, panels, dialogs and the phone layout.
