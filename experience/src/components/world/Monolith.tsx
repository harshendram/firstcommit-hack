"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { ASSETS } from "@/lib/assets";
import { groundBelow, LORE_STONES, type LoreStone } from "@/lib/museum";
import { sfxUi } from "@/lib/sfx";

/**
 * The standing stones around the gallery. Each one is a question a visitor
 * would otherwise have to ask out loud, and clicking it answers.
 *
 * Reuses `stone.glb` — the crystal already in the repo and already used by the
 * collectible POIs — so no new asset, and the art style matches by default.
 *
 * Click, not proximity: proximity would mean new `HotspotId` values, which
 * decision D3 freezes at portal | docs | team, and would fire modals at anyone
 * simply crossing the room.
 *
 * This deliberately does NOT touch the `stoneVisibility` localStorage key.
 * Drift D1 already records two systems fighting over it; three would be worse.
 */

/**
 * How tall a stone stands, in world units, against a ~1.13-unit character.
 *
 * Kept below the wall boards deliberately: the gallery floor is roughly -3.2
 * and the boards start at -2.739, so anything much over 0.7 starts reading as
 * overlapping the wall behind it.
 */
const STONE_HEIGHT = 0.7;

/** The crystal mesh is rotated x=PI/2, so its raw Z is what ends up vertical. */
const CRYSTAL_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0];

/** Radial glow sprite, drawn once and shared by all five. */
function useGlowTexture() {
  return useMemo(() => {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(150, 231, 255, 0.85)");
    g.addColorStop(0.45, "rgba(90, 190, 240, 0.25)");
    g.addColorStop(1, "rgba(90, 190, 240, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

function Monolith({
  stone,
  floorY,
  onOpen,
}: {
  stone: LoreStone;
  floorY: number;
  onOpen: (s: LoreStone) => void;
}) {
  const { nodes, materials } = useGLTF(ASSETS.STONE, ASSETS.DRACO) as unknown as {
    nodes: { Crystal_low002: THREE.Mesh };
    materials: { Crystal: THREE.Material };
  };
  const glowTex = useGlowTexture();
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Own the material so five stones can pulse independently of the POI crystals.
  const mat = useMemo(() => {
    const m = (materials.Crystal as THREE.MeshStandardMaterial).clone();
    m.emissive = new THREE.Color("#6fd6ff");
    m.emissiveIntensity = 1.2;
    m.transparent = true;
    m.opacity = 0.96;
    return m;
  }, [materials]);

  /**
   * Scale measured through the mesh's own rotation, not off the raw geometry.
   *
   * Reading the raw bounding box's Y gave 4.02 when the crystal's raw Z (10.56)
   * is what the x=PI/2 rotation stands upright — so the stones came out 2.36
   * units tall, twice the character's height, towering over the wall boards.
   * Boxing a temporary rotated mesh cannot make that mistake.
   */
  const { scale, radius } = useMemo(() => {
    const probe = new THREE.Mesh(nodes.Crystal_low002.geometry);
    probe.rotation.set(...CRYSTAL_ROTATION);
    probe.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(probe).getSize(new THREE.Vector3());
    const k = size.y > 0 ? STONE_HEIGHT / size.y : 1;
    return { scale: k, radius: (Math.max(size.x, size.z) * k) / 2 };
  }, [nodes]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = performance.now() / 1000;
    // A slow bob, offset per stone so the five are not in lockstep.
    const phase = t + stone.angle;
    g.position.y = floorY + STONE_HEIGHT * 0.5 + Math.sin(phase * 0.8) * 0.04;
    g.rotation.y = phase * 0.15;
    mat.emissiveIntensity = (hovered ? 2.2 : 1.2) + Math.sin(phase * 1.6) * 0.3;
  });

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <>
      {/* Solid, and deliberately separate from the visual group: the crystal
          bobs every frame, and a fixed body cannot follow it. This sits still
          at the stone's base and spans the whole bob range. */}
      <RigidBody
        type="fixed"
        colliders={false}
        position={[stone.at[0], floorY + STONE_HEIGHT * 0.5, stone.at[1]]}
        userData={{ camIgnore: true }}
      >
        <CylinderCollider args={[STONE_HEIGHT * 0.5 + 0.06, radius]} />
      </RigidBody>

      <group
        ref={group}
        position={[stone.at[0], floorY + STONE_HEIGHT * 0.5, stone.at[1]]}
        userData={{ camIgnore: true }}
      >
      {/* Glow is a sprite, not a light: five more point lights would mean five
          more shader permutations in a scene running one directional + ambient.

          `raycast` is a no-op and that is load-bearing. THREE.Sprite.raycast()
          requires `raycaster.camera` to be set, and the character controller's
          camera-occlusion raycaster is a bare `new Raycaster()` with no camera.
          Leaving this raycastable made that useFrame throw every single frame
          ("Raycaster.camera needs to be set", then a null matrixWorld), which
          froze the camera onto the character and looked like the whole world
          had broken. `userData.camIgnore` cannot save it: Sprite.raycast runs
          during intersection, before any filter. It also keeps the glow from
          swallowing clicks meant for the crystal behind it. */}
      <sprite
        raycast={() => null}
        scale={[STONE_HEIGHT * 2.6, STONE_HEIGHT * 2.6, 1]}
      >
        <spriteMaterial
          map={glowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={hovered ? 0.95 : 0.7}
        />
      </sprite>

      <mesh
        geometry={nodes.Crystal_low002.geometry}
        material={mat}
        rotation={CRYSTAL_ROTATION}
        scale={scale}
        castShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          void sfxUi();
          onOpen(stone);
        }}
      />
      </group>
    </>
  );
}

export function Monoliths({ onOpen }: { onOpen: (s: LoreStone) => void }) {
  const scene = useThree((s) => s.scene);
  const [floorY, setFloorY] = useState<number | null>(null);
  const ray = useRef(new THREE.Raycaster());
  const tries = useRef(0);

  // One throttled raycast for the whole group: the gallery floor is flat, so
  // five casts would be five times the waste on an already heavy trimesh.
  useFrame(() => {
    if (floorY !== null || tries.current > 300) return;
    tries.current += 1;
    if (tries.current % 15 !== 0) return;
    const probe = LORE_STONES[0]!.at;
    const y = groundBelow(scene, probe[0], probe[1], ray.current);
    if (y !== null) setFloorY(y);
    else if (tries.current > 290) setFloorY(-3.0);
  });

  if (floorY === null) return null;

  return (
    <>
      {LORE_STONES.map((s) => (
        <Monolith key={s.id} stone={s} floorY={floorY} onOpen={onOpen} />
      ))}
    </>
  );
}

useGLTF.preload(ASSETS.STONE, ASSETS.DRACO);
