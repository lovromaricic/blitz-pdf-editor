// The landing screen's background: paper sheets falling in 3D. Loaded lazily
// (its own chunk with Three.js) after first paint; Home works without it.
// Reacts to a dragged file (sheets gather into a ring) and to a drop (burst).
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
  SRGBColorSpace,
  WebGLRenderer,
  type BufferAttribute,
} from 'three';

export interface PaperScene {
  /** A file is (or isn't) being dragged over the window. */
  setCharged(on: boolean): void;
  /** Files were dropped: sheets burst outward from the ring. */
  burst(): void;
  dispose(): void;
  /** Measured average frame time (ms) of the last 2-second window, for reporting. */
  stats(): { frameMs: number; workMs: number; sheets: number; pixelRatio: number };
}

export interface SceneOptions {
  /** Called once the first frame is drawn (fade the canvas in then). */
  onReady?: () => void;
  reducedMotion: boolean;
  small: boolean;
}

// Drawings on the decorative pages: document content (like ink colors), not theme.
const PAGE = {
  paper: '#ffffff',
  edge: '#DDE2EA',
  title: '#C9D1DE',
  line: '#E1E6EE',
  highlight: 'rgba(255, 214, 10, 0.65)',
  picture: '#A9C0F5',
  ink: '#1F2733',
  stamp: '#1E8A4C',
};

/** Paper texture variants: 0 plain, 1 highlighted line, 2 picture and signature, 3 "DONE" stamp. */
function pageTexture(variant: number): CanvasTexture {
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
  } else if (variant === 2) {
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
  } else if (variant === 3) {
    g.strokeStyle = PAGE.stamp;
    g.lineWidth = 4;
    g.strokeRect(120, 262, 104, 36);
    g.fillStyle = PAGE.stamp;
    g.font = '600 20px sans-serif';
    g.fillText('DONE', 138, 288);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Sheet {
  mesh: Mesh;
  geo: PlaneGeometry;
  /** Flat vertex positions. */
  flat: Float32Array;
  x: number;
  y: number;
  z: number;
  /** Offset from a burst, decaying back to 0 velocity. */
  ox: number;
  vx: number;
  vy: number;
  fall: number;
  phase: number;
  sway: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrapAngle = (a: number) => ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const smooth = (x: number) => x * x * (3 - 2 * x);

const FPS_CAP = 60;
/**
 * Adaptive quality, over 2-second windows: lighten the scene when frames average
 * slower than SLOW_FRAME_MS and our own work per frame is a real part of it
 * (WORK_MS). Throttled frames (background tab, 30 Hz low-power mode) alone don't count.
 */
const SLOW_FRAME_MS = 24;
const WORK_MS = 8;
const MIN_SHEETS = 20;
const TOP = 4.6;

/** Returns null if WebGL isn't available (the page shows its static fallback). */
export function createPaperScene(canvas: HTMLCanvasElement, opts: SceneOptions): PaperScene | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  // The page background exactly, from the design tokens (sRGB in, sRGB out: no shift).
  const bg = new Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#F5F7FA');
  let pixelRatio = Math.min(window.devicePixelRatio || 1, opts.small ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(bg, 1);

  const scene = new Scene();
  scene.fog = new Fog(bg, 7, 15);
  const camera = new PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 0, 8);
  // Ambient 0.58 and directional 0.65 in the old ("legacy") light units the design was
  // tuned with; Three.js r155+ lights need π times more for the same look.
  scene.add(new AmbientLight(0xffffff, 0.58 * Math.PI));
  const sun = new DirectionalLight(0xffffff, 0.65 * Math.PI);
  sun.position.set(3, 5, 6);
  scene.add(sun);

  /** Half the visible width at z = 0, for placing sheets and the ring. */
  let halfW = 5.3;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfW = Math.tan((22.5 * Math.PI) / 180) * 8 * camera.aspect;
  }
  resize();

  const textures = [0, 1, 2, 3].map(pageTexture);
  const materials = textures.map((map) => new MeshLambertMaterial({ map, side: DoubleSide }));
  const count = opts.small ? 18 : 46;
  const sheets: Sheet[] = [];
  for (let i = 0; i < count; i++) {
    const geo = new PlaneGeometry(1, 1.414, 10, 14);
    const mesh = new Mesh(geo, materials[i % 4]);
    const s = rand(0.8, 1.3);
    mesh.scale.set(s, s, s);
    const far = Math.random() < 0.35;
    // Near sheets keep clear of the text in the middle.
    const minX = Math.min(2.4, halfW * 0.55);
    const side = Math.random() < 0.5 ? -1 : 1;
    sheets.push({
      mesh,
      geo,
      flat: new Float32Array(geo.attributes.position.array),
      x: far ? rand(-1.3, 1.3) * halfW : side * rand(minX, Math.max(minX + 0.5, halfW * 1.25)),
      y: rand(-TOP, TOP),
      z: far ? rand(-6.5, -3.5) : rand(-2, 1.4),
      ox: 0,
      vx: 0,
      vy: 0,
      fall: rand(0.25, 0.6),
      phase: rand(0, Math.PI * 2),
      sway: rand(0.2, 0.6),
      rx: rand(0, Math.PI * 2),
      ry: rand(0, Math.PI * 2),
      rz: rand(0, Math.PI * 2),
      wx: rand(-0.45, 0.45),
      wy: rand(-0.45, 0.45),
      wz: rand(-0.25, 0.25),
    });
    scene.add(mesh);
  }
  let active = count;

  let time = 0;
  let charge = 0;
  let target = 0;
  let pointerX = 0;
  let pointerY = 0;

  /** Slot k of the ring (an ellipse of 4.9 x 2.6 units, narrower on small screens), slowly turning. */
  function ring(k: number) {
    const a = (k / active) * Math.PI * 2 + time * 0.12;
    return { a, x: Math.cos(a) * Math.min(4.9, halfW * 0.92), y: Math.sin(a) * 2.6, z: -0.8 };
  }

  function step(dt: number) {
    time += dt;
    // Ease toward the ring in about 400 ms (95%), and back.
    charge += (target - charge) * (1 - Math.exp(-7.5 * dt));
    const c = smooth(Math.min(1, Math.max(0, charge)));
    if (!opts.reducedMotion) {
      camera.position.x += (pointerX * 0.7 - camera.position.x) * 0.05;
      camera.position.y += (pointerY * 0.4 - camera.position.y) * 0.05;
    }
    camera.lookAt(0, 0, 0);
    const decay = Math.pow(0.97, dt * 60);
    for (let k = 0; k < active; k++) {
      const s = sheets[k];
      s.y -= s.fall * dt;
      s.vx *= decay;
      s.vy *= decay;
      s.ox += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y < -TOP) {
        s.y = TOP;
        s.vx = s.vy = 0;
      }
      s.rx += s.wx * dt;
      s.ry += s.wy * dt;
      s.rz += s.wz * dt;
      const fx = s.x + s.ox + Math.sin(time * 0.6 + s.phase) * s.sway;
      const r = ring(k);
      s.mesh.position.set(lerp(fx, r.x, c), lerp(s.y, r.y, c), lerp(s.z, r.z, c));
      s.mesh.rotation.set(wrapAngle(s.rx) * (1 - c), wrapAngle(s.ry) * (1 - c), wrapAngle(s.rz) * (1 - c) + Math.sin(r.a) * 0.25 * c);
      // Curl and flutter, fading to nearly flat in the ring.
      const bend = Math.sin(time * 0.5 + s.phase) * 0.6 * (1 - c * 0.9);
      const flutter = 0.8 * (1 - c * 0.9);
      const pos = s.geo.attributes.position as BufferAttribute;
      const arr = pos.array as Float32Array;
      const flat = s.flat;
      for (let j = 0; j < arr.length; j += 3) {
        const u = flat[j];
        const v = flat[j + 1];
        arr[j + 2] = bend * u * u * 1.1 + flutter * Math.sin(v * 4 + time * 2.2 + s.phase) * 0.06 * (0.6 + u * u);
      }
      pos.needsUpdate = true;
      s.geo.computeVertexNormals();
    }
    renderer.render(scene, camera);
  }

  // --- Loop: capped at 60 fps, paused when hidden or off screen -------------------

  let raf = 0;
  let last = 0;
  let onScreen = true;
  let frames = 0;
  let frameTime = 0;
  let workTime = 0;
  let lastAvg = 0;
  let lastWork = 0;
  let adapted = false;

  function frame(now: number) {
    raf = 0;
    if (!running()) return;
    raf = requestAnimationFrame(frame);
    const elapsed = now - last;
    if (elapsed < 1000 / FPS_CAP - 1) return;
    last = now;
    const dt = Math.min(0.05, elapsed / 1000);
    const t0 = performance.now();
    step(dt);
    // Frame time = time between frames we drew (what the user sees); work = our share of it.
    frames++;
    frameTime += elapsed;
    workTime += performance.now() - t0;
    if (frameTime >= 2000) {
      lastAvg = frameTime / frames;
      lastWork = workTime / frames;
      if (lastAvg > SLOW_FRAME_MS && lastWork > WORK_MS && !adapted) lighten();
      frames = 0;
      frameTime = 0;
      workTime = 0;
    }
  }

  /** Fewer sheets and a lower pixel ratio, once, when frames are slow. */
  function lighten() {
    adapted = true;
    for (let k = MIN_SHEETS; k < active; k++) sheets[k].mesh.visible = false;
    active = Math.min(active, MIN_SHEETS);
    pixelRatio = 1;
    renderer.setPixelRatio(1);
    resize();
  }

  const running = () => !opts.reducedMotion && onScreen && !document.hidden;
  function start() {
    if (raf || !running()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
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
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  const io = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen) start();
    else stop();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  if (!opts.reducedMotion) window.addEventListener('pointermove', onPointer);

  // Settle the scene before showing it, then fade in.
  for (let i = 0; i < 40; i++) step(0.05);
  opts.onReady?.();
  start();

  return {
    setCharged(on) {
      target = on ? 1 : 0;
      if (opts.reducedMotion) {
        // No motion: jump to the ring (or back) in one still frame.
        charge = target;
        step(0);
      }
    },
    burst() {
      if (opts.reducedMotion) {
        // No burst: back to the still frame.
        charge = target = 0;
        step(0);
        return;
      }
      for (let k = 0; k < active; k++) {
        const s = sheets[k];
        const r = ring(k);
        s.x = r.x;
        s.ox = 0;
        s.y = r.y;
        s.z = r.z;
        s.vx = Math.cos(r.a) * 3.2;
        s.vy = Math.sin(r.a) * 2.4 + 1.2;
        s.rx = s.ry = s.rz = 0;
        s.wx = rand(-1.1, 1.1);
        s.wy = rand(-1.1, 1.1);
      }
      charge = 0;
      target = 0;
    },
    stats: () => ({ frameMs: Math.round(lastAvg * 10) / 10, workMs: Math.round(lastWork * 10) / 10, sheets: active, pixelRatio }),
    dispose() {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      for (const s of sheets) s.geo.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
