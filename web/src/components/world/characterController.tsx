"use client";

import { useKeyboardControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody } from "@react-three/rapier";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { MathUtils, Raycaster, Vector3 } from "three";
import { degToRad } from "three/src/math/MathUtils.js";

import { Character, FALL_CLIP } from "@/components/world/Character";
import stonesData from "@/components/world/data/data.json";
import { sfxFootstep, sfxJump, sfxLand } from "@/lib/sfx";
import { SpeechBubble } from "@/components/world/SpeechBubble";
import { fallHold, subscribeFall, TIMING, type BubbleKey } from "@/lib/wardstone";

/**
 * Third-person camera occlusion (cast from roughly eye height toward the
 * desired camera seat). Kept as a single object so HMR/webpack cannot drop a
 * lone module-level binding and leave `CAMERA_RAY_HEIGHT is not defined`.
 */
const CAMERA_OCCLUSION = {
  /** Roughly the character's eye line — where the occlusion ray starts. */
  rayHeight: 0.3,
  /** Keep the camera this far off whatever it hit, so the wall never clips in. */
  wallPadding: 0.15,
  /** Never let the camera collapse all the way onto the character. */
  minDistance: 0.35,
} as const;

/**
 * Going down is done in code, not by the clip. `dive_fall_guys` turns out to be
 * a single-frame pose whose hips are byte-identical to the rest pose — it moves
 * the limbs (arms forward, superman dive) and never touches the root, so on its
 * own she just stands there with her arms out.
 *
 * She faces +Z (see how velocity is derived from the facing angle below), and
 * rotating about -X carries +Z down to -Y — a face-down landing, which is what
 * the arms-forward pose wants.
 */
const FALL_PITCH = -Math.PI * 0.5;

/**
 * The rig pivots about the rigid-body centre, which sits ~0.2 above her feet,
 * so lying flat leaves her floating by exactly that much. Lower this if a limb
 * clips the floor; raise it if she hovers.
 */
const FALL_SINK = 0.2;

const normalizeAngle = (angle: number) => {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
};

const lerpAngle = (start: number, end: number, t: number) => {
  start = normalizeAngle(start);
  end = normalizeAngle(end);
  if (Math.abs(end - start) > Math.PI) {
    if (end > start) {
      start += 2 * Math.PI;
    } else {
      end += 2 * Math.PI;
    }
  }
  return normalizeAngle(start + (end - start) * t);
};

/**
 * The camera-occlusion ray must ignore the player (and the floating POI stones),
 * otherwise the very first hit is always the character's own skinned mesh and the
 * camera thinks it is permanently blocked.
 */
const isCameraTransparent = (object: THREE.Object3D | null) => {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node.userData?.camIgnore) return true;
    node = node.parent;
  }
  return false;
};

export type Stone = {
  id: number;
  pos: [number, number, number];
};

export const stones: Stone[] = stonesData.stones.map((stone) => ({
  ...stone,
  pos: [stone.pos[0] ?? 0, stone.pos[1] ?? 0, stone.pos[2] ?? 0] as [
    number,
    number,
    number,
  ],
}));

export const playerPosition = new Vector3();

/**
 * Which way the camera is looking, as a yaw in radians: atan2(dir.x, dir.z).
 *
 * Module state for the same reason `playerPosition` is: the compass lives in
 * the DOM HUD, outside the R3F tree, and needs this every frame without a
 * React render between the two.
 */
export const cameraYaw = { value: 0 };

/** Scratch for the yaw read, so the frame loop allocates nothing. */
const camDir = new Vector3();

export const CharacterController = ({
  onMove,
  onLanded,
  say = null,
}: {
  onMove?: (pos: Vector3) => void;
  /** Fires once, when the spawn drop touches down. */
  onLanded?: () => void;
  /** What Suraksha is saying right now, shown in a balloon above her. */
  say?: BubbleKey | null;
} = {}) => {
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== "undefined"
      ? window.innerWidth > window.innerHeight
      : true,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const RUN_SPEED = isLandscape ? 1.8 : 2.6;
  const WALK_SPEED = isLandscape ? 0.5 : 0.8;
  const ROTATION_SPEED = degToRad(isLandscape ? 3 : 5);

  const [, get] = useKeyboardControls();
  const rb = useRef<ComponentRef<typeof RigidBody>>(null);
  const container = useRef<THREE.Group>(null);
  const character = useRef<THREE.Group | null>(null);
  const characterRotationTarget = useRef(0);
  const rotationTarget = useRef(0);
  const cameraTarget = useRef<THREE.Group | null>(null);
  const cameraPosition = useRef<THREE.Group | null>(null);
  const cameraWorldPosition = useRef(new Vector3());
  const cameraLookAtWorldPosition = useRef(new Vector3());
  const cameraLookAt = useRef(new Vector3());
  const raycaster = useRef(new Raycaster());
  const cameraDirection = useRef(new Vector3());
  const camRayOrigin = useRef(new Vector3());
  const camDesiredPos = useRef(new Vector3());
  const [animation, setAnimation] = useState("idle");
  const [spacebarPressed, setSpacebarPressed] = useState(false);
  const [spacebarDisabled, setSpacebarDisabled] = useState(false);
  const [visibility, setVisibility] = useState<boolean[]>([]);
  const wasJumping = useRef(false);
  const prevAnim = useRef("idle");
  /** performance.now() until which she is on the ground and input is ignored. */
  const downedUntil = useRef(0);
  const spawnFell = useRef(false);
  const hasLanded = useRef(false);

  // The Stumble pill lives in the DOM; the character lives in the R3F tree.
  useEffect(() => {
    return subscribeFall(() => {
      downedUntil.current = performance.now() + TIMING.fallLockMs;
      setAnimation(FALL_CLIP);
      sfxLand();
      const body = rb.current;
      if (!body) return;
      // Trip her forward along the way she is facing, not sideways into a wall.
      const heading = rotationTarget.current + characterRotationTarget.current;
      body.setLinvel(
        { x: Math.sin(heading) * 1.1, y: 0.35, z: Math.cos(heading) * 1.1 },
        true,
      );
    });
  }, []);

  const handleJump = () => {
    const keyDownEvent = new KeyboardEvent("keydown", {
      key: "Space",
      code: "Space",
      bubbles: true,
    });
    document.dispatchEvent(keyDownEvent);

    setTimeout(() => {
      const keyUpEvent = new KeyboardEvent("keyup", {
        key: "Space",
        code: "Space",
        bubbles: true,
      });
      document.dispatchEvent(keyUpEvent);
    }, 100);
  };

  useEffect(() => {
    const onMouseDown = (event: MouseEvent | TouchEvent) => {
      const target = (event.target as HTMLElement).closest("[id]");
      if (!target) return;

      if (target.id === "jump" || target.id === "shift") return;

      if (target.id === "w") get().forward = true;
      if (target.id === "s") get().backward = true;
      if (target.id === "a") get().left = true;
      if (target.id === "d") get().right = true;
    };

    const onMouseUp = (event: MouseEvent | TouchEvent) => {
      const target = (event.target as HTMLElement).closest("[id]");
      if (!target) return;

      if (target.id === "jump") {
        handleJump();
        return;
      }
      if (target.id === "shift") return;

      if (target.id === "w") get().forward = false;
      if (target.id === "s") get().backward = false;
      if (target.id === "a") get().left = false;
      if (target.id === "d") get().right = false;
    };

    const onRunClick = (event: MouseEvent | TouchEvent) => {
      const target = (event.target as HTMLElement).closest("[id]");
      if (!target) return;
      if (target.id === "shift") {
        get().run = !get().run;
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchstart", onMouseDown);
    document.addEventListener("touchend", onMouseUp);
    document.addEventListener("click", onRunClick);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchstart", onMouseDown);
      document.removeEventListener("touchend", onMouseUp);
      document.removeEventListener("click", onRunClick);
    };
  }, [get]);

  // Local-only stone visibility via localStorage — no network.
  useEffect(() => {
    const updateVisibility = () => {
      const storedVisibility = localStorage.getItem("stoneVisibility");
      if (storedVisibility) {
        const parsedVisibility = JSON.parse(storedVisibility) as boolean[];
        setVisibility(parsedVisibility);
      } else {
        const initialVisibility = stones.map(() => true);
        setVisibility(initialVisibility);
        localStorage.setItem(
          "stoneVisibility",
          JSON.stringify(initialVisibility),
        );
      }
    };

    updateVisibility();
    const interval = setInterval(updateVisibility, 2000);
    return () => clearInterval(interval);
  }, []);

  const stoneModels = useMemo(() => {
    return stones.map((stone, index) => {
      if (!visibility[index]) return null;
      return <mesh key={stone.id} position={stone.pos}></mesh>;
    });
  }, [visibility]);

  useFrame(({ camera, scene }) => {
    if (rb.current) {
      const vel = rb.current.linvel() as { x: number; y: number; z: number };
      const pos = rb.current.translation() as {
        x: number;
        y: number;
        z: number;
      };

      playerPosition.set(pos.x, pos.y, pos.z);
      onMove?.(playerPosition);
      if (pos.y < -9) {
        playerPosition.set(0, 0, 0);
        rb.current.setTranslation({ x: 0, y: 0, z: 0 }, true);
      }

      // First touchdown after the spawn drop — the beat the story opens on.
      if (!hasLanded.current) {
        if (vel.y < -1) spawnFell.current = true;
        else if (spawnFell.current && vel.y > -0.2) {
          hasLanded.current = true;
          onLanded?.();
        }
      }

      // She is on the ground after a stumble: no input, no animation changes,
      // just friction. Everything below the physics block still runs, so the
      // camera keeps tracking her while she is down. `fallHold` keeps her there
      // for as long as the wardstone panel is open.
      const downed = performance.now() < downedUntil.current || fallHold.active;

      const movement = { x: 0, z: 0 };

      if (!downed) {
        if (get().forward) movement.z = 1;
        if (get().backward) movement.z = -1;
      }
      const speed = get().run ? RUN_SPEED : WALK_SPEED;

      if (!downed) {
        if (get().left) movement.x = 1;
        if (get().right) movement.x = -1;
      }

      if (movement.x !== 0) {
        rotationTarget.current += ROTATION_SPEED * movement.x;
      }

      if (downed) {
        vel.x *= 0.82;
        vel.z *= 0.82;
        setAnimation(FALL_CLIP);
      } else if (movement.x !== 0 || movement.z !== 0) {
        characterRotationTarget.current = Math.atan2(movement.x, movement.z);
        vel.x =
          Math.sin(rotationTarget.current + characterRotationTarget.current) *
          speed;
        vel.z =
          Math.cos(rotationTarget.current + characterRotationTarget.current) *
          speed;
        const nextAnim = speed === RUN_SPEED ? "run" : "walk";
        setAnimation(nextAnim);
        if (!spacebarPressed) sfxFootstep(nextAnim === "run");
      } else {
        setAnimation("idle");
      }

      if (character.current) {
        // YXZ so yaw and pitch compose the way a body does. With the default
        // XYZ order, pitching a rig that already has a facing yaw skews it.
        character.current.rotation.order = "YXZ";
        character.current.rotation.y = lerpAngle(
          character.current.rotation.y,
          characterRotationTarget.current,
          0.1,
        );
        character.current.rotation.x = MathUtils.lerp(
          character.current.rotation.x,
          downed ? FALL_PITCH : 0,
          downed ? 0.22 : 0.14,
        );
        character.current.position.y = MathUtils.lerp(
          character.current.position.y,
          downed ? -FALL_SINK : 0,
          0.18,
        );
      }

      if (!downed && get().jump && !spacebarDisabled) {
        setSpacebarPressed(true);
        sfxJump();
        setTimeout(() => {
          setSpacebarPressed(false);
          setSpacebarDisabled(true);
          setTimeout(() => {
            setSpacebarDisabled(false);
          }, 500);
        }, 1000);
      }

      if (spacebarPressed && !downed) {
        wasJumping.current = true;
        vel.y = 1;
        if (get().forward) {
          vel.x +=
            Math.sin(rotationTarget.current + characterRotationTarget.current) *
            0.1;
          vel.z +=
            Math.cos(rotationTarget.current + characterRotationTarget.current) *
            0.1;
        }
        setAnimation("jump");
      } else if (wasJumping.current) {
        wasJumping.current = false;
        sfxLand();
      }

      prevAnim.current = animation;

      rb.current.setLinvel(vel, true);

      stones.forEach((stone, index) => {
        const distance = Math.sqrt(
          (pos.x - stone.pos[0]) ** 2 +
            (pos.y - stone.pos[1]) ** 2 +
            (pos.z - stone.pos[2]) ** 2,
        );
        if (distance <= 0.5 && visibility[index]) {
          const newVisibility = [...visibility];
          newVisibility[index] = false;
          setVisibility(newVisibility);
          localStorage.setItem(
            "stoneVisibility",
            JSON.stringify(newVisibility),
          );
        }
      });
    }

    if (cameraPosition.current && cameraTarget.current) {
      cameraPosition.current.getWorldPosition(cameraWorldPosition.current);
      cameraTarget.current.getWorldPosition(cameraLookAtWorldPosition.current);

      // Cast from the player's head out to where the camera wants to sit — not
      // from the look-at point, which sits in front of the character and makes
      // every ray pass through their own body.
      camRayOrigin.current.set(
        playerPosition.x,
        playerPosition.y + CAMERA_OCCLUSION.rayHeight,
        playerPosition.z,
      );
      cameraDirection.current.subVectors(
        cameraWorldPosition.current,
        camRayOrigin.current,
      );
      const desiredDistance = cameraDirection.current.length();
      cameraDirection.current.normalize();

      raycaster.current.set(camRayOrigin.current, cameraDirection.current);
      raycaster.current.far = desiredDistance;
      // THREE.Sprite.raycast() reads raycaster.camera and throws without it.
      // Any sprite added anywhere in the scene would otherwise kill this whole
      // useFrame every frame and freeze the camera on the character.
      raycaster.current.camera = camera;

      const blocker = raycaster.current
        .intersectObjects(scene.children, true)
        .find((hit) => hit.object.visible && !isCameraTransparent(hit.object));

      if (blocker && blocker.distance < desiredDistance) {
        camDesiredPos.current
          .copy(camRayOrigin.current)
          .addScaledVector(
            cameraDirection.current,
            Math.max(
              blocker.distance - CAMERA_OCCLUSION.wallPadding,
              CAMERA_OCCLUSION.minDistance,
            ),
          );
        // Pull in fast so a wall never clips through frame, ease back out slowly.
        camera.position.lerp(camDesiredPos.current, 0.4);
      } else {
        camera.position.lerp(cameraWorldPosition.current, 0.1);
      }

      cameraLookAt.current.lerp(cameraLookAtWorldPosition.current, 1);
      camera.lookAt(cameraLookAt.current);

      // Read after lookAt so the compass never lags the view by a frame.
      camera.getWorldDirection(camDir);
      cameraYaw.value = Math.atan2(camDir.x, camDir.z);
    }

    if (container.current) {
      container.current.rotation.y = MathUtils.lerp(
        container.current.rotation.y,
        rotationTarget.current,
        0.1,
      );
    }
  });

  return (
    <RigidBody
      colliders={false}
      lockRotations
      ref={rb}
      position={[0.4, 8, -3]}
    >
      <group ref={container} userData={{ camIgnore: true }}>
        <group ref={cameraTarget} position-z={1} />
        <group ref={cameraPosition} position-y={0.5} position-z={-1.5} />
        <group ref={character}>
          <Character scale={0.18} position-y={-0.25} animation={animation} />
        </group>
        {/* Outside the `character` group so the balloon does not tip over
            with her when she goes down. */}
        <SpeechBubble line={say} />
        {stoneModels}
      </group>
      <CapsuleCollider args={[0.08, 0.16]} />
    </RigidBody>
  );
};
