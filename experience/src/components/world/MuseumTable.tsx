"use client";

import { Html, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { playerPosition } from "@/components/world/characterController";
import { ASSETS } from "@/lib/assets";
import { groundBelow, ROOM_CENTRE } from "@/lib/museum";
import { sfxUi } from "@/lib/sfx";

/**
 * The table in the middle of the gallery, with the tome resting on it.
 *
 * `arabic_table.glb` needs NO rotation. Its `Sketchfab_model` node already
 * carries the Z-up -> Y-up matrix, so after node transforms it measures
 * X 1.126, Y 1.001, Z 1.126 — X and Z equal (a round top), Y the height — with
 * its base already sitting exactly on y = 0.
 *
 * An earlier version read the RAW accessor min/max, which ignores those node
 * transforms, concluded "Z-up", and applied -90deg X. That tipped an already
 * upright table onto its side. Measure after transforms, never before.
 */

/** How tall the table stands in world units (a ~0.9m table by a ~1.13 character). */
const TABLE_HEIGHT = 0.58;

/**
 * Distance at which the tome offers itself, with hysteresis so standing right
 * on the boundary cannot flicker the prompt on and off.
 */
const HINT_IN = 2.6;
const HINT_OUT = 3.1;

export function MuseumTable({ onOpenBook }: { onOpenBook: () => void }) {
  const scene = useThree((s) => s.scene);
  const { scene: raw } = useGLTF(ASSETS.TABLE);
  const [floorY, setFloorY] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [near, setNear] = useState(false);
  const ray = useRef(new THREE.Raycaster());
  const tries = useRef(0);

  // Clone so this instance owns its materials, and measure it upright.
  const { model, scale, height, radius } = useMemo(() => {
    const model = raw.clone(true);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = size.y > 0 ? TABLE_HEIGHT / size.y : 1;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // Re-seat so the base sits exactly on y=0 of the group.
    model.position.y = -box.min.y * scale;
    return {
      model,
      scale,
      height: size.y * scale,
      // Round top, so the footprint is a circle on the wider horizontal axis.
      radius: (Math.max(size.x, size.z) * scale) / 2,
    };
  }, [raw]);

  // Sit it on the actual ground rather than a typed height. Throttled: this
  // raycasts the world trimesh, which is far too heavy to run every frame.
  useFrame(() => {
    if (floorY !== null || tries.current > 300) return;
    tries.current += 1;
    if (tries.current % 15 !== 0) return;
    const y = groundBelow(scene, ROOM_CENTRE[0], ROOM_CENTRE[1], ray.current);
    if (y !== null) setFloorY(y);
    else if (tries.current > 290) setFloorY(-3.0);
  });

  // Show the prompt only when someone walks up to the table. State flips at
  // most twice per approach, so this costs nothing per frame.
  useFrame(() => {
    const dx = playerPosition.x - ROOM_CENTRE[0];
    const dz = playerPosition.z - ROOM_CENTRE[1];
    const d = Math.hypot(dx, dz);
    if (!near && d < HINT_IN) setNear(true);
    else if (near && d > HINT_OUT) setNear(false);
  });

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  if (floorY === null) return null;

  return (
    <group position={[ROOM_CENTRE[0], floorY, ROOM_CENTRE[1]]}>
      {/* An explicit cylinder, not `colliders="cuboid"`. Automatic generation
          reads the child meshes at mount and did not produce anything solid
          for a scaled <primitive> — you could walk straight through the table.
          The table is a round top on a pedestal, so one cylinder sized from
          the same Box3 that scales it is both exact and cheap. */}
      <RigidBody type="fixed" colliders={false} userData={{ camIgnore: true }}>
        <CylinderCollider args={[height / 2, radius]} position={[0, height / 2, 0]} />
        <primitive object={model} scale={scale} />
      </RigidBody>

      {/* A quiet invitation, not a quest marker: it fades in only when you are
          within a couple of metres, and holds still once it is there. */}
      <Html
        position={[0, height + 0.42, 0]}
        center
        distanceFactor={4}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div className={`tome-hint ${near ? "is-near" : ""}`}>
          <span className="tome-hint-mark" aria-hidden>
            ✦
          </span>
          Read the tome
        </div>
      </Html>

      <ClosedBook
        y={height + 0.005}
        hovered={hovered}
        onOver={() => setHovered(true)}
        onOut={() => setHovered(false)}
        onClick={() => {
          void sfxUi();
          onOpenBook();
        }}
      />
    </group>
  );
}

/**
 * The tome itself is a `react-pageflip` modal, not a mesh — Incridea's book was
 * always a DOM flip-book. This is just the thing you click: a closed book on the
 * table wearing the same cover art, so the interaction is obvious from across
 * the room.
 */
function ClosedBook({
  y,
  hovered,
  onOver,
  onOut,
  onClick,
}: {
  y: number;
  hovered: boolean;
  onOver: () => void;
  onOut: () => void;
  onClick: () => void;
}) {
  const cover = useMemo(() => {
    const t = new THREE.TextureLoader().load(ASSETS.BOOK_COVER);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  const mats = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({
      color: "#e8dcc0",
      roughness: 0.95,
    });
    const face = new THREE.MeshStandardMaterial({
      map: cover,
      roughness: 0.7,
    });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z. Cover art on top.
    return [edge, edge, face, edge, edge, edge];
  }, [cover]);

  useEffect(() => {
    for (const m of mats) {
      m.emissive.set("#ffb567");
      m.emissiveIntensity = hovered ? 0.28 : 0;
    }
  }, [mats, hovered]);

  return (
    <group position={[0, y, 0]} rotation={[0, -0.35, 0]}>
      <mesh
        material={mats}
        castShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          onOver();
        }}
        onPointerOut={onOut}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <boxGeometry args={[0.26, 0.05, 0.19]} />
      </mesh>
    </group>
  );
}

useGLTF.preload(ASSETS.TABLE);
