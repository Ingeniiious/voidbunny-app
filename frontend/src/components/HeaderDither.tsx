import { Mesh, Program, Renderer, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';

// Ported from site/components/dither-shader.tsx and tuned for the panel
// header strip: much slower time, gentler mouse warp, no logo silhouette,
// transparent so panel-surface shows through. Respects prefers-reduced-motion.

const vertexShader = /* glsl */ `#version 300 es
  in vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `#version 300 es
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  iMouse;
  uniform float iMouseActive;
  uniform vec3  uGlyphColor;

  out vec4 fragColor;

  const float kBayer[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );

  float box(vec2 p, vec2 c, vec2 h) {
    vec2 q = abs(p - c) - h;
    return (1.0 - step(0.0, q.x)) * (1.0 - step(0.0, q.y));
  }

  float synthesizeCharacter(vec2 uv, float lum) {
    vec2 p = uv * 2.0 - 1.0;
    int tier = int(clamp(lum * 5.0, 0.0, 4.0));
    if (tier == 0) return 0.0;
    if (tier == 1) return 1.0 - step(0.2, length(p));
    if (tier == 2) return box(p, vec2(0.0), vec2(0.6, 0.2));
    if (tier == 3) {
      return max(box(p, vec2(0.0), vec2(0.6, 0.2)),
                 box(p, vec2(0.0), vec2(0.2, 0.6)));
    }
    float bounds = box(p, vec2(0.0), vec2(0.8));
    float bars = max(
      max(box(p, vec2(0.0,  0.3), vec2(1.0, 0.15)),
          box(p, vec2(0.0, -0.3), vec2(1.0, 0.15))),
      max(box(p, vec2( 0.3, 0.0), vec2(0.15, 1.0)),
          box(p, vec2(-0.3, 0.0), vec2(0.15, 1.0)))
    );
    return bars * bounds;
  }

  float computeBayer(vec2 cell) {
    ivec2 q = ivec2(mod(cell, 4.0));
    return kBayer[q.x + q.y * 4] / 16.0;
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;

    float gridResolution = 12.0;
    vec2 cellIndex = floor(fragCoord / gridResolution);
    vec2 localUV   = fract(fragCoord / gridResolution);

    float aspect = iResolution.x / iResolution.y;
    vec2 uv = (cellIndex * gridResolution) / iResolution.xy * 2.0 - 1.0;
    uv.x *= aspect;

    vec2 m = iMouse / iResolution.xy * 2.0 - 1.0;
    m.x *= aspect;

    vec2  d = uv - m;
    float r = length(d);
    vec2  perp = vec2(-d.y, d.x);
    float shear = exp(-r * 2.6) * (1.0 - exp(-r * 6.0)) * iMouseActive;
    vec2  warped = uv + normalize(perp + 1e-5) * shear * 0.18;

    float time = iTime * 0.10;
    float baseLuminance = (
      sin(warped.x * 3.2 + time) +
      sin(warped.y * 3.2 + time) +
      sin(warped.x * warped.y * 5.0 - time) +
      sin(length(warped) * 5.0 - time * 2.0)
    ) * 0.25 + 0.5;

    baseLuminance = pow(smoothstep(0.15, 0.95, baseLuminance), 0.75);
    baseLuminance *= 1.0 - smoothstep(0.55, 0.0, r) * iMouseActive * 0.6;

    float adjustedLuminance = clamp(
      baseLuminance + (computeBayer(cellIndex) - 0.5) * 0.5,
      0.0, 1.0
    );

    float mask = synthesizeCharacter(localUV, adjustedLuminance);

    fragColor = vec4(uGlyphColor, mask);
  }
`;

function isWebGL2Supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// `tint='orange'` (default) — brand orange in light mode, used in the header.
// `tint='gray'` — neutral gray in light mode, used inside the mobile sidebar
// drawer where orange dots were drowning the file-tree text. Dark mode is the
// same near-white either way (mix-blend-overlay handles the contrast and we
// haven't seen a readability problem there).
type DitherTint = 'orange' | 'gray';

function readGlyphColor(tint: DitherTint): [number, number, number] {
  const dark = document.documentElement.classList.contains('dark');
  if (dark) return [0.85, 0.85, 0.88];
  // Light-mode tints:
  //  - orange: orange-400 / #FB923C
  //  - gray:   gray-400   / #9CA3AF (chosen to read at the same weight as the
  //    orange but recede behind text instead of competing with it)
  return tint === 'gray' ? [0.612, 0.639, 0.686] : [0.984, 0.573, 0.235];
}

interface HeaderDitherProps {
  tint?: DitherTint;
}

export default function HeaderDither({ tint = 'orange' }: HeaderDitherProps = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Stash the live `tint` in a ref so the theme observer (created once in the
  // mount-only effect below) reads the current value instead of a stale
  // closure capture. Same pattern TerminalTab uses for `onOpenUrl`. Avoids
  // tearing down and rebuilding the WebGL context every time tint changes.
  const tintRef = useRef(tint);
  tintRef.current = tint;
  const glyphColorRef = useRef<[number, number, number]>(readGlyphColor(tint));

  // Repaint immediately if the tint prop changes at runtime (e.g. the parent
  // swaps it from gray→orange). The render loop reads glyphColorRef every
  // frame, so just mutating the ref is enough — no context teardown needed.
  useEffect(() => {
    glyphColorRef.current = readGlyphColor(tint);
  }, [tint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!isWebGL2Supported()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        dpr: Math.min(window.devicePixelRatio, 2),
      });
    } catch {
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);
    gl.canvas.style.display = 'block';
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      transparent: true,
      uniforms: {
        iResolution: { value: [1, 1] },
        iTime: { value: 0 },
        iMouse: { value: [0, 0] },
        iMouseActive: { value: 0 },
        uGlyphColor: { value: glyphColorRef.current.slice() },
      },
    });

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const target = { x: 0, y: 0, active: 0 };
    const current = { x: 0, y: 0, active: 0 };

    const resize = (): void => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight);
      program.uniforms.iResolution.value = [
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
      ];
      if (current.x === 0 && current.y === 0) {
        current.x = gl.drawingBufferWidth / 2;
        current.y = gl.drawingBufferHeight / 2;
        target.x = current.x;
        target.y = current.y;
      }
    };

    const handlePointerMove = (event: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      const dpr = gl.drawingBufferWidth / rect.width;
      target.x = (event.clientX - rect.left) * dpr;
      target.y = (rect.height - (event.clientY - rect.top)) * dpr;
      target.active = 1;
    };

    const handlePointerLeave = (): void => { target.active = 0; };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Pointer listeners go on window so events bubble up past the buttons
    // sitting in front of the canvas. We translate window coords into the
    // header's local box and only activate when the cursor is inside it.
    const handleWindowPointer = (event: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top  && event.clientY <= rect.bottom;
      if (!inside) { target.active = 0; return; }
      handlePointerMove(event);
    };

    window.addEventListener('pointermove', handleWindowPointer, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);

    // Repaint glyph color when the user toggles theme (dark/light class on <html>).
    const themeObserver = new MutationObserver(() => {
      glyphColorRef.current = readGlyphColor(tintRef.current);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    let frameId = 0;
    const start = performance.now();

    const render = (): void => {
      current.x += (target.x - current.x) * 0.10;
      current.y += (target.y - current.y) * 0.10;
      current.active += (target.active - current.active) * 0.05;

      const gc = program.uniforms.uGlyphColor.value as number[];
      gc[0] = glyphColorRef.current[0];
      gc[1] = glyphColorRef.current[1];
      gc[2] = glyphColorRef.current[2];

      program.uniforms.iTime.value = (performance.now() - start) / 1000;
      program.uniforms.iMouse.value = [current.x, current.y];
      program.uniforms.iMouseActive.value = current.active;

      renderer.render({ scene: mesh });
      frameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('pointermove', handleWindowPointer);
      window.removeEventListener('pointerleave', handlePointerLeave);
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  // Blend strategy diverges by theme:
  //  - Dark: opacity-50 + mix-blend-overlay → glyph multiplies into the dark
  //    surface as subtle highlights (works well because overlay screens light
  //    fg over dark bg).
  //  - Light: no blend mode + lower opacity → straight alpha-blend of the
  //    orange glyph over the near-white surface. mix-blend-overlay was
  //    washing the orange almost entirely white against a 0.96-bright bg.
  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-50 dark:mix-blend-overlay"
    />
  );
}
