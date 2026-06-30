"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, Suspense, useEffect, type ReactNode } from "react";
import * as THREE from "three";
import { motion } from "motion/react";
import { RiCheckLine } from "@remixicon/react";
import { BrandMark, type BrandKey } from "@/components/brand-mark";
import { SectionCorners } from "@/components/section-corners";

// Brand orange (var(--brand) = #ea580c) for the shader glow.
const GLOW_R = 0.918;
const GLOW_G = 0.345;
const GLOW_B = 0.047;

const glowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    float centerDist = abs(vUv.x - 0.5) * 2.0;

    float coreGlow = exp(-centerDist * 180.0) * 2.5;
    float midGlow = exp(-centerDist * 66.0) * 1.2;
    float outerGlow = exp(-centerDist * 6.0) * 0.5;
    float glow = coreGlow + midGlow + outerGlow;

    float pulse = sin(uTime * 1.5) * 0.08 + 0.92;
    glow *= pulse;

    float scanLine = sin(vUv.y * 60.0 + uTime * 2.0) * 0.02 + 0.98;
    glow *= scanLine;

    vec3 glowColor = vec3(${GLOW_R}, ${GLOW_G}, ${GLOW_B});

    float edgeDist = abs(vUv.y - 0.5) * 2.0;
    float vertFade = 1.0 - smoothstep(0.2, 0.95, edgeDist);
    glow *= vertFade;

    vec3 colorOut = glowColor * glow;
    float alpha = max(max(colorOut.r, colorOut.g), colorOut.b);
    vec3 normalizedColor = colorOut / max(alpha, 0.001);
    alpha = smoothstep(0.0, 1.0, alpha);

    gl_FragColor = vec4(normalizedColor, alpha);
  }
`;

const backgroundGlowFragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    float centerDist = abs(vUv.x - 0.5) * 2.0;

    float wideGlow = exp(-centerDist * 3.0) * 0.8;
    float softGlow = exp(-centerDist * 1.0) * 0.4;
    float glow = wideGlow + softGlow;

    float pulse = sin(uTime * 1.2) * 0.1 + 0.9;
    glow *= pulse;

    vec3 glowColor = vec3(${GLOW_R}, ${GLOW_G}, ${GLOW_B});

    float edgeDistY = abs(vUv.y - 0.5) * 2.0;
    float vertFade = 1.0 - smoothstep(0.0, 1.0, edgeDistY);
    glow *= vertFade;

    float edgeDistX = abs(vUv.x - 0.5) * 2.0;
    float horizFade = 1.0 - smoothstep(0.4, 0.9, edgeDistX);
    glow *= horizFade;

    vec3 colorOut = glowColor * glow;
    float alpha = max(max(colorOut.r, colorOut.g), colorOut.b);
    vec3 normalizedColor = colorOut / max(alpha, 0.001);
    alpha = smoothstep(0.0, 1.0, alpha) * 0.6;

    gl_FragColor = vec4(normalizedColor, alpha);
  }
`;

function ResizeHandler(): null {
  const state = useThree();
  const glRef = useRef(state.gl);
  const cameraRef = useRef(state.camera);

  useEffect(() => {
    glRef.current = state.gl;
    cameraRef.current = state.camera;
  }, [state.gl, state.camera]);

  useEffect(() => {
    const canvas = state.gl.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    function updateSize() {
      const gl = glRef.current;
      const cam = cameraRef.current;
      if (!gl || !cam || !parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w > 0 && h > 0) {
        gl.setSize(w, h);
        if (cam instanceof THREE.PerspectiveCamera) {
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
        }
      }
    }

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [state.gl]);

  return null;
}

function GlowBar(): ReactNode {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const bgMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const bgUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const mat = materialRef.current;
    if (mat) {
      const u = mat.uniforms["uTime"];
      if (u) u.value = t;
    }
    const bg = bgMaterialRef.current;
    if (bg) {
      const u = bg.uniforms["uTime"];
      if (u) u.value = t;
    }
  });

  return (
    <group position={[0, 0, 2]}>
      <mesh position={[0, 0, -0.1]}>
        <planeGeometry args={[4.0, 3.0]} />
        <shaderMaterial
          ref={bgMaterialRef}
          vertexShader={glowVertexShader}
          fragmentShader={backgroundGlowFragmentShader}
          uniforms={bgUniforms}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <planeGeometry args={[0.7, 2.0]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={glowVertexShader}
          fragmentShader={glowFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </mesh>
      <GlowParticles />
    </group>
  );
}

function GlowParticles(): ReactNode {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 40;
  const fadeDistance = 1.0;

  const velocitiesRef = useRef<Float32Array>(
    new Float32Array(particleCount * 3),
  );
  const lifetimesRef = useRef<Float32Array>(new Float32Array(particleCount));

  const positions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      arr[i * 3] = 0;
      arr[i * 3 + 1] = (i / particleCount - 0.5) * 1.2;
      arr[i * 3 + 2] = (((i * 0.618) % 1.0) - 0.5) * 0.1;
    }
    return arr;
  }, []);

  useEffect(() => {
    const v = velocitiesRef.current;
    const l = lifetimesRef.current;
    for (let i = 0; i < particleCount; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      v[i * 3] = dir * (((i * 0.382) % 1.0) * 0.012 + 0.004);
      v[i * 3 + 1] = (((i * 0.786) % 1.0) - 0.4) * 0.006;
      v[i * 3 + 2] = (((i * 0.214) % 1.0) - 0.5) * 0.003;
      l[i] = (i * 0.123) % 1.0;
    }
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const opacities = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) opacities[i] = 1.0;
    geo.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));
    return geo;
  }, [positions]);

  const shaderMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(GLOW_R, GLOW_G, GLOW_B) },
          uFadeDistance: { value: fadeDistance },
        },
        vertexShader: /* glsl */ `
          attribute float aOpacity;
          varying float vOpacity;
          varying float vDistance;
          void main() {
            vOpacity = aOpacity;
            vDistance = abs(position.x);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 7.0 * (1.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uFadeDistance;
          varying float vOpacity;
          varying float vDistance;
          void main() {
            float fade = 1.0 - smoothstep(0.0, uFadeDistance, vDistance);
            vec2 center = gl_PointCoord - 0.5;
            float dist = length(center);
            float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
            float finalAlpha = alpha * fade * vOpacity * 1.5;
            gl_FragColor = vec4(uColor * 1.3, finalAlpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame((state) => {
    if (!particlesRef.current) return;
    const posAttr = particlesRef.current.geometry.attributes["position"];
    const opAttr = particlesRef.current.geometry.attributes["aOpacity"];
    if (!posAttr || !opAttr) return;
    const pos = posAttr.array as Float32Array;
    const op = opAttr.array as Float32Array;
    const v = velocitiesRef.current;
    const l = lifetimesRef.current;

    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      const cur = (l[i] ?? 0) + 0.012;
      const next = cur > 1 ? 0 : cur;
      l[i] = next;

      if (cur > 1) {
        pos[ix] = 0;
        pos[ix + 1] =
          (((i + state.clock.elapsedTime * 10) % particleCount) /
            particleCount -
            0.5) *
          1.2;
        pos[ix + 2] =
          (((i * 0.618 + state.clock.elapsedTime) % 1.0) - 0.5) * 0.1;

        const dir = i % 2 === 0 ? 1 : -1;
        v[ix] =
          dir *
          ((((i + state.clock.elapsedTime) * 0.382) % 1.0) * 0.012 + 0.004);
        v[ix + 1] =
          ((((i + state.clock.elapsedTime) * 0.786) % 1.0) - 0.4) * 0.006;
      }

      const vx = v[ix] ?? 0;
      const vy = v[ix + 1] ?? 0;
      const vz = v[ix + 2] ?? 0;
      const px = pos[ix] ?? 0;
      const py = pos[ix + 1] ?? 0;
      const pz = pos[ix + 2] ?? 0;

      const nextPx = px + vx;
      pos[ix] = nextPx;
      pos[ix + 1] =
        py + vy + Math.sin(state.clock.elapsedTime * 2 + i * 0.5) * 0.0008;
      pos[ix + 2] = pz + vz;

      op[i] = Math.max(0, 1.0 - Math.abs(nextPx) / fadeDistance);
    }

    posAttr.needsUpdate = true;
    opAttr.needsUpdate = true;
  });

  return (
    <points ref={particlesRef} geometry={geometry} material={shaderMaterial} />
  );
}

// Four agent CLIs that ship with subscription-OAuth. Positions are
// percentages within the LEFT half — each card floats around its anchor.
type Brand = {
  key: BrandKey;
  label: string;
  plan: string;
  top: string;
  left: string;
  delay: number;
};

// Positions are percentages within the LEFT half of the visual. Clustered
// near the center of that half so the cloud reads as one shape, not five
// scattered chips.
const brands: Brand[] = [
  { key: "claude", label: "Claude", plan: "Claude Pro / Max", top: "20%", left: "30%", delay: 0 },
  { key: "codex", label: "Codex", plan: "ChatGPT Plus / Pro", top: "26%", left: "60%", delay: 0.15 },
  { key: "cursor", label: "Cursor", plan: "Cursor Pro", top: "44%", left: "44%", delay: 0.3 },
  { key: "gemini", label: "Gemini", plan: "Google AI Pro", top: "62%", left: "28%", delay: 0.45 },
  { key: "grok", label: "Grok", plan: "SuperGrok", top: "66%", left: "60%", delay: 0.6 },
];

function BrandCard({ brand, index }: { brand: Brand; index: number }): ReactNode {
  return (
    <motion.div
      className="pointer-events-auto absolute flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-background shadow-md sm:h-[88px] sm:w-[88px]"
      style={{ top: brand.top, left: brand.left }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: [0, -8, 0],
        rotate: [0, 4, -4, 0],
      }}
      transition={{
        opacity: { duration: 0.5, delay: 0.2 + index * 0.1 },
        scale: { duration: 0.5, delay: 0.2 + index * 0.1 },
        y: {
          duration: 4 + index * 0.4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: brand.delay,
        },
        rotate: {
          duration: 6 + index * 0.4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: brand.delay,
        },
      }}
      aria-label={brand.label}
    >
      <BrandMark brand={brand.key} className="h-8 w-8 sm:h-9 sm:w-9" />
    </motion.div>
  );
}

function SubscriptionCard(): ReactNode {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5, duration: 0.6 }}
      className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-lg sm:p-7"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand">
        Pre-installed
      </span>
      <ul className="mt-5 space-y-3">
        {brands.map((b) => (
          <li
            key={b.key}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="inline-flex items-center gap-2.5 text-foreground">
              <BrandMark brand={b.key} className="h-4 w-4" />
              <span className="font-medium">{b.plan}</span>
            </span>
            <RiCheckLine
              className="h-4 w-4 shrink-0 text-brand"
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
        + any other CLI you install.
      </p>
    </motion.div>
  );
}

export function SubscriptionConnect(): ReactNode {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="px-6 pt-12 sm:px-10 sm:pt-16 lg:px-14 lg:pt-20">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          No API keys required
        </span>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem]">
          Connect with the{" "}
          <span className="text-brand">subscription</span> you already pay for
        </h2>
      </div>

      {/* Visual: 4 floating brand cards + subscription card. Mobile stacks
          vertically (cards on top, card below). sm+ is side-by-side with a
          vertical GlowBar divider. Pattern adapted from React Bits Pro
          hero-13. */}
      <div className="relative mt-10 flex min-h-[640px] w-full flex-col overflow-hidden sm:block sm:min-h-[540px] lg:min-h-[600px]">
        {/* GlowBar shader — vertical divider at 50%, sm+ only */}
        <div className="pointer-events-none absolute inset-0 z-0 hidden sm:block">
          <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
            <ResizeHandler />
            <Suspense fallback={null}>
              <GlowBar />
            </Suspense>
          </Canvas>
        </div>

        {/* Brand cards: top section on mobile, left half on sm+ */}
        <div className="relative z-10 h-[340px] w-full shrink-0 sm:absolute sm:inset-y-0 sm:left-0 sm:h-auto sm:w-1/2">
          {brands.map((b, i) => (
            <BrandCard key={b.key} brand={b} index={i} />
          ))}
        </div>

        {/* Subscription card: bottom section on mobile (full width, centered),
            right half on sm+ */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-10 sm:absolute sm:inset-y-0 sm:right-0 sm:w-1/2 sm:px-10 sm:pb-0">
          <SubscriptionCard />
        </div>

        {/* Bottom fade so the visual never crowds the section edge */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-20 bg-gradient-to-t from-background to-transparent"
        />
      </div>
      <SectionCorners />
    </section>
  );
}
