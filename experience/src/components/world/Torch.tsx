"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { ASSETS } from "@/lib/assets";
import { groundBelow, TORCHES, TORCH_HEIGHT } from "@/lib/museum";

/**
 * Wall sconces at the gallery arch and inside the room.
 *
 * `torch.glb` is already Y-up and upright (1.427 tall, two meshes: `torch` and
 * `flames`), but its base sits at y -0.317, so it is seated from its own Box3
 * rather than by a typed offset — the same discipline the table needed after
 * an earlier version rotated an already-correct model onto its side.
 */

/** How tall a torch stands, against a ~1.13-unit character. */
const TORCH_SIZE = 0.85;

/** Soft additive halo, shared by every flame. */
function useFlameGlow() {
  return useMemo(() => {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255, 196, 110, 0.9)");
    g.addColorStop(0.4, "rgba(255, 138, 40, 0.3)");
    g.addColorStop(1, "rgba(255, 120, 30, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

function Torch({
  spot,
  floorY,
  glowTex,
}: {
  spot: (typeof TORCHES)[number];
  floorY: number;
  glowTex: THREE.Texture;
}) {
  const { scene: raw } = useGLTF(ASSETS.TORCH);
  const flameRef = useRef<THREE.Object3D | null>(null);
  const haloRef = useRef<THREE.SpriteMaterial>(null);

  const { model, scale } = useMemo(() => {
    const model = raw.clone(true);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? TORCH_SIZE / size.y : 1;
    // Base is at -0.317 in model space; lift it so the group's y = 0 is the
    // bottom of the torch.
    model.position.y = -box.min.y * scale;

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat?.name === "flames" || /flame/i.test(mesh.name)) {
        const lit = mat.clone();
        lit.emissive = new THREE.Color("#ff9a3c");
        lit.emissiveIntensity = 2.4;
        lit.toneMapped = false;
        mesh.material = lit;
        flameRef.current = mesh;
      } else {
        mesh.castShadow = true;
      }
    });
    return { model, scale };
  }, [raw]);

  useFrame(() => {
    // Irregular flicker: two out-of-phase sines rather than random, so it
    // reads as fire without strobing.
    const t = performance.now() / 1000;
    const seed = spot.at[0] * 3.1 + spot.at[1];
    const f = 0.82 + Math.sin(t * 9 + seed) * 0.1 + Math.sin(t * 14.7 + seed * 2) * 0.06;
    const flame = flameRef.current as THREE.Mesh | null;
    if (flame) {
      const mat = flame.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.1 * f;
      flame.scale.setScalar(0.94 + f * 0.1);
    }
    if (haloRef.current) haloRef.current.opacity = 0.34 * f;
  });

  return (
    <group
      position={[spot.at[0], floorY + TORCH_HEIGHT, spot.at[1]]}
      rotation={[0, spot.rotationY, 0]}
      userData={{ camIgnore: true }}
    >
      <primitive object={model} scale={scale} />
      {/* raycast no-op: THREE.Sprite.raycast needs raycaster.camera, and an
          unguarded sprite once threw in the character controller's occlusion
          ray every frame. Decorative anyway. */}
      <sprite raycast={() => null} position={[0, TORCH_SIZE * 0.72, 0]} scale={[1.5, 1.5, 1]}>
        <spriteMaterial
          ref={haloRef}
          map={glowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.34}
        />
      </sprite>
    </group>
  );
}

export function Torches() {
  const scene = useThree((s) => s.scene);
  const glowTex = useFlameGlow();
  const [floorY, setFloorY] = useState<number | null>(null);
  const ray = useRef(new THREE.Raycaster());
  const tries = useRef(0);

  // One throttled cast for the set; the gallery floor is flat.
  useFrame(() => {
    if (floorY !== null || tries.current > 300) return;
    tries.current += 1;
    if (tries.current % 15 !== 0) return;
    const probe = TORCHES[2]!.at; // inside the room, so it lands on the floor
    const y = groundBelow(scene, probe[0], probe[1], ray.current);
    if (y !== null) setFloorY(y);
    else if (tries.current > 290) setFloorY(-3.0);
  });

  if (floorY === null) return null;

  return (
    <>
      {TORCHES.map((spot) => (
        <Torch key={spot.id} spot={spot} floorY={floorY} glowTex={glowTex} />
      ))}
    </>
  );
}

useGLTF.preload(ASSETS.TORCH);
