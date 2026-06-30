"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useSpring, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

// Apple Watch–style frame. Same API surface as device.tsx /
// device-laptop.tsx / device-tablet.tsx so it slots cleanly anywhere a
// device frame is expected.
//
// Renders the watch body + crown + side button + the rounded-squircle
// screen. Strap suggestions (curves above/below) are intentionally
// omitted — without a 3D model they tend to look fake; better to let
// the watch float against the section's dark backdrop.

export interface DeviceWatchProps {
  scale?: number;
  enableParallax?: boolean;
  parallaxStrength?: number;
  enableRotate?: boolean;
  rotateStrength?: number;
  autoAnimate?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Watch Series-class proportions at scale=1: 20rem × 24rem total body,
// 16rem × 20rem usable screen area inside the bezel.
const WATCH_WIDTH_REM = 20;
const WATCH_HEIGHT_REM = 24;

const DeviceWatch = React.forwardRef<HTMLDivElement, DeviceWatchProps>(
  (
    {
      scale = 1,
      enableParallax = true,
      parallaxStrength = 8,
      enableRotate = true,
      rotateStrength = 3,
      autoAnimate = false,
      className,
      children,
    },
    ref,
  ) => {
    const deviceRef = useRef<HTMLDivElement>(null);
    const [isHovering, setIsHovering] = useState(false);
    const animationFrameRef = useRef<number | undefined>(undefined);

    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const rotateX = useMotionValue(0);
    const rotateY = useMotionValue(0);

    const springConfig = { stiffness: 220, damping: 22, mass: 0.4 };
    const springX = useSpring(x, springConfig);
    const springY = useSpring(y, springConfig);
    const springRotateX = useSpring(rotateX, springConfig);
    const springRotateY = useSpring(rotateY, springConfig);

    useEffect(() => {
      if (!autoAnimate) return;
      // Slower phase than the showcase devices — the watch is the focal
      // point of a hero section, so the drift should breathe rather than
      // wobble.
      let time = 0;
      const animate = () => {
        time += 0.0025;
        const mx = Math.sin(time) * 0.6;
        const my = Math.sin(time * 0.9) * 0.5;
        if (enableParallax) {
          x.set(mx * parallaxStrength);
          y.set(-my * parallaxStrength);
        }
        if (enableRotate) {
          rotateX.set(-my * rotateStrength);
          rotateY.set(mx * rotateStrength);
        }
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      animationFrameRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };
    }, [autoAnimate, enableParallax, enableRotate, parallaxStrength, rotateStrength, x, y, rotateX, rotateY]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (autoAnimate || !deviceRef.current) return;
      const rect = deviceRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const mx = (e.clientX - cx) / (rect.width / 2);
      const my = (e.clientY - cy) / (rect.height / 2);
      if (enableParallax) {
        x.set(mx * parallaxStrength);
        y.set(-my * parallaxStrength);
      }
      if (enableRotate) {
        rotateX.set(-my * rotateStrength);
        rotateY.set(mx * rotateStrength);
      }
    };

    const handleMouseLeave = () => {
      if (autoAnimate) return;
      setIsHovering(false);
      x.set(0); y.set(0); rotateX.set(0); rotateY.set(0);
    };

    return (
      <div
        ref={ref}
        className={cn("relative inline-block", className)}
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        <motion.div
          ref={deviceRef}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => !autoAnimate && setIsHovering(true)}
          onMouseLeave={handleMouseLeave}
          style={{
            x: springX,
            y: springY,
            rotateX: springRotateX,
            rotateY: springRotateY,
            transformStyle: "preserve-3d",
            display: "inline-block",
          }}
          animate={{ scale: isHovering || autoAnimate ? 1.02 : 1 }}
          transition={{ scale: { type: "spring", stiffness: 300, damping: 25 } }}
          className="relative"
        >
          {/* Body — rounded-rectangle aluminium case */}
          <div
            className="relative select-none transition-shadow duration-300"
            style={{
              width: `${WATCH_WIDTH_REM}rem`,
              height: `${WATCH_HEIGHT_REM}rem`,
              padding: "1.5rem 1.6rem",
              borderRadius: "4.5rem",
              background:
                "linear-gradient(155deg, #2a2a2c 0%, #1a1a1c 45%, #0f0f10 100%)",
              boxShadow:
                isHovering || autoAnimate
                  ? "0 40px 80px -20px rgba(0,0,0,0.55), 0 24px 48px -24px rgba(0,0,0,0.4)"
                  : "0 0 3rem 1rem rgba(0,0,0,0.25)",
            }}
          >
            {/* Screen — rounded squircle with glossy gradient overlay */}
            <div
              className="relative h-full w-full overflow-hidden bg-black"
              style={{ borderRadius: "3.4rem" }}
            >
              {children}
              {/* Glass sheen — top-left highlight */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  borderRadius: "3.4rem",
                  background:
                    "radial-gradient(ellipse 60% 40% at 25% 15%, rgba(255,255,255,0.18) 0%, transparent 60%)",
                }}
              />
            </div>

            {/* Outer ring — anodized aluminium edge */}
            <div
              className="pointer-events-none absolute inset-0 ring-1 ring-white/12"
              style={{ borderRadius: "4.5rem" }}
            />

            {/* Digital Crown — right side, upper-middle */}
            <div
              aria-hidden="true"
              className="absolute right-[-0.65rem] top-[7rem]"
              style={{
                width: "1.1rem",
                height: "2.2rem",
                borderRadius: "0.55rem",
                background:
                  "linear-gradient(90deg, #3a3a3c 0%, #5a5a5c 50%, #2a2a2c 100%)",
                boxShadow: "inset 0 0 0.2rem rgba(0,0,0,0.6), 0 0 0.4rem rgba(0,0,0,0.4)",
              }}
            >
              {/* Crown grooves — vertical ridges */}
              <div className="flex h-full w-full flex-col items-center justify-center gap-[0.15rem] py-1">
                {[...Array(7)].map((_, i) => (
                  <div
                    key={i}
                    className="h-px w-[0.7rem] bg-black/40"
                  />
                ))}
              </div>
            </div>

            {/* Side button — right side, below the crown */}
            <div
              aria-hidden="true"
              className="absolute right-[-0.4rem] top-[12rem]"
              style={{
                width: "0.7rem",
                height: "3rem",
                borderRadius: "0.35rem",
                background:
                  "linear-gradient(90deg, #2a2a2c 0%, #4a4a4c 50%, #1a1a1c 100%)",
                boxShadow: "inset 0 0 0.2rem rgba(0,0,0,0.6)",
              }}
            />
          </div>
        </motion.div>
      </div>
    );
  },
);

DeviceWatch.displayName = "DeviceWatch";

export default DeviceWatch;
