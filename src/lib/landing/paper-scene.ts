// The landing screen's background: paper sheets falling in 3D. A port of the
// approved prototype (docs/reference/blitz-landing-prototype.html): its look and
// motion numbers are copied 1:1. Three.js r128 is pinned because the prototype's
// lights and colors were tuned on it (newer versions change both).
// Loaded lazily (its own chunk) after first paint; Home works without it.
import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  type BufferAttribute,
} from 'three';
import { AbsorbTimeline, smoothstep } from './absorb-timeline';

export interface PaperScene {
  /** A file is (or isn't) being dragged over the window: sheets gather into a ring. */
  setCharged(on: boolean): void;
  /**
   * Files were chosen: sheets rush into one stack and the top page grows to fill
   * the window. `onFilled` is called once, when the page fills the window.
   */
  absorb(onFilled: () => void): void;
  /** Back to falling (only when opening failed or was cancelled). */
  reset(): void;
  dispose(): void;
  stats(): { frameMs: number; absorbFps: number; absorbSeconds: number; finished: boolean; sheets: number; pixelRatio: number };
}

export interface SceneOptions {
  /** Called once the first frame is drawn (fade the canvas in then). */
  onReady?: () => void;
  reducedMotion: boolean;
}

// Drawings on the decorative pages: document content (like ink colors), not theme.
const PAGE = {
  paper: '#ffffff',
  edge: '#DDE2EA',
  title: '#C9D1DE',
  line: '#E1E6EE',
  highlight: 'rgba(255,214,10,0.65)',
  picture: '#A9C0F5',
  ink: '#1F2733',
  stamp: '#1E8A4C',
};

/** Page textures: 0 plain, 1 highlighted line, 2 picture and signature, 3 "DONE" stamp. */
function makeTexture(variant: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 362;
  const g = c.getContext('2d')!;
  g.fillStyle = PAGE.paper;
  g.fillRect(0, 0, 256, 362);
  g.strokeStyle = PAGE.edge;
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 360);
  g.fillStyle = PAGE.title;
  g.fillRect(24, 26, 100, 10);
  g.fillStyle = PAGE.line;
  for (let i = 0; i < 10; i++) g.fillRect(24, 64 + i * 18, i % 4 === 3 ? 120 : 208, 6);
  if (variant === 1) {
    g.fillStyle = PAGE.highlight;
    g.fillRect(22, 64 + 2 * 18 - 4, 150, 14);
  }
  if (variant === 2) {
    g.fillStyle = PAGE.picture;
    g.fillRect(160, 20, 72, 34);
    g.strokeStyle = PAGE.ink;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(30, 322);
    g.bezierCurveTo(40, 296, 52, 296, 56, 322);
    g.bezierCurveTo(62, 340, 76, 310, 86, 318);
    g.bezierCurveTo(100, 330, 110, 300, 128, 314);
    g.stroke();
  }
  if (variant === 3) {
    g.strokeStyle = PAGE.stamp;
    g.lineWidth = 4;
    g.strokeRect(120, 262, 104, 36);
    g.fillStyle = PAGE.stamp;
    g.font = '600 20px sans-serif';
    g.fillText('DONE', 138, 288);
  }
  return new CanvasTexture(c);
}

interface Sheet {
  m: Mesh;
  geo: PlaneGeometry;
  /** Flat vertex positions. */
  orig: Float32Array;
  s: number;
  /** Hidden by adaptive quality. */
  off: boolean;
  /** Final z rotation in the stack (about ±3°). */
  jit: number;
  /** Horizontal position as a fraction of the visible half-width. */
  xf: number;
  ox: number;
  y: number;
  z: number;
  fall: number;
  ph: number;
  sway: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  vx: number;
  vy: number;
  /** Last bend and flutter, eased to zero during the absorb. */
  lb: number;
  lf: number;
  /** Position and rotation when the absorb started. */
  sp: [number, number, number] | null;
  sr: [number, number, number] | null;
}

const wrap = (a: number) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** The battery: never more than 60 frames a second. */
const FPS_CAP = 60;
/** Adaptive quality: if frames average slower than this over 2 s, keep 20 sheets and pixel ratio 1. */
const SLOW_FRAME_MS = 24;
const KEEP_SHEETS = 20;

/** Returns null if WebGL isn't available (the page shows its static fallback). */
export function createPaperScene(canvas: HTMLCanvasElement, opts: SceneOptions): PaperScene | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch {
    return null;
  }
  const reduced = opts.reducedMotion;
  const small = window.innerWidth < 700;
  const N = small ? 18 : 46;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  // The page background exactly, from the design tokens.
  const bg = new Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#F5F7FA');
  renderer.setClearColor(bg, 1);
  const scene = new Scene();
  scene.fog = new Fog(bg, 7, 15);
  const camera = new PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 0, 8);
  scene.add(new AmbientLight(0xffffff, 0.58));
  const dl = new DirectionalLight(0xffffff, 0.65);
  dl.position.set(3, 5, 6);
  scene.add(dl);

  let halfW = 5.3;
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfW = Math.tan((22.5 * Math.PI) / 180) * 8 * camera.aspect;
  }
  resize();

  const texs = [makeTexture(0), makeTexture(1), makeTexture(2), makeTexture(3)];
  const sheets: Sheet[] = [];
  for (let i = 0; i < N; i++) {
    const geo = new PlaneGeometry(1, 1.414, 10, 14);
    const orig = new Float32Array(geo.attributes.position.array as Float32Array);
    // One material per sheet, as in the prototype: the absorb fades sheets individually.
    const m = new Mesh(geo, new MeshLambertMaterial({ map: texs[i % 4], side: DoubleSide }));
    const s = 0.8 + Math.random() * 0.5;
    const far = Math.random() < 0.35;
    const side = Math.random() < 0.5 ? -1 : 1;
    sheets.push({
      m,
      geo,
      orig,
      s,
      off: false,
      jit: (Math.random() - 0.5) * 0.12,
      xf: far ? (Math.random() * 2 - 1) * 1.3 : side * (0.45 + Math.random() * 0.78),
      ox: 0,
      y: (Math.random() * 2 - 1) * 5,
      z: far ? -3.5 - Math.random() * 3 : -2 + Math.random() * 3.4,
      fall: 0.25 + Math.random() * 0.35,
      ph: Math.random() * 6.28,
      sway: 0.2 + Math.random() * 0.4,
      rx: Math.random() * 6.28,
      ry: Math.random() * 6.28,
      rz: Math.random() * 6.28,
      wx: (Math.random() - 0.5) * 0.9,
      wy: (Math.random() - 0.5) * 0.9,
      wz: (Math.random() - 0.5) * 0.5,
      vx: 0,
      vy: 0,
      lb: 0,
      lf: 0,
      sp: null,
      sr: null,
    });
    m.scale.set(s, s, s);
    scene.add(m);
  }

  let T = 0;
  let charge = 0;
  let target = 0;
  let px = 0;
  let py = 0;
  let mode: 'fall' | 'absorb' = 'fall';
  let timeline: AbsorbTimeline | null = null;

  function ringPos(k: number) {
    const a = (k / N) * Math.PI * 2 + T * 0.12;
    return { a, x: Math.cos(a) * 0.92 * halfW, y: Math.sin(a) * 2.6, z: -0.8 };
  }

  function bend(sh: Sheet, b: number, f: number) {
    const pos = sh.geo.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    const o = sh.orig;
    for (let j = 0; j < arr.length; j += 3) {
      const u = o[j];
      const v = o[j + 1];
      arr[j + 2] = b * u * u * 1.1 + f * Math.sin(v * 4 + T * 2.2 + sh.ph) * 0.06 * (0.6 + u * u);
    }
    pos.needsUpdate = true;
    sh.geo.computeVertexNormals();
  }

  function stepAbsorb(dt: number) {
    const tl = timeline!;
    tl.advance(dt);
    const cz = 0.3;
    const heroP = tl.hero;
    const fade = tl.fade;
    // Scale at which the top page covers the whole window, plus 10%.
    const visH = 2 * Math.tan((22.5 * Math.PI) / 180) * (8 - cz);
    const need = Math.max(visH / 1.414, visH * camera.aspect) * 1.1;
    for (let k = 0; k < N; k++) {
      const sh = sheets[k];
      if (!sh.m.visible) continue;
      const e = tl.sheet(k, N);
      const tz = cz + (N - k) * 0.004;
      const sp = sh.sp!;
      const sr = sh.sr!;
      // A slight swirl: an offset perpendicular to the path, largest halfway.
      const dx = sp[0];
      const dy = sp[1];
      const sw = 0.35 * Math.sin(Math.PI * e);
      sh.m.position.set(lerp(sp[0], 0, e) + -dy * sw, lerp(sp[1], 0, e) + dx * sw, lerp(sp[2], tz, e));
      sh.m.rotation.set(lerp(sr[0], 0, e), lerp(sr[1], 0, e), lerp(sr[2], sh.jit, e));
      bend(sh, sh.lb * (1 - e), sh.lf * (1 - e));
      const material = sh.m.material as MeshLambertMaterial;
      if (k === 0) {
        const sc = lerp(sh.s, need, heroP * heroP);
        sh.m.scale.set(sc, sc, sc);
        sh.m.position.z = lerp(tz, tz + 1.2, heroP);
        sh.m.position.x *= 1 - heroP;
        sh.m.position.y *= 1 - heroP;
        sh.m.rotation.z = lerp(sh.jit, 0, heroP);
      } else if (fade > 0) {
        material.transparent = true;
        material.opacity = 1 - fade;
      }
    }
    // The parallax drift stops.
    camera.position.x *= 0.9;
    camera.position.y *= 0.9;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  function step(dt: number) {
    T += dt;
    if (mode === 'absorb') {
      stepAbsorb(dt);
      return;
    }
    charge += (target - charge) * Math.min(1, dt * 4);
    const c = smoothstep(clamp(charge));
    camera.position.x += (px * 0.7 - camera.position.x) * 0.05;
    camera.position.y += (py * 0.4 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    for (let k = 0; k < N; k++) {
      const sh = sheets[k];
      if (!sh.m.visible) continue;
      sh.y -= sh.fall * dt;
      sh.vx *= 0.97;
      sh.vy *= 0.97;
      sh.ox += sh.vx * dt;
      sh.y += sh.vy * dt;
      if (sh.y < -4.6) {
        sh.y = 4.6;
        sh.vx = 0;
        sh.vy = 0;
      }
      sh.rx += sh.wx * dt;
      sh.ry += sh.wy * dt;
      sh.rz += sh.wz * dt;
      const sx = sh.xf * halfW + sh.ox + Math.sin(T * 0.6 + sh.ph) * sh.sway;
      const r = ringPos(k);
      sh.m.position.set(lerp(sx, r.x, c), lerp(sh.y, r.y, c), lerp(sh.z, r.z, c));
      sh.m.rotation.set(wrap(sh.rx) * (1 - c), wrap(sh.ry) * (1 - c), wrap(sh.rz) * (1 - c) + Math.sin(r.a) * 0.25 * c);
      sh.lb = Math.sin(T * 0.5 + sh.ph) * 0.6 * (1 - c * 0.9);
      sh.lf = 0.8 * (1 - c);
      bend(sh, sh.lb, sh.lf);
    }
    renderer.render(scene, camera);
  }

  // --- Loop: at most 60 fps, paused when hidden or off screen, stopped when done ---

  let raf = 0;
  let last = 0;
  let visible = true;
  let frames = 0;
  let acc = 0;
  let lastAvg = 0;
  let absorbFrames = 0;
  let absorbTime = 0;
  let disposed = false;

  const running = () => !disposed && !reduced && visible && !document.hidden && !(mode === 'absorb' && timeline?.finished);

  function loop(now: number) {
    raf = 0;
    if (!running()) return;
    raf = requestAnimationFrame(loop);
    const elapsed = now - last;
    if (elapsed < 1000 / FPS_CAP - 1) return;
    last = now;
    const dt = Math.min(0.05, elapsed / 1000);
    step(dt);
    if (mode === 'fall') {
      frames++;
      acc += dt;
      if (acc >= 2) {
        lastAvg = (acc / frames) * 1000;
        if (lastAvg > SLOW_FRAME_MS) lighten();
        frames = 0;
        acc = 0;
      }
    } else {
      absorbFrames++;
      absorbTime += dt;
    }
  }

  function lighten() {
    let shown = 0;
    for (const sh of sheets) {
      if (!sh.m.visible) continue;
      shown++;
      if (shown > KEEP_SHEETS) {
        sh.m.visible = false;
        sh.off = true;
      }
    }
    pixelRatio = 1;
    renderer.setPixelRatio(1);
    resize();
  }

  function start() {
    if (raf || !running()) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  const onResize = () => {
    resize();
    if (!raf) renderer.render(scene, camera);
  };
  const onPointer = (e: PointerEvent) => {
    px = (e.clientX / window.innerWidth) * 2 - 1;
    py = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  if (!reduced) window.addEventListener('pointermove', onPointer);

  // Settle the scene before showing it (reduced motion: this is the one still frame).
  for (let i = 0; i < 40; i++) step(0.05);
  opts.onReady?.();
  start();

  return {
    setCharged(on) {
      // Reduced motion: no ring, the text change is the whole charged state.
      if (!reduced && mode === 'fall') target = on ? 1 : 0;
    },
    absorb(onFilled) {
      if (mode === 'absorb' || reduced) return;
      target = 0;
      mode = 'absorb';
      absorbFrames = 0;
      absorbTime = 0;
      // The page fills the window: the loop stops by itself after this frame (nothing moves now).
      timeline = new AbsorbTimeline(onFilled);
      for (const sh of sheets) {
        sh.sp = [sh.m.position.x, sh.m.position.y, sh.m.position.z];
        sh.sr = [sh.m.rotation.x, sh.m.rotation.y, sh.m.rotation.z];
      }
      start();
    },
    reset() {
      mode = 'fall';
      timeline = null;
      charge = target = 0;
      for (const sh of sheets) {
        const material = sh.m.material as MeshLambertMaterial;
        material.transparent = false;
        material.opacity = 1;
        sh.m.visible = !sh.off;
        sh.m.scale.set(sh.s, sh.s, sh.s);
        sh.y = 4.6 + Math.random() * 3;
        sh.vx = sh.vy = sh.ox = 0;
      }
      start();
    },
    stats: () => ({
      frameMs: Math.round(lastAvg * 10) / 10,
      absorbFps: absorbTime > 0 ? Math.round(absorbFrames / absorbTime) : 0,
      absorbSeconds: Math.round((timeline?.t ?? 0) * 1000) / 1000,
      finished: !!timeline?.finished,
      sheets: sheets.filter((s) => s.m.visible).length,
      pixelRatio,
    }),
    dispose() {
      disposed = true;
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      for (const sh of sheets) {
        sh.geo.dispose();
        (sh.m.material as MeshLambertMaterial).dispose();
      }
      for (const t of texs) t.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
