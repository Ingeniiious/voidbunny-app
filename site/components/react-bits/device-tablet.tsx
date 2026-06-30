"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useSpring, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

// iPad-style tablet frame. Same API surface as device.tsx and
// device-laptop.tsx so the three slot into the same showcase.
// Portrait orientation, thinner uniform bezel, single camera dot at top.

export interface DeviceTabletProps {
  scale?: number;
  enableParallax?: boolean;
  parallaxStrength?: number;
  enableRotate?: boolean;
  rotateStrength?: number;
  autoAnimate?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Reference dimensions at scale=1. iPad Pro 11" is 1668×2388 logical (~3:4.3),
// rounded to 36×48rem here so it sits between the phone and the laptop in a
// constellation without dominating.
const TABLET_WIDTH_REM = 36;
const TABLET_HEIGHT_REM = 48;

const DeviceTablet = React.forwardRef<HTMLDivElement, DeviceTabletProps>(
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
      // Distinct phase so a constellation of devices reads as separate
      // objects rather than synchronized siblings.
      let time = 3.1;
      const animate = () => {
        time += 0.0045;
        const mx = Math.sin(time) * 0.7;
        const my = Math.sin(time * 1.1) * 0.55;
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
          <div
            className="relative select-none rounded-[2.4rem] bg-[#1a1a1a] transition-shadow duration-300"
            style={{
              width: `${TABLET_WIDTH_REM}rem`,
              height: `${TABLET_HEIGHT_REM}rem`,
              padding: "1.3rem",
              boxShadow:
                isHovering || autoAnimate
                  ? "0 30px 60px -12px rgba(0,0,0,0.45), 0 18px 36px -18px rgba(0,0,0,0.3)"
                  : "0 0 2rem 0.5rem rgba(0,0,0,0.18)",
            }}
          >
            {/* Camera dot at top center */}
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-[0.5rem] -translate-x-1/2 h-[0.4rem] w-[0.4rem] rounded-full bg-[#2a2a2a] ring-1 ring-black/60 z-10"
            />

            {/* Screen */}
            <div className="relative h-full w-full overflow-hidden rounded-[1.2rem] bg-black">
              {children}
            </div>

            {/* Outer ring — faint aluminium edge */}
            <div className="pointer-events-none absolute inset-0 rounded-[2.4rem] ring-1 ring-white/10" />
          </div>
        </motion.div>
      </div>
    );
  },
);

DeviceTablet.displayName = "DeviceTablet";

export default DeviceTablet;
