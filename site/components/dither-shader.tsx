"use client";

import { Mesh, Program, Renderer, Texture, Triangle } from "ogl";
import { useTheme } from "next-themes";
import { useEffect, useRef, type ReactNode } from "react";

const vertexShader = /* glsl */ `#version 300 es
  in vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `#version 300 es
  precision highp float;

  uniform vec2  iResolution;
  uniform float iTime;
  uniform vec2  iMouse;
  uniform float iMouseActive;
  uniform float uTheme;
  uniform float uVariant;
  uniform float uTransparent;
  uniform vec3  uGlyphColor;
  uniform sampler2D uLogo;
  uniform float uLogoFade;
  uniform float uLogoEnabled;

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

    float gridResolution = mix(10.0, 14.0, uVariant);
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
    float shear = exp(-r * 2.2) * (1.0 - exp(-r * 6.0)) * iMouseActive;
    vec2  warped = uv + normalize(perp + 1e-5) * shear * 0.35;

    float timeScale  = mix(0.5, 0.22, uVariant);
    float waveFreq   = mix(5.0, 3.4,  uVariant);
    float radialFreq = mix(10.0, 6.0, uVariant);
    float time = iTime * timeScale;
    float baseLuminance = (
      sin(warped.x * waveFreq + time) +
      sin(warped.y * waveFreq + time) +
      sin(warped.x * warped.y * radialFreq - time) +
      sin(length(warped) * radialFreq - time * 2.0)
    ) * 0.25 + 0.5;

    baseLuminance = pow(smoothstep(0.15, 0.95, baseLuminance), 0.75);
    baseLuminance *= 1.0 - smoothstep(0.45, 0.0, r) * iMouseActive * 0.85;

    // Sample the logo silhouette in the cell's UV, fit-contain centred.
    vec2 cellUvNorm = (cellIndex + 0.5) * gridResolution / iResolution.xy;
    float minDim = min(iResolution.x, iResolution.y);
    vec2 logoUv = (cellUvNorm - 0.5) * iResolution.xy / minDim / 0.92 + 0.5;
    float inBounds =
      step(0.0, logoUv.x) * step(logoUv.x, 1.0) *
      step(0.0, logoUv.y) * step(logoUv.y, 1.0);
    float logoMask = texture(uLogo, logoUv).a * inBounds;
    logoMask = smoothstep(0.35, 0.65, logoMask);

    // When idle, push luminance up inside the silhouette and down outside it
    // so the dither pools into a rabbit shape; on hover it dissolves back.
    float logoBias = (logoMask - 0.5) * 2.0;
    baseLuminance = clamp(
      baseLuminance + logoBias * uLogoFade * uLogoEnabled * 0.7,
      0.0, 1.0
    );

    float adjustedLuminance = clamp(
      baseLuminance + (computeBayer(cellIndex) - 0.5) * 0.5,
      0.0, 1.0
    );

    float mask = synthesizeCharacter(localUV, adjustedLuminance);

    vec3 bg = mix(vec3(1.0), vec3(0.039), uTheme);
    vec3 fg = mix(vec3(0.0), vec3(0.98),  uTheme);
    vec3 themedColor = mix(bg, fg, mask);

    // Premultiplied alpha: rgb must be multiplied by alpha so iOS Safari's
    // WebGL compositor doesn't bleed glyph color into transparent cells.
    float outAlpha = mix(1.0, mask, uTransparent);
    vec3 outRgb = mix(themedColor, uGlyphColor * mask, uTransparent);
    fragColor = vec4(outRgb, outAlpha);
  }
`;

export type DitherVariant = "hero" | "cta";
export type DitherTone = { r: number; g: number; b: number };

function isWebGL2Supported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

export function DitherShader({
  variant = "hero",
  tone,
  logo,
}: {
  variant?: DitherVariant;
  tone?: DitherTone;
  logo?: string;
} = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();

  const themeTargetRef = useRef(0);
  const variantRef = useRef(variant === "cta" ? 1 : 0);
  const transparentRef = useRef(tone ? 1 : 0);
  const glyphColorRef = useRef<[number, number, number]>(
    tone ? [tone.r, tone.g, tone.b] : [0.85, 0.85, 0.85]
  );
  const logoSrcRef = useRef(logo);

  useEffect(() => {
    variantRef.current = variant === "cta" ? 1 : 0;
  }, [variant]);

  useEffect(() => {
    transparentRef.current = tone ? 1 : 0;
    if (tone) {
      glyphColorRef.current = [tone.r, tone.g, tone.b];
    }
  }, [tone]);

  useEffect(() => {
    themeTargetRef.current = resolvedTheme === "dark" ? 1 : 0;
  }, [resolvedTheme]);

  useEffect(() => {
    logoSrcRef.current = logo;
  }, [logo]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!isWebGL2Supported()) return;

    const transparent = transparentRef.current === 1;
    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: transparent,
        premultipliedAlpha: true,
        dpr: Math.min(window.devicePixelRatio, 2),
      });
    } catch {
      return;
    }

    const gl = renderer.gl;
    if (transparent) {
      gl.clearColor(0, 0, 0, 0);
    } else if (themeTargetRef.current === 1) {
      gl.clearColor(0.039, 0.039, 0.039, 1);
    } else {
      gl.clearColor(1, 1, 1, 1);
    }

    container.appendChild(gl.canvas);
    gl.canvas.style.display = "block";
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";

    const logoTexture = new Texture(gl, {
      generateMipmaps: false,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    });
    const logoEnabledRef = { value: 0 };
    const logoSrc = logoSrcRef.current;
    if (logoSrc) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        logoTexture.image = img;
        logoEnabledRef.value = 1;
      };
      img.src = logoSrc;
    }

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        iResolution: { value: [1, 1] },
        iTime: { value: 0 },
        iMouse: { value: [0, 0] },
        iMouseActive: { value: 0 },
        uTheme: { value: themeTargetRef.current },
        uVariant: { value: variantRef.current },
        uTransparent: { value: transparentRef.current },
        uGlyphColor: { value: glyphColorRef.current.slice() },
        uLogo: { value: logoTexture },
        uLogoFade: { value: 0 },
        uLogoEnabled: { value: 0 },
      },
    });

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const target = { x: 0, y: 0, active: 0 };
    const current = { x: 0, y: 0, active: 0, logoFade: 0 };

    const resize = (): void => {
      const { clientWidth, clientHeight } = container;
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

    const handlePointerLeave = (): void => {
      target.active = 0;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    container.addEventListener("pointermove", handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", handlePointerLeave);

    let frameId = 0;
    const start = performance.now();

    const render = (): void => {
      current.x += (target.x - current.x) * 0.12;
      current.y += (target.y - current.y) * 0.12;
      current.active += (target.active - current.active) * 0.06;

      const themeNow = program.uniforms.uTheme.value as number;
      program.uniforms.uTheme.value =
        themeNow + (themeTargetRef.current - themeNow) * 0.12;

      program.uniforms.uVariant.value = variantRef.current;
      program.uniforms.uTransparent.value = transparentRef.current;
      const gc = program.uniforms.uGlyphColor.value as number[];
      gc[0] = glyphColorRef.current[0];
      gc[1] = glyphColorRef.current[1];
      gc[2] = glyphColorRef.current[2];

      const logoTargetFade = 1 - current.active;
      current.logoFade += (logoTargetFade - current.logoFade) * 0.03;

      program.uniforms.iTime.value = (performance.now() - start) / 1000;
      program.uniforms.iMouse.value = [current.x, current.y];
      program.uniforms.iMouseActive.value = current.active;
      program.uniforms.uLogoFade.value = current.logoFade;
      program.uniforms.uLogoEnabled.value = logoEnabledRef.value;

      renderer.render({ scene: mesh });
      frameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
