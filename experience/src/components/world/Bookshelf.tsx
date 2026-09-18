"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { ASSETS } from "@/lib/assets";
import { BOOKSHELF_SPOT, groundBelow } from "@/lib/museum";

/**
 * The bookshelf in the corner left of the entrance.
 *
 * Measured from the GLB after its node transforms:
 *   size   X 1.006  Y 2.022  Z 0.409
 *   min    -0.985, 0.007, -0.389      centre  -0.482, 1.018, -0.184
 *
 * Three consequences, all handled below rather than assumed:
 * - Y is the tallest axis and the base already sits on y = 0, so the model is
 *   **already upright and must not be rotated**. Its `Sketchfab_model` node
 *   carries the Z-up -> Y-up matrix, exactly like the table — which an earlier
 *   version tipped onto its side by trusting raw accessor bounds.
 * - The origin is not centred, so the model is shifted by -centre on X and Z
 *   and `BOOKSHELF_SPOT.at` means the middle of the shelf.
 * - Z is the thin axis, so the front/back face +/-Z; the cabinet doors resolve
 *   to z ~ -0.355, which makes -Z the front. No Y rotation needed against the
 *   z = -9.588 wall.
 *
 * This adds furniture only. It does not touch the museum: `Map.tsx` owns all
 * gallery geometry and materials and is not modified.
 */
export function Bookshelf() {
  const scene = useThree((s) => s.scene);
  const { scene: raw } = useGLTF(ASSETS.BOOKSHELF);
  const [floorY, setFloorY] = useState<number | null>(null);
  const ray = useRef(new THREE.Raycaster());
  const tries = useRef(0);

  const { model, scale, half } = useMemo(() => {
    const model = raw.clone(true);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const scale = size.y > 0 ? BOOKSHELF_SPOT.height / size.y : 1;

    // Centre the footprint and seat the base on y = 0. These are parent-space
    // offsets, so the model-space values are multiplied by the scale.
    model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    return {
      model,
      scale,
      // Collider half-extents from the same box that produced the scale.
      half: [
        (size.x * scale) / 2,
        (size.y * scale) / 2,
        (size.z * scale) / 2,
      ] as [number, number, number],
    };
  }, [raw]);

  // Throttled: this casts against the world trimesh, far too heavy per frame.
  // `groundBelow` keeps only hits under the board line, so it finds the floor
  // and not the museum roof.
  useFrame(() => {
    if (floorY !== null || tries.current > 300) return;
    tries.current += 1;
    if (tries.current % 15 !== 0) return;
    const y = groundBelow(scene, BOOKSHELF_SPOT.at[0], BOOKSHELF_SPOT.at[1], ray.current);
    if (y !== null) setFloorY(y);
    else if (tries.current > 290) setFloorY(-3.0);
  });

  if (floorY === null) return null;

  return (
    <group
      position={[BOOKSHELF_SPOT.at[0], floorY, BOOKSHELF_SPOT.at[1]]}
      rotation={[0, BOOKSHELF_SPOT.rotationY, 0]}
    >
      {/* Explicit cuboid, like the table: `colliders="cuboid"` silently
          produced nothing walkable for a scaled <primitive>. */}
      <RigidBody type="fixed" colliders={false} userData={{ camIgnore: true }}>
        <CuboidCollider args={half} position={[0, half[1], 0]} />
        <primitive object={model} scale={scale} />
      </RigidBody>
    </group>
  );
}

useGLTF.preload(ASSETS.BOOKSHELF);
