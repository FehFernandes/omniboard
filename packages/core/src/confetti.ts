/**
 * Confetti — A lightweight, dependency-free celebration effect.
 *
 * Renders animated confetti particles on a temporary full-screen canvas
 * overlay, then cleans itself up. Great for "task complete" moments.
 */

export interface ConfettiOptions {
  /** Number of particles. Default: 150 */
  count?: number;
  /** Duration in ms before the overlay is removed. Default: 2500 */
  duration?: number;
  /** Particle colors. Defaults to a festive palette. */
  colors?: string[];
  /** Origin of the burst in screen px. Defaults to top-center. */
  origin?: { x: number; y: number };
  /** Element to append the overlay to. Defaults to document.body. */
  container?: HTMLElement;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vr: number;
  shape: "rect" | "circle";
}

const DEFAULT_COLORS = [
  "#6965db", "#f0466e", "#2f9e44", "#f08c00", "#1971c2",
  "#e64980", "#fab005", "#15aabf", "#7048e8",
];

/**
 * Fire a confetti burst. Returns a function to cancel it early.
 */
export function confetti(options: ConfettiOptions = {}): () => void {
  const count = options.count ?? 150;
  const duration = options.duration ?? 2500;
  const colors = options.colors ?? DEFAULT_COLORS;
  const container = options.container ?? document.body;

  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "99999";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const ox = options.origin?.x ?? window.innerWidth / 2;
  const oy = options.origin?.y ?? 0;

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.random() * Math.PI) - Math.PI / 2; // spread downward-ish
    const speed = 4 + Math.random() * 8;
    particles.push({
      x: ox + (Math.random() - 0.5) * 200,
      y: oy + Math.random() * 40,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
      vy: Math.sin(angle) * speed + Math.random() * 3,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      shape: Math.random() < 0.5 ? "rect" : "circle",
    });
  }

  const gravity = 0.18;
  const drag = 0.995;
  let rafId = 0;
  let cancelled = false;
  const start = performance.now();

  const frame = (now: number) => {
    if (cancelled) return;
    const elapsed = now - start;
    const fade = Math.max(0, 1 - Math.max(0, elapsed - duration * 0.6) / (duration * 0.4));

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of particles) {
      p.vy += gravity;
      p.vx *= drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (elapsed < duration) {
      rafId = requestAnimationFrame(frame);
    } else {
      cleanup();
    }
  };

  const cleanup = () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resize);
    canvas.remove();
  };

  window.addEventListener("resize", resize);
  rafId = requestAnimationFrame(frame);

  return cleanup;
}
