# Blitz PDF Editor: New Landing Screen (3D falling paper)

Rebuild the Home screen as a landing screen with a real-time 3D background of falling paper sheets, a clear wordmark and headline, and a whole-window drop zone that reacts when a file is dragged over it. This is Home screen work only. Do not change the editor or any other feature. **Before changing anything, tell me your plan in a few lines**, including the size of the new dependency and how you will lazy-load it.

## 0. Reference implementation (read this first)

`blitz-landing-prototype.html` is the approved, working prototype, and **the result must look and move exactly like it**. Open it in a browser, read its source, and port it into the app. Do not redesign or "improve" the visuals.

- **Copy 1:1 into Svelte and TypeScript:** the four canvas-drawn page textures, the sheet geometry and placement, the fall, sway and tumble values, the curl and flutter formula, the fog, camera and lights, the pointer parallax, the ring slots, the drop "absorb" animation (sheets converge into one stack and the top page grows into the editor), the adaptive quality logic, and the drag counter.
- **Visuals and motion numbers:** the prototype wins over any number in this document.
- **Architecture, quality and rules:** this document wins. The prototype is a single file for demonstration. In the app, the following must differ:
  1. Three.js comes from npm, in a lazily loaded chunk, not inlined. **Pin `three@0.128.0` (and the matching `@types/three`)**: the prototype's lighting and colors were tuned on that version, and newer versions change color management and lighting units, which would change the look. If you want to upgrade, first prove the result is visually identical and tell me.
  2. Colors, spacing and radii come from the Mist tokens (add `--bolt` and `--bolt-edge`), and all text comes from the strings file.
  3. The prototype's "Simulate file drag" button, its placeholder messages and its "nothing is uploaded" notice are not part of the app. A valid drop or file selection opens the editor, as the app does today.
  4. Add the lifecycle the prototype lacks: clean disposal, unit tests, and integration with the app's existing file loading.
- Keep the prototype file in the repo under `docs/reference/` so it can be compared against later.

I will also attach a screenshot of the prototype. If the screenshot and the prototype differ, the prototype wins.

---

## 1. Principles

1. **The tool works instantly.** The text, the "Choose files" button and the drop zone must work from the very first paint, before any 3D code has loaded. The 3D scene is a progressive enhancement.
2. **Nothing leaves the device.** No third-party requests (no CDN, no analytics, no fonts from elsewhere), nothing stored in localStorage or cookies.
3. **Restraint.** One effect: falling paper. It reacts to a dragged file. Nothing else flashes, glows or bounces.
4. **Design tokens only.** Use the existing Mist tokens. The few new values listed below become new tokens, not hard-coded colors.

## 2. Screen content

Centered block, top to bottom, on a soft panel (section 3):

1. **Wordmark:** a yellow lightning bolt followed by "Blitz PDF Editor" (22px / 500).
2. **Headline (h1), one line:** "Edit PDFs at the speed of light." (32px / 500). One line on desktop. Below about 640px wide it may wrap to two lines and the size scales down (for example clamp(24px, 6vw, 32px)).
3. **Drop line:** "Drop a PDF or images anywhere on this page." (14px, `--muted`). **Hidden on touch devices** (no hover and coarse pointer), where nothing can be dragged.
4. **Button:** "Choose files" (solid `--accent`, `--on-accent` text, 44px minimum height). It opens the file picker and is a real `<button>` (or a label tied to a visually hidden file input) that works with the keyboard.

Nothing else on the screen for now: no header, no footer links, no privacy line, no feature list. All strings live in one strings file (for example `src/lib/strings.ts`) so a Croatian translation can be added later.

The yellow bolt is an inline SVG: fill `#FFC21A`, 1px stroke `#D99A00`, round joins, about 30px. Add tokens `--bolt` and `--bolt-edge`.

## 3. Layout

- Background: `--bg` (#F5F7FA). The 3D canvas fills the whole viewport behind the content.
- The text block sits in the optical center, on a flat panel: background `--bg` at 82% opacity, 18px radius, padding about 22px 32px. This keeps the text readable when sheets pass behind it. No blur, no shadow.
- The panel and canvas are `pointer-events: none` except the button, so scrolling and dropping work everywhere.
- The screen fits one viewport with no scrolling on desktop and phones.

## 4. Drop zone behavior (the whole window)

Detection
1. The entire window is the drop target on Home. React only to drags that carry files (`dataTransfer.types` includes "Files"). Ignore dragged text, links and images from other pages.
2. Avoid flicker: use an enter/leave counter or relatedTarget checks so the charged state doesn't toggle when the cursor crosses elements or the window edge. Handle a file dragged out and back in.
3. `preventDefault` on dragover and drop so the browser never opens the file itself.
4. Put the counter logic in a small pure function so it can be unit tested.

Accepted files
- PDFs, and images that become pages of a PDF. Verify which image types actually work in each browser before promising them. JPG, PNG and WebP should work. HEIC/HEIF only decodes in Safari, so accept it only where it actually decodes (test with `createImageBitmap`), and otherwise show the calm message below.
- The file picker (`accept` attribute) must list exactly the supported types, and allow selecting several files.
- Mixed PDFs and images in one drop: combine everything into one document in the order chosen (or dropped), unless the app already does something else, in which case keep the existing behavior and tell me.
- Invalid files: do NOT trigger the absorb animation. Return to idle and show a calm message (aria-live): "That file type isn't supported. Try a PDF, JPG or PNG."

Charged state (a valid-looking file is over the window)
- The drop line text becomes "Release to open", and a visually hidden aria-live message says "Release to open your files".
- The paper sheets gather into a ring around the text panel (section 5).

Drop sequence
1. Start reading/loading the files immediately, in parallel with the animation. The animation takes about 1.2 seconds in total and must never be the reason the editor is late: if the file is ready earlier, mount the editor underneath right away.
2. Play the "absorb" animation (section 5): the sheets rush in to the center and land in one stack, then the top page grows until it fills the window while the other sheets fade, and the text panel fades out at the start. When the page fills the window, crossfade (about 150ms) to the editor. If the file is not ready by then, keep the full-window page on screen and show the existing loading indicator until it is.
3. This also applies when the user picks files with "Choose files" (no drag): the sheets absorb from wherever they are falling.
4. Several files behave exactly as they do today.

## 5. The 3D paper scene

This section describes what the prototype does. Where the numbers differ from the prototype's source, the prototype wins (for example, the prototype stores each sheet's horizontal position as a fraction of the visible half-width, so the layout adapts to any window shape, and the ring's width is 0.92 of the half-width).

Load with a dynamic `import()` after first paint and when the browser is idle. Use Three.js r128 (MIT license; confirm the license and tell me the gzipped size added). Import only what is needed. Keep this in its own chunk so the initial Home bundle stays small.

Scene
- `WebGLRenderer`, clear color `--bg`, pixel ratio capped at 2. Camera: perspective, FOV 45, at z = 8 looking at the origin. Fog with the same color as the background, near 7, far 15, so distant sheets fade into the page.
- Lights: ambient 0.58 and one directional 0.65 at (3, 5, 6). Lambert material, double-sided, so tilted sheets shade like real paper.
- Do not use sRGB output conversion tricks that shift the background color: the canvas background must match `--bg` exactly.

Sheets
- 46 sheets on desktop (see section 6 for fewer on weak devices). Each is a plane 1 x 1.414 with 10 x 14 segments, scaled 0.8 to 1.3.
- Four canvas-generated textures (256 x 362), shared between sheets: (0) plain page with a title bar and text lines, (1) the same with a yellow highlight over one line, (2) a small blue image block in the corner and a hand-drawn signature, (3) a green "DONE" stamp box. Light gray border on each page.
- Placement: 35% "far" sheets spread across the width at z from -3.5 to -6.5; the rest at z from -2 to +1.4 and kept away from the text (x at least 2.4 units from the center). This keeps the middle readable.
- Motion: each sheet falls at 0.25 to 0.6 units per second, sways sideways (amplitude 0.2 to 0.6, own phase), and tumbles slowly on all three axes (angular speed up to about 0.45 rad/s). When a sheet falls below y = -4.6 it reappears at y = 4.6.
- Curl and flutter: update each sheet's vertices every frame. For a vertex (u, v) of the flat sheet, z = bend * u * u * 1.1 + flutter * sin(v * 4 + t * 2.2 + phase) * 0.06 * (0.6 + u * u), where bend = sin(t * 0.5 + phase) * 0.6 and flutter = 0.8. Recompute normals after updating.
- Parallax: the camera drifts toward the pointer position (x by 0.7 units, y by 0.4), eased at about 5% per frame.

Ring while charged (ease the transition over about 400ms)
- Each sheet blends from its falling position to a slot on an ellipse (0.92 of the visible half-width by 2.6 units, at z = -0.8), slowly rotating, facing the camera, with its tumble and curl fading to nearly flat. Tilt each slightly (sin of its angle times 0.25 rad).

Absorb on drop (about 1.2 seconds, see the prototype's `stepAbsorb`)
- Capture each sheet's current position and rotation. Each sheet then travels to the center with a slight curved swirl (an offset perpendicular to its path, 0.35 of the distance times sin(pi * progress)), easing in and out over 0.5s, staggered by index over 0.2s. Rotation eases to flat (z rotation to a small random jitter of about 3 degrees), and curl and flutter ease to zero.
- They land in one stack at z = 0.3, spaced 0.004 apart, with sheet 0 on top.
- From 0.72s the top sheet scales up (ease-in, 0.4s) to cover the whole window (compute the scale from the visible height and aspect ratio, plus 10%), moving toward the camera by 1.2 units and centering. At the same time all other sheets fade out over 0.2s.
- The text panel fades out (opacity 0 and scale 0.97 over 0.3s) the moment the absorb starts.
- Total about 1.2s. Then the editor is shown (see Drop sequence). The camera stops its parallax drift during this animation.

## 6. Performance and fallbacks

- First paint is only HTML, CSS and the static background. No layout shift when the 3D scene arrives (the canvas is already in place, transparent until ready, then fades in over about 300ms).
- Pause rendering when the tab is hidden or the canvas is off screen (`document.hidden` and IntersectionObserver). Stop all loops and timers when Home unmounts, and dispose of geometries, materials, textures and the renderer.
- Adaptive quality: measure frame time. If the average over 2 seconds exceeds about 24ms, reduce the sheet count (down to about 20) and the pixel ratio (down to 1).
- Phones and small screens: start with about 18 sheets and a pixel ratio of 1.5.
- No WebGL, or the context fails: show a calm static fallback made with CSS (a few rotated, faded page shapes at the sides). The page works exactly the same.
- `prefers-reduced-motion`: render one still frame (no falling, no parallax). The ring and the absorb animation are skipped: the charged state is just the text change, and on drop the editor appears right away.
- Respect the battery: do not run at more than 60fps; no work when idle.

## 7. Accessibility

- Semantic structure: one `<main>`, the headline as `<h1>`, the wordmark as a plain element (not a heading), the canvas `aria-hidden="true"`.
- The button comes first in the tab order, has a visible focus ring (one ring only), and works with Enter and Space.
- Text contrast on the panel is at least 4.5:1. `--muted` text must not be lighter than it is now.
- The aria-live region announces "Release to open your files" and the error message above.
- Nothing in the scene is required to use the app.

## 8. Tests and delivery

- Unit tests: the drag counter (enter/leave sequences, leaving the window, a drop, a non-file drag), and the file validation (PDF, JPG, PNG, WebP, an unsupported type, a mix of several files).
- Check by hand in Chrome, Safari and Firefox: drag a PDF over the button and over the text, out of the window and back in, drop it; drop several JPGs; drop a .txt (calm message, no animation); drag selected text (nothing happens). Check on a phone width and a tablet width.
- Report: the size of the initial bundle before and after, the size of the lazy 3D chunk, measured frame rate on this machine, the adaptive thresholds you used, and any browser quirks.
- Make one commit for the landing screen. If you add the new tokens (`--bolt`, `--bolt-edge`), add them to the tokens file and to the project's CLAUDE.md design rules.

## 9. Not in this task (later)

- The ghost-cursor product film, a scroll story, a Croatian translation, a privacy line, and dark mode. Do not build these now, but keep the strings in the strings file and the colors in tokens so they are easy to add.
