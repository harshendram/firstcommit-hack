"use client";

import { Billboard } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

import { signTexture } from "@/components/world/AwsGallery";

/**
 * A carved plaque that reads correctly from either side.
 *
 * Two back-to-back planes: the front carries the normal texture, the back a
 * horizontally flipped copy, both `FrontSide`. Whichever way it ends up facing,
 * the words come out the right way round.
 *
 * This is deliberate belt-and-braces. Every plaque in the gallery was once
 * rotated to face into its own wall, so the viewer saw the back of a
 * `DoubleSide` plane and every heading read backwards. Rotations are correct
 * now (derived in `lib/gallery.ts`), but this makes that class of bug
 * impossible rather than merely fixed.
 */
export function Plaque({
  title,
  subtitle,
  width,
  height,
  ...props
}: {
  title: string;
  subtitle?: string;
  width: number;
  height: number;
} & React.ComponentProps<"group">) {
  const aspect = width / height;

  const [front, back] = useMemo(
    () =>
      [false, true].map(
        (mirrored) =>
          new THREE.MeshStandardMaterial({
            map: signTexture(title, { subtitle, aspect, mirrored }),
            roughness: 0.78,
            metalness: 0.02,
            transparent: true,
            side: THREE.FrontSide,
          }),
      ),
    [title, subtitle, aspect],
  );

  return (
    <group {...props}>
      <mesh material={front} castShadow>
        <planeGeometry args={[width, height]} />
      </mesh>
      {/* Nudged back by a hair: two coplanar faces z-fight. */}
      <mesh material={back} rotation={[0, Math.PI, 0]} position={[0, 0, -0.002]}>
        <planeGeometry args={[width, height]} />
      </mesh>
    </group>
  );
}

/**
 * A hanging board over a doorway, naming what opens there.
 *
 * Both the XZ and the height come in already measured, from `lib/landmarks.ts`.
 * This used to find its own height with a downward ray on its first frame,
 * which is how the boards ended up in the sky: on frame one the map has not
 * been transformed yet, and even once it has, the first thing under a ray at a
 * doorway is the roof over that doorway. See the header of `lib/landmarks.ts`
 * for the measurements and the three distinct ways that went wrong.
 */
export function WorldSign({
  at,
  y,
  title,
  subtitle,
  width = 1.1,
  height = 0.28,
}: {
  /** World XZ. */
  at: [number, number];
  /** World Y of the board's centre. */
  y: number;
  title: string;
  subtitle?: string;
  width?: number;
  height?: number;
}) {
  return (
    <Billboard
      name="world-sign"
      position={[at[0], y, at[1]]}
      userData={{ camIgnore: true }}
    >
      <Plaque title={title} subtitle={subtitle} width={width} height={height} />
    </Billboard>
  );
}
