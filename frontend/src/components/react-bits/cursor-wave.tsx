"use client";

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

export type CursorWaveShape = "circle" | "triangle" | "square";

/** Solid hex string OR a two-stop radial-gradient definition. */
export type CursorWaveColor = string | { stops: [string, string] };

export interface CursorWaveProps {
  /** Container width */
  width?: string | number;
  /** Container height */
  height?: string | number;
  /** Additional CSS classes */
  className?: string;
  /** Content rendered above the canvas */
  children?: React.ReactNode;
  /** Pixel spacing between cell centres */
  cellSize?: number;
  /** Cursor influence radius as a percentage of min(width,height) */
  influenceRadiusVmin?: number;
  /** Time constant (in seconds) for the swell-up ease */
  attackTime?: number;
  /** Time constant (in seconds) for the relax-down ease */
  releaseTime?: number;
  /** Resting scale applied to every shape (0–1) */
  idleScale?: number;
  /** Minimum peak scale assigned per cell on hover */
  minPeakScale?: number;
  /** Maximum peak scale assigned per cell on hover */
  maxPeakScale?: number;
  /** Click-burst expansion speed in pixels/second */
  burstSpeed?: number;
  /** Click-burst ring thickness in pixels */
  burstThickness?: number;
  /** Background fill color in hex format */
  backgroundColor?: string;
  /** Pool of shapes to randomly assign across the grid */
  shapes?: CursorWaveShape[];
  /**
   * Color pool. Strings are solid hex; objects produce a 2-stop radial
   * gradient with `stops[0]` at the top and `stops[1]` at the bottom.
   */
  colors?: CursorWaveColor[];
  /** Maximum device pixel ratio (caps GPU work) */
  dpr?: number;
  /** Master alpha (0–1) */
  opacity?: number;
}

export interface CursorWaveHandle {
  /** Trigger a wave burst at an explicit (clientX, clientY). Defaults to centre. */
  burst: (x?: number, y?: number) => void;
}

const DEFAULT_COLORS: CursorWaveColor[] = [
  "#22c55e",
  "#06b6d4",
  "#f97316",
  "#ef4444",
  "#facc15",
  "#ec4899",
  "#9ca3af",
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  { stops: ["#6366f1", "#3b82f6"] },
  { stops: ["#06b6d4", "#6366f1"] },
  { stops: ["#22c55e", "#06b6d4"] },
  { stops: ["#f97316", "#ef4444"] },
  { stops: ["#8b5cf6", "#06b6d4"] },
  { stops: ["#3b82f6", "#8b5cf6"] },
  { stops: ["#34d399", "#3b82f6"] },
];

const DEFAULT_SHAPES: CursorWaveShape[] = ["circle", "triangle", "square"];

const TAU = Math.PI * 2;

function uniform(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function smoothstep01(t: number) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function settleFactor(seconds: number) {
  if (seconds <= 0) return 1;
  return 1 - Math.pow(0.05, 1 / (60 * seconds));
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  shape: CursorWaveShape,
  size: number,
) {
  switch (shape) {
    case "circle": {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.6, 0, TAU);
      break;
    }
    case "square": {
      const half = size * 0.6;
      const r = size * 0.12;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(-half, -half, half * 2, half * 2, r);
      } else {
        ctx.rect(-half, -half, half * 2, half * 2);
      }
      break;
    }
    case "triangle": {
      const r = size * 0.78;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 3;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
  }
}

function makeFill(
  ctx: CanvasRenderingContext2D,
  color: CursorWaveColor,
  size: number,
): string | CanvasGradient {
  if (typeof color === "string") return color;
  const grad = ctx.createRadialGradient(
    0,
    -size * 0.3,
    0,
    0,
    size * 0.3,
    size * 1.5,
  );
  grad.addColorStop(0, color.stops[0]);
  grad.addColorStop(1, color.stops[1]);
  return grad;
}

interface Cell {
  x: number;
  y: number;
  shape: CursorWaveShape;
  color: CursorWaveColor;
  angle: number;
  size: number;
  scale: number;
  peak: number;
  hovered: boolean;
}

interface Ripple {
  x: number;
  y: number;
  start: number;
}

interface Pointer {
  x: number;
  y: number;
}

const CursorWave = React.forwardRef<CursorWaveHandle, CursorWaveProps>(
  (
    {
      width = "100%",
      height = "100%",
      className,
      children,
      cellSize = 40,
      influenceRadiusVmin = 30,
      attackTime = 0.5,
      releaseTime = 0.6,
      idleScale = 0.09,
      minPeakScale = 1,
      maxPeakScale = 3,
      burstSpeed = 1200,
      burstThickness = 180,
      backgroundColor = "#080808",
      shapes = DEFAULT_SHAPES,
      colors = DEFAULT_COLORS,
      dpr = 2,
      opacity = 1,
    },
    handle,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    type Runtime = {
      cells: Cell[];
      ripples: Ripple[];
      pointer: Pointer | null;
      pointerEnergy: number;
      maskRects: DOMRect[];
      maskFrame: number;
      suspendMasks: boolean;
      suspendMaskUntil: number;
      width: number;
      height: number;
      dpr: number;
      raf: number;
    };
    const runtimeRef = useRef<Runtime | null>(null);
    if (runtimeRef.current === null) {
      runtimeRef.current = {
        cells: [],
        ripples: [],
        pointer: null,
        pointerEnergy: 0,
        maskRects: [],
        maskFrame: 0,
        suspendMasks: false,
        suspendMaskUntil: 0,
        width: 0,
        height: 0,
        dpr: 1,
        raf: 0,
      };
    }

    const propsRef = useRef({
      cellSize,
      influenceRadiusVmin,
      attackTime,
      releaseTime,
      idleScale,
      minPeakScale,
      maxPeakScale,
      burstSpeed,
      burstThickness,
      backgroundColor,
      shapes,
      colors,
      opacity,
    });
    useEffect(() => {
      propsRef.current = {
        cellSize,
        influenceRadiusVmin,
        attackTime,
        releaseTime,
        idleScale,
        minPeakScale,
        maxPeakScale,
        burstSpeed,
        burstThickness,
        backgroundColor,
        shapes,
        colors,
        opacity,
      };
    }, [
      cellSize,
      influenceRadiusVmin,
      attackTime,
      releaseTime,
      idleScale,
      minPeakScale,
      maxPeakScale,
      burstSpeed,
      burstThickness,
      backgroundColor,
      shapes,
      colors,
      opacity,
    ]);

    const buildLattice = useCallback(() => {
      const rt = runtimeRef.current;
      if (!rt) return;
      const W = rt.width;
      const H = rt.height;
      const p = propsRef.current;
      const gap = Math.max(p.cellSize, 4);
      const cols = Math.max(1, Math.floor(W / gap));
      const rows = Math.max(1, Math.floor(H / gap));
      const offsetX = (W - (cols - 1) * gap) / 2;
      const offsetY = (H - (rows - 1) * gap) / 2;

      const cells: Cell[] = [];
      const shapePool = p.shapes.length > 0 ? p.shapes : DEFAULT_SHAPES;
      const colorPool = p.colors.length > 0 ? p.colors : DEFAULT_COLORS;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          cells.push({
            x: offsetX + col * gap,
            y: offsetY + row * gap,
            shape: pick(shapePool),
            color: pick(colorPool),
            angle: uniform(0, TAU),
            size: gap * 0.38,
            scale: p.idleScale,
            peak: uniform(p.minPeakScale, p.maxPeakScale),
            hovered: false,
          });
        }
      }
      rt.cells = cells;
    }, []);

    const resize = useCallback(() => {
      const rt = runtimeRef.current;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!rt || !canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const ratio = Math.min(window.devicePixelRatio || 1, Math.max(dpr, 1));

      canvas.width = w * ratio;
      canvas.height = h * ratio;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(ratio, ratio);
      }

      rt.width = w;
      rt.height = h;
      rt.dpr = ratio;
      buildLattice();
    }, [buildLattice, dpr]);

    const triggerBurst = useCallback((cx?: number, cy?: number) => {
      const rt = runtimeRef.current;
      const container = containerRef.current;
      if (!rt || !container) return;

      let lx: number;
      let ly: number;
      if (cx === undefined || cy === undefined) {
        lx = rt.width / 2;
        ly = rt.height / 2;
      } else {
        const rect = container.getBoundingClientRect();
        lx = cx - rect.left;
        ly = cy - rect.top;
      }

      rt.ripples.push({ x: lx, y: ly, start: performance.now() });

      const diag = Math.sqrt(rt.width * rt.width + rt.height * rt.height);
      const lifeMs = (diag / Math.max(propsRef.current.burstSpeed, 1)) * 1000;
      rt.suspendMasks = true;
      rt.suspendMaskUntil = performance.now() + lifeMs;
    }, []);

    useImperativeHandle(handle, () => ({ burst: triggerBurst }), [
      triggerBurst,
    ]);

    useEffect(() => {
      const rt = runtimeRef.current;
      if (!rt) return;

      resize();

      const tick = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const p = propsRef.current;
        const W = rt.width;
        const H = rt.height;
        const radius = Math.min(W, H) * (p.influenceRadiusVmin / 100);
        const now = performance.now();

        ctx.globalAlpha = 1;
        ctx.fillStyle = p.backgroundColor;
        ctx.fillRect(0, 0, W, H);

        rt.pointerEnergy *= 0.93;

        rt.maskFrame += 1;
        if (rt.maskFrame % 10 === 0 && containerRef.current) {
          const els = containerRef.current.querySelectorAll<HTMLElement>(
            "[data-cursor-wave-mask]",
          );
          const containerRect =
            containerRef.current.getBoundingClientRect();
          const rects: DOMRect[] = [];
          els.forEach((el) => {
            const r = el.getBoundingClientRect();
            rects.push(
              new DOMRect(
                r.left - containerRect.left,
                r.top - containerRect.top,
                r.width,
                r.height,
              ),
            );
          });
          rt.maskRects = rects;
        }

        if (rt.suspendMasks && now >= rt.suspendMaskUntil) {
          rt.suspendMasks = false;
        }

        const maxDist = Math.sqrt(W * W + H * H);
        rt.ripples = rt.ripples.filter(
          (w) =>
            ((now - w.start) / 1000) * p.burstSpeed <
            maxDist + p.burstThickness,
        );

        const padding = p.cellSize * 0.5;
        const attackF = settleFactor(p.attackTime);
        const releaseF = settleFactor(p.releaseTime);

        ctx.globalAlpha = p.opacity;

        for (let i = 0; i < rt.cells.length; i++) {
          const cell = rt.cells[i];

          let masked = false;
          if (!rt.suspendMasks) {
            for (let m = 0; m < rt.maskRects.length; m++) {
              const r = rt.maskRects[m];
              if (
                cell.x >= r.left - padding &&
                cell.x <= r.right + padding &&
                cell.y >= r.top - padding &&
                cell.y <= r.bottom + padding
              ) {
                masked = true;
                break;
              }
            }
          }

          if (masked) {
            cell.scale += (0 - cell.scale) * releaseF;
            if (cell.scale < 0.005) cell.scale = 0;
            continue;
          }

          let pointerInfluence = 0;
          if (rt.pointer && rt.pointerEnergy > 0.001 && radius > 0) {
            const dx = cell.x - rt.pointer.x;
            const dy = cell.y - rt.pointer.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            pointerInfluence =
              smoothstep01(1 - d / radius) * rt.pointerEnergy;

            if (pointerInfluence > 0.05 && !cell.hovered) {
              cell.hovered = true;
              cell.peak = uniform(p.minPeakScale, p.maxPeakScale);
              cell.angle = uniform(0, TAU);
            } else if (pointerInfluence <= 0.05) {
              cell.hovered = false;
            }
          } else {
            cell.hovered = false;
          }

          let waveInfluence = 0;
          for (let j = 0; j < rt.ripples.length; j++) {
            const ripple = rt.ripples[j];
            const ringR = ((now - ripple.start) / 1000) * p.burstSpeed;
            const wdx = cell.x - ripple.x;
            const wdy = cell.y - ripple.y;
            const wd = Math.sqrt(wdx * wdx + wdy * wdy);
            const t = 1 - Math.abs(wd - ringR) / p.burstThickness;
            if (t > 0) {
              const v = Math.sin(Math.PI * t);
              if (v > waveInfluence) waveInfluence = v;
            }
          }

          const span = cell.peak - p.idleScale;
          const pointerTarget = p.idleScale + pointerInfluence * span;
          const waveTarget = p.idleScale + waveInfluence * span;
          const target =
            pointerTarget > waveTarget ? pointerTarget : waveTarget;

          const f = target > cell.scale ? attackF : releaseF;
          cell.scale += (target - cell.scale) * f;

          if (cell.scale < p.idleScale * 0.15) continue;

          ctx.save();
          ctx.translate(cell.x, cell.y);
          ctx.rotate(cell.angle);
          ctx.scale(cell.scale, cell.scale);
          ctx.fillStyle = makeFill(ctx, cell.color, cell.size);
          tracePath(ctx, cell.shape, cell.size);
          ctx.fill();
          ctx.restore();
        }

        ctx.globalAlpha = 1;

        rt.raf = requestAnimationFrame(tick);
      };

      rt.raf = requestAnimationFrame(tick);

      let resizeObs: ResizeObserver | null = null;
      const target = containerRef.current;
      if (target && typeof ResizeObserver !== "undefined") {
        resizeObs = new ResizeObserver(() => resize());
        resizeObs.observe(target);
      } else {
        window.addEventListener("resize", resize);
      }

      return () => {
        cancelAnimationFrame(rt.raf);
        if (resizeObs) resizeObs.disconnect();
        else window.removeEventListener("resize", resize);
      };
    }, [resize]);

    const structuralKey = useMemo(
      () => `${cellSize}|${shapes.join(",")}|${colors.length}`,
      [cellSize, shapes, colors],
    );
    useEffect(() => {
      buildLattice();
    }, [structuralKey, buildLattice]);

    const onPointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        const rt = runtimeRef.current;
        const container = containerRef.current;
        if (!rt || !container) return;
        const rect = container.getBoundingClientRect();
        rt.pointer = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        rt.pointerEnergy = 1;
      },
      [],
    );

    const onPointerLeave = useCallback(() => {
      const rt = runtimeRef.current;
      if (!rt) return;
      rt.pointer = null;
    }, []);

    const onPointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        triggerBurst(e.clientX, e.clientY);
      },
      [triggerBurst],
    );

    return (
      <div
        ref={containerRef}
        className={cn("relative overflow-hidden", className)}
        style={{ width, height, backgroundColor }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full"
        />
        {children && (
          <div className="pointer-events-none relative z-10 h-full w-full">
            {children}
          </div>
        )}
      </div>
    );
  },
);

CursorWave.displayName = "CursorWave";

export default CursorWave;
