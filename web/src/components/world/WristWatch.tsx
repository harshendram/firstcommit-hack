"use client";

import { createPortal, useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";

import { wrist } from "@/lib/wardstone";

/**
 * The wardstone — a band on the character's left forearm, so the watch the
 * story talks about is actually on her wrist.
 *
 * Mounted onto the skeleton with a portal rather than positioned by hand: the
 * bone is at Mixamo's scale inside an armature scaled by 0.035 inside a
 * character scaled by 0.18, and guessing that chain is how you end up with a
 * watch the size of a house. Instead we read the bone's world scale and its
 * child bone's offset at mount, and derive both size and placement from them.
 */

/** Roughly 3.5 cm across on a character about 1.1 world units tall. */
const TARGET_WORLD_SIZE = 0.035;

/** How far along the forearm the wrist sits (0 = elbow, 1 = hand). */
const WRIST_ALONG_BONE = 0.82;

const MOOD_COLOR = {
  calm: new THREE.Color("#2fd4c6"),
  alert: new THREE.Color("#ff6a3d"),
  resolved: new THREE.Color("#4ade80"),
} as const;

export function WristWatch({ bone }: { bone: THREE.Object3D }) {
  const group = useRef<THREE.Group>(null);
  const face = useRef<THREE.MeshStandardMaterial>(null);
  const glow = useRef<THREE.PointLight>(null);

  // Size and seat the band from the skeleton itself, once it exists.
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;

    bone.updateWorldMatrix(true, false);
    const worldScale = new THREE.Vector3();
    bone.getWorldScale(worldScale);
    const unit = worldScale.x || 1;
    g.scale.setScalar(TARGET_WORLD_SIZE / unit);

    // Mixamo bones point at their child. Ride that axis down to the wrist
    // instead of assuming +Y and a bone length.
    const child = bone.children.find((c) => (c as THREE.Bone).isBone);
    if (child) {
      g.position.copy(child.position).multiplyScalar(WRIST_ALONG_BONE);
    }
  }, [bone]);

  useFrame((_, delta) => {
    const mat = face.current;
    if (!mat) return;
    const target = MOOD_COLOR[wrist.mood] ?? MOOD_COLOR.calm;
    mat.emissive.lerp(target, Math.min(1, delta * 8));

    const t = performance.now() / 1000;
    const alert = wrist.mood === "alert";
    // Calm reads as a steady glint; alert is a heartbeat you can catch at distance.
    const pulse = alert
      ? 2.6 + Math.sin(t * 9) * 2.2
      : 0.85 + Math.sin(t * 1.6) * 0.15;
    mat.emissiveIntensity = pulse;

    if (glow.current) {
      glow.current.color.copy(mat.emissive);
      // Mounted always, intensity animated — remounting a light recompiles shaders.
      glow.current.intensity = alert ? 0.5 + Math.sin(t * 9) * 0.35 : 0.06;
    }
  });

  return createPortal(
    <group ref={group} userData={{ camIgnore: true }}>
      {/* strap */}
      <mesh castShadow={false} receiveShadow={false}>
        <cylinderGeometry args={[0.52, 0.52, 0.34, 16, 1, true]} />
        <meshStandardMaterial color="#1c1c20" roughness={0.75} side={THREE.DoubleSide} />
      </mesh>
      {/* case, lying against the outside of the forearm */}
      <group position={[0.54, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh>
          <cylinderGeometry args={[0.38, 0.38, 0.18, 18]} />
          <meshStandardMaterial color="#2a2a30" roughness={0.35} metalness={0.6} />
        </mesh>
        {/* face */}
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.04, 18]} />
          <meshStandardMaterial
            ref={face}
            color="#08110f"
            emissive={MOOD_COLOR.calm}
            emissiveIntensity={0.9}
            roughness={0.25}
          />
        </mesh>
        {/* distance is world units and ignores the group's scale — keep it small */}
        <pointLight ref={glow} position={[0, 0.3, 0]} distance={0.5} intensity={0.06} />
      </group>
    </group>,
    bone,
  );
}
