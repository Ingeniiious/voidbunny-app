"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useSpring, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

// Companion to react-bits/device.tsx — that file's an iPhone, this one's a
// MacBook-style laptop frame. Same API surface (children/scale/parallax/
// rotate/autoAnimate) so the two are interchangeable inside a showcase grid.
// Pure CSS frame; no extra deps beyond motion (already in the site app).

export interface DeviceLaptopProps {
  scale?: number;
  enableParallax?: boolean;
  parallaxStrength?: number;
  enableRotate?: boolean;
  rotateStrength?: number;
  autoAnimate?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Reference dimensions at scale=1. 16:10 screen + a thin chin below, in line
// with a modern MacBook's display proportions (1280×800 logical → 64×40rem).
const SCREEN_WIDTH_REM = 64;
const SCREEN_HEIGHT_REM = 40;
const CHIN_HEIGHT_REM = 1.4;
const BASE_OVERHANG_REM = 1.2; // base sticks out a touch wider than the lid

const DeviceLaptop = React.forwardRef<HTMLDivElement, DeviceLaptopProps>(
  (
    {
      scale = 1,
      enableParallax = true,
      parallaxStrength = 12,
      enableRotate = true,
      rotateStrength = 2.5,
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

    const springConfig = { stiffness: 200, damping: 25, mass: 0.5 };
    const springX = useSpring(x, springConfig);
    const springY = useSpring(y, springConfig);
    const springRotateX = useSpring(rotateX, springConfig);
    const springRotateY = useSpring(rotateY, springConfig);

    useEffect(() => {
      if (!autoAnimate) return;
      // Use a slightly different phase from device.tsx so a constellation of
      // mixed devices doesn't drift in lockstep — reads as separate objects
      // rather than one rigid composition.
      let time = 1.6;
      const animate = () => {
        time += 0.004;
        const mx = Math.sin(time) * 0.7;
        const my = Math.sin(time * 1.2) * 0.5;
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
          animate={{ scale: isHovering || autoAnimate ? 1.015 : 1 }}
          transition={{ scale: { type: "spring", stiffness: 300, damping: 25 } }}
          className="relative"
        >
          {/* Lid: screen + thin chin under the display */}
          <div
            className="relative select-none rounded-[1.8rem] bg-[#1a1a1a] transition-shadow duration-300"
            style={{
              width: `${SCREEN_WIDTH_REM}rem`,
              height: `${SCREEN_HEIGHT_REM + CHIN_HEIGHT_REM}rem`,
              padding: `1rem 1rem ${CHIN_HEIGHT_REM}rem`,
              boxShadow:
                isHovering || autoAnimate
                  ? "0 30px 60px -12px rgba(0,0,0,0.45), 0 18px 36px -18px rgba(0,0,0,0.3)"
                  : "0 0 2rem 0.5rem rgba(0,0,0,0.18)",
            }}
          >
            {/* Camera notch — tiny dimple at top center of the bezel */}
            <div className="absolute left-1/2 top-[0.35rem] -translate-x-1/2 h-[0.45rem] w-[5rem] rounded-b-[0.5rem] bg-black z-10 flex items-center justify-center">
              <span className="block h-[0.2rem] w-[0.2rem] rounded-full bg-[#2a2a2a]" />
            </div>

            {/* Screen */}
            <div className="relative h-full w-full overflow-hidden rounded-[0.7rem] bg-black">
              {children}
            </div>

            {/* Apple-mark suggestion below the screen (just a centered dot) */}
            <div
              aria-hidden="true"
              className="absolute bottom-[0.3rem] left-1/2 -translate-x-1/2 h-[0.4rem] w-[0.4rem] rounded-full bg-[#3a3a3a] opacity-60"
            />

            {/* Outer ring — faint highlight to suggest aluminium edge */}
            <div className="pointer-events-none absolute inset-0 rounded-[1.8rem] ring-1 ring-white/10" />
          </div>

          {/* Base / hinge suggestion — a thin trapezoidal slab below the lid */}
          <div
            aria-hidden="true"
            className="relative mx-auto"
            style={{
              width: `${SCREEN_WIDTH_REM + BASE_OVERHANG_REM * 2}rem`,
              height: "0.6rem",
              marginTop: "-0.1rem",
              background:
                "linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 40%, #0e0e0e 100%)",
              borderBottomLeftRadius: "0.6rem",
              borderBottomRightRadius: "0.6rem",
              boxShadow: "0 1.2rem 1.6rem -1rem rgba(0,0,0,0.5)",
            }}
          >
            {/* Hinge slot — darker centered notch */}
            <div className="absolute left-1/2 top-0 h-[0.12rem] w-[12rem] -translate-x-1/2 rounded-full bg-black/60" />
          </div>
        </motion.div>
      </div>
    );
  },
);

DeviceLaptop.displayName = "DeviceLaptop";

export default DeviceLaptop;
