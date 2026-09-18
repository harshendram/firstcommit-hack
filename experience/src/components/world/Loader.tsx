"use client";

import { useProgress } from "@react-three/drei";
import { gsap } from "gsap";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";

const LoadingScreen = ({ images }: { images: string[] }) => {
  const { progress } = useProgress();
  const bgRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const handleResize = () => {
      setIsPortrait(window.innerWidth < window.innerHeight);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (bgRef.current) {
      gsap.to(bgRef.current, {
        x: 20,
        rotation: 1,
        duration: 10,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }
    if (fgRef.current) {
      gsap.to(fgRef.current, {
        x: -40,
        rotation: -3,
        duration: 12,
        scale: 0.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }
  }, []);

  useEffect(() => {
    if (progressBarRef.current) {
      gsap.to(progressBarRef.current, {
        width: `${progress}%`,
        duration: 6,
        ease: "power1.out",
      });
    }
  }, [progress]);

  return (
    <div style={styles.loadingScreen} className="z-50">
      <div style={styles.bgImageContainer} ref={bgRef} className="relative scale-[120%]">
        <Image
          src={images[0]!}
          alt="Background Layer"
          fill
          className="object-cover"
          priority
          unoptimized
        />
      </div>

      <div
        style={{
          ...styles.fgImageContainer,
          ...(isPortrait ? styles.fgImageContainerPortrait : {}),
        }}
        ref={fgRef}
        className="relative"
      >
        <Image
          src={images[1]!}
          alt="Foreground Layer"
          fill
          className="object-cover"
          unoptimized
        />
      </div>

      <div style={styles.overlay} />

      <div style={styles.loadingContent}>
        <p style={styles.loadingText}>LOADING</p>
        <div style={styles.progressBarContainer}>
          <div ref={progressBarRef} style={styles.progressBar} />
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;

const styles = {
  loadingScreen: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    zIndex: 9999,
    backgroundColor: "#000",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  bgImageContainer: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  fgImageContainer: {
    position: "absolute" as const,
    bottom: "-330px",
    left: "-50px",
    width: "100%",
    height: "160%",
    transform: "translate(-2.1px, -2px)",
  },
  fgImageContainerPortrait: {
    bottom: "-200",
    left: "0",
    width: "120%",
    height: "120%",
  },
  overlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  loadingContent: {
    width: "90%",
    position: "absolute" as const,
    bottom: 0,
    zIndex: 2,
    textAlign: "right" as const,
    color: "#fff",
  },
  progressBarContainer: {
    width: "100%",
    height: "10px",
    border: "2px solid rgba(221,221,221,0.64)",
    margin: "0 auto",
    marginBottom: "10px",
    position: "relative" as const,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "rgba(221,221,221,0.47)",
    width: "0%",
  },
  loadingText: {
    fontFamily: "sans-serif",
    fontSize: "1.5rem",
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    textShadow: "1px 1px 2px rgba(0,0,0,0.7)",
  },
};
