"use client";

import { KeyboardControls, Sky, useProgress } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { gsap } from "gsap";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import type { Vector3 } from "three";

import * as UIButtons from "@/components/world/UI";
import {
  CharacterController,
  playerPosition,
} from "@/components/world/characterController";
import LoadingScreen from "@/components/world/Loader";
import { Map } from "@/components/world/Map";
import { StoryIntro } from "@/components/world/StoryIntro";
import { WardstoneOverlay } from "@/components/world/WardstoneOverlay";
import { WorldModals } from "@/components/world/WorldModals";
import { ASSETS } from "@/lib/assets";
import { APP_URL } from "@/lib/config";
import { hotspotAt, type HotspotId } from "@/lib/hotspots";
import {
  setSfxMuted,
  sfxModal,
  sfxUi,
  startMusic,
  unlockSfx,
} from "@/lib/sfx";
import { BookModal } from "@/components/world/BookModal";
import { GallerySigns } from "@/components/world/GallerySigns";
import { LoreModal } from "@/components/world/LoreModal";
import type { LoreStone } from "@/lib/museum";
import { QuestHud } from "@/components/world/QuestHud";
import { QuestMarker } from "@/components/world/QuestMarker";
import { HOTSPOT_FOR_STEP, QUEST_DONE, QUEST_STEPS } from "@/lib/quest";
import {
  introHidden,
  requestFall,
  setWristMood,
  type BubbleKey,
} from "@/lib/wardstone";

import { Portal } from "./Portal";
import Poi from "./Stone";

/** Soft sun — follows the player so shadow-map texels don't crawl/flicker. */
function SunLight() {
  const light = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const px = playerPosition.x;
    const py = playerPosition.y;
    const pz = playerPosition.z;
    l.position.set(px - 8, py + 22, pz - 14);
    l.target.position.set(px, py, pz);
    l.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={light}
      intensity={2.6}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0002}
      shadow-normalBias={0.035}
      shadow-radius={3}
    >
      <orthographicCamera
        attach="shadow-camera"
        args={[-28, 28, 28, -28, 1, 70]}
      />
    </directionalLight>
  );
}

const maps = {
  medieval_fantasy_book: {
    scale: 0.4,
    position: [-4, -3, -6] as [number, number, number],
  },
};

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "run", keys: ["Shift"] },
  { name: "jump", keys: ["Space"] },
];

export function Medieval() {
  const { progress, active } = useProgress();
  const experienceRef = useRef<HTMLDivElement | null>(null);
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== "undefined"
      ? window.innerWidth > window.innerHeight
      : true,
  );

  const [isRunOn, setIsRunOn] = useState(false);
  const [showLoading, setShowLoading] = useState(true);
  const [hotspot, setHotspot] = useState<HotspotId | null>(null);
  const [dismissed, setDismissed] = useState<HotspotId | null>(null);
  const [muted, setMuted] = useState(false);
  const [debugPos, setDebugPos] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [fallOpen, setFallOpen] = useState(false);
  const [runId, setRunId] = useState(0);
  const [say, setSay] = useState<BubbleKey | null>(null);
  const [stone, setStone] = useState<LoreStone | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  /** Index into QUEST_STEPS; QUEST_DONE once the route is finished. */
  const [questAt, setQuestAt] = useState(0);
  const introShown = useRef(false);
  /** Read inside the per-frame onMove, so it must not be state. */
  const blocked = useRef(false);
  const dwellRef = useRef<{ id: HotspotId | null; since: number }>({
    id: null,
    since: 0,
  });
  const debug = useRef(false);
  const images: string[] = [
    ASSETS.LOADING_BACKGROUND,
    ASSETS.LOADING_FOREGROUND,
  ];

  useEffect(() => {
    debug.current = new URLSearchParams(window.location.search).has("debug");
  }, []);

  useEffect(() => {
    const unlock = () => {
      void unlockSfx();
      // Same gesture that unlocks the SFX starts the theme; startMusic is
      // idempotent and retries if autoplay was refused.
      startMusic(ASSETS.MUSIC);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    setSfxMuted(muted);
  }, [muted]);

  // Space / arrows scroll the page → white strip under the canvas. Lock it.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const blockScrollKeys = (e: KeyboardEvent) => {
      const k = e.code;
      if (
        k === "Space" ||
        k === "ArrowUp" ||
        k === "ArrowDown" ||
        k === "ArrowLeft" ||
        k === "ArrowRight"
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", blockScrollKeys, { passive: false });

    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", blockScrollKeys);
    };
  }, []);

  useEffect(() => {
    if (!active && progress === 100) {
      gsap.to("#loading-screen", {
        opacity: 0,
        duration: 6,
        onComplete: () => setShowLoading(false),
      });

      gsap.fromTo(
        experienceRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 1 },
      );
    }
  }, [progress, active]);

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const onMove = useCallback(
    (pos: Vector3) => {
      if (debug.current) {
        // y as well as xz — sign and heading heights need calibrating too.
        setDebugPos(
          `${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}  ·  y ${pos.y.toFixed(2)}`,
        );
      }

      // One story at a time: never open a door modal over the intro or the
      // wardstone sequence.
      if (blocked.current) return;

      const hit = hotspotAt(pos.x, pos.z);
      const now = performance.now();

      if (!hit) {
        dwellRef.current = { id: null, since: 0 };
        setDismissed(null);
        setHotspot(null);
        return;
      }

      if (hit.id === dismissed) return;

      if (dwellRef.current.id !== hit.id) {
        dwellRef.current = { id: hit.id, since: now };
        return;
      }

      // Brief linger so walking past doesn't pop; short enough for door stands.
      if (now - dwellRef.current.since < 200) return;

      setHotspot((cur) => {
        if (cur === hit.id) return cur;
        sfxModal();
        return hit.id;
      });
    },
    [dismissed],
  );

  /**
   * Completing a step on CLOSE, not on arrival, so it means "you read it"
   * rather than "you walked past". Both the X and the backdrop call this, so
   * a step cannot be left un-completable.
   */
  const completeStep = useCallback((id: (typeof QUEST_STEPS)[number]["id"]) => {
    setQuestAt((at) => (QUEST_STEPS[at]?.id === id ? at + 1 : at));
  }, []);

  const closeModal = useCallback(() => {
    if (hotspot) {
      setDismissed(hotspot);
      const step = QUEST_STEPS[questAt];
      if (step && HOTSPOT_FOR_STEP[step.id] === hotspot) completeStep(step.id);
    }
    setHotspot(null);
  }, [hotspot, questAt, completeStep]);

  // The wardstone sequence already reports its own ending through `say`, so
  // the fall step completes without any new plumbing.
  useEffect(() => {
    if (say === "resolvedOkay" || say === "resolvedHelp") completeStep("fall");
  }, [say, completeStep]);

  /**
   * The spawn drop is the story's first beat: she falls out of the sky, lands,
   * and the wardstone is the only thing that noticed.
   */
  const openIntro = useCallback(() => {
    if (introShown.current) return;
    introShown.current = true;
    if (introHidden()) return;
    setIntro(true);
    sfxModal();
  }, []);

  useEffect(() => {
    blocked.current = intro || fallOpen || stone !== null || bookOpen;
  }, [intro, fallOpen, stone, bookOpen]);

  // Safety net: if the landing is ever missed, the story still gets told.
  useEffect(() => {
    if (showLoading) return;
    const t = setTimeout(openIntro, 2500);
    return () => clearTimeout(t);
  }, [showLoading, openIntro]);

  const stumble = useCallback(() => {
    // The old top-right pill had no guard: pressing it again mid-sequence
    // restarted the fall underneath its own panel. `blocked` is already the
    // ref that means "a story is on screen" (intro, wardstone, stone, tome).
    if (blocked.current) return;
    void unlockSfx();
    setHotspot(null);
    setWristMood("alert");
    setRunId((n) => n + 1);
    requestFall();
    // Let her actually go down before the panel covers the view.
    setTimeout(() => setFallOpen(true), 900);
  }, []);

  /**
   * F trips her, the same as the on-screen control.
   *
   * Deliberately NOT a `keyboardMap` entry: drei's `KeyboardControls` models a
   * key being *held*, which the controller samples every frame. A one-shot
   * action read that way would fire on every frame the key is down.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyF" || e.repeat || e.metaKey || e.ctrlKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return;
      }
      stumble();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stumble]);

  return (
    <div
      ref={experienceRef}
      className="relative h-[100svh] w-full overflow-hidden bg-[#dce6ef]"
      style={{ opacity: 0 }}
      id="loading-screen-root"
    >
      {showLoading && (
        <div id="loading-screen">
          <LoadingScreen images={images} />
        </div>
      )}

      <div className="world-top-actions">
        <button
          type="button"
          className="world-sound-toggle"
          onClick={() => {
            void unlockSfx();
            setMuted((m) => !m);
            sfxUi();
          }}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          title={muted ? "Sound off" : "Sound on"}
        >
          {muted ? (
            <UIButtons.Volume3 className="h-5 w-5" />
          ) : (
            <UIButtons.Volume className="h-5 w-5" />
          )}
        </button>
        <a href={APP_URL} className="world-main-link" onClick={() => sfxUi()}>
          Main website
        </a>
      </div>

      <div className="relative h-[100svh] w-full overflow-hidden">
        <KeyboardControls map={keyboardMap}>
          <Canvas
            shadows={{ type: THREE.PCFSoftShadowMap }}
            camera={{
              position: [0, 0, 0],
              // 0.01 wrecked depth precision against the default far plane, which
              // is why you could see straight through building interiors.
              near: 0.1,
              fov: isLandscape ? 60 : 100,
            }}
            className="absolute inset-0"
            gl={{ antialias: true, powerPreference: "high-performance" }}
            id="canvas"
            style={{ touchAction: "none" }}
          >
            <Suspense fallback={null}>
              <color attach="background" args={["#ffffff"]} />
              <fog attach="fog" args={["white", 3, 40]} />
              <Physics key="medieval_fantasy_book">
                <ambientLight intensity={1.05} />
                <SunLight />
                <Map
                  scale={maps.medieval_fantasy_book.scale}
                  position={maps.medieval_fantasy_book.position}
                />
                <CharacterController
                  onMove={onMove}
                  onLanded={openIntro}
                  say={say}
                />
                {/* Its OWN Suspense, deliberately. The furniture loads
                    arabic_table.glb, which nothing else had loaded — inside the
                    world's single boundary that suspends AFTER the world is up,
                    tearing down <Physics>, respawning the character mid-air and
                    dropping her through a collider that has not rebuilt yet.
                    An inner boundary lets the furniture pop in late on its own. */}
                <Suspense fallback={null}>
                  <QuestMarker
                    at={QUEST_STEPS[questAt]?.at ?? null}
                    ground={QUEST_STEPS[questAt]?.ground ?? null}
                  />
                <GallerySigns
                    onOpenStone={(s) => {
                      setHotspot(null);
                      setStone(s);
                      sfxModal();
                    }}
                    onOpenBook={() => {
                      setHotspot(null);
                      setBookOpen(true);
                      sfxModal();
                    }}
                  />
                </Suspense>
                <Portal />
              </Physics>
              <Poi />
              <Sky />
            </Suspense>
          </Canvas>
        </KeyboardControls>

        {/* absolute — sticky was leaving a white strip when Space scrolled the page */}
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-50 flex w-full justify-between px-8">
          <div className="pointer-events-auto flex flex-col items-center">
            <button id="w" type="button" className="mb-2 scale-[150%]">
              <UIButtons.CircleArrowUpFilled className="h-12 w-12 text-white/70 drop-shadow" />
            </button>
            <div className="flex">
              <button id="a" type="button" className="mr-8 scale-[150%]">
                <UIButtons.CircleArrowLeftFilled className="h-12 w-12 text-white/70 drop-shadow" />
              </button>
              <button id="s" type="button" className="mr-8 mt-16 scale-[150%]">
                <UIButtons.CircleArrowDownFilled className="h-12 w-12 text-white/70 drop-shadow" />
              </button>
              <button id="d" type="button" className="scale-[150%]">
                <UIButtons.CircleArrowRightFilled className="h-12 w-12 text-white/70 drop-shadow" />
              </button>
            </div>
          </div>

          <div className="pointer-events-auto flex flex-col items-center">
            {/* Stumbling is something she does, like running and jumping — so
                it belongs here and not in the top-right navigation cluster.
                Captioned, unlike its neighbours: it is the one control that
                shows what Suraksha does, and nobody should have to hunt for it. */}
            <button
              type="button"
              className={`world-fall-btn mb-8 ${
                QUEST_STEPS[questAt]?.id === "fall" ? "is-objective" : ""
              }`}
              onClick={stumble}
              aria-label="Stumble — trip and let the wardstone react"
            >
              <UIButtons.Stumble className="h-8 w-8" />
              <span className="world-fall-cap">Stumble</span>
            </button>
            <button
              id="shift"
              type="button"
              onClick={() => {
                void unlockSfx();
                sfxUi();
                setIsRunOn((prev) => !prev);
              }}
              className={`mb-12 scale-[100%] rounded-full p-2 transition-colors ${
                isRunOn ? "bg-green-950/80" : "bg-transparent"
              }`}
            >
              <UIButtons.Run className="h-12 w-12 text-white/70 drop-shadow" />
            </button>
            <button
              id="jump"
              type="button"
              className="scale-[150%]"
              onPointerDown={() => {
                void unlockSfx();
              }}
            >
              <UIButtons.CircleChevronsUpFilled className="h-12 w-12 text-white/70 drop-shadow" />
            </button>
          </div>
        </div>
      </div>

      <QuestHud step={QUEST_STEPS[questAt] ?? null} index={Math.min(questAt, QUEST_DONE - 1)} />

      <WorldModals active={hotspot} onClose={closeModal} />

      <StoryIntro
        open={intro}
        onExplore={() => setIntro(false)}
        onShowFall={() => {
          setIntro(false);
          stumble();
        }}
      />

      <LoreModal stone={stone} onClose={() => setStone(null)} />

      <BookModal
        open={bookOpen}
        onClose={() => {
          setBookOpen(false);
          // Same rule as the door modals: the step is "you read it", so it
          // ticks on close. The tome has no hotspot, so it cannot go through
          // `closeModal`.
          completeStep("tome");
        }}
      />

      <WardstoneOverlay
        open={fallOpen}
        runId={runId}
        onSay={setSay}
        onClose={() => setFallOpen(false)}
        onOpenDocs={() => {
          setDismissed(null);
          setHotspot("docs");
        }}
      />

      {debugPos && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-full border border-white/40 bg-black/50 px-3 py-1 text-[11px] text-white">
          xz {debugPos}
        </div>
      )}
    </div>
  );
}
