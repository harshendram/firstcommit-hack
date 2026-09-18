"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * The beacon over the active objective.
 *
 * Floats high enough to clear rooftops, so you can spot it from across the
 * village rather than having to already know where you are going.
 *
 * The ground it stands on is passed in from `lib/landmarks.ts`, not found with
 * a ray. It used to cast for itself and take the first hit, and on one run
 * that first hit was the Teammates board — which had mis-measured its own
 * height the same way — so the beacon hovered at y = 2.76, standing on a sign
 * standing on nothing.
 */

/** How far above the ground the diamond hovers. */
const MARKER_LIFT = 2.2;

export function QuestMarker({
  at,
  ground,
}: {
  at: [number, number] | null;
  /** Measured world Y of the floor under `at`. */
  ground: number | null;
}) {
  const group = useRef<THREE.Group>(null);

  const shaft = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "rgba(255, 214, 130, 0)");
    g.addColorStop(0.55, "rgba(255, 201, 96, 0.34)");
    g.addColorStop(1, "rgba(255, 186, 64, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3a2a12",
        emissive: new THREE.Color("#ffbe4d"),
        emissiveIntensity: 2.2,
        roughness: 0.25,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = group.current;
    if (!g || ground === null) return;
    const t = performance.now() / 1000;
    g.rotation.y = t * 0.9;
    g.position.y = ground + MARKER_LIFT + Math.sin(t * 1.6) * 0.12;
    mat.emissiveIntensity = 2.0 + Math.sin(t * 2.4) * 0.5;
  });

  if (!at || ground === null) return null;

  return (
    <group
      ref={group}
      position={[at[0], ground + MARKER_LIFT, at[1]]}
      userData={{ camIgnore: true }}
    >
      <mesh material={mat}>
        <octahedronGeometry args={[0.22, 0]} />
      </mesh>

      {/* Shaft down to the ground so the marker reads as standing somewhere,
          not floating in space. Double-sided, unlit, never raycast. */}
      <mesh position={[0, -MARKER_LIFT / 2, 0]} raycast={() => null}>
        <planeGeometry args={[0.3, MARKER_LIFT]} />
        <meshBasicMaterial
          map={shaft}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh
        position={[0, -MARKER_LIFT / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        raycast={() => null}
      >
        <planeGeometry args={[0.3, MARKER_LIFT]} />
        <meshBasicMaterial
          map={shaft}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
