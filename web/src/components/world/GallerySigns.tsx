"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";

import { Bookshelf } from "@/components/world/Bookshelf";
import { Monoliths } from "@/components/world/Monolith";
import { MuseumTable } from "@/components/world/MuseumTable";
import { Torches } from "@/components/world/Torch";
import { WorldSign } from "@/components/world/WorldSign";
import { assertLandmarkGround, LANDMARK_LIST } from "@/lib/landmarks";
import type { LoreStone } from "@/lib/museum";

/**
 * Everything standing in the world that is not part of the map: the three door
 * boards, the table in the middle of the gallery, and the standing stones.
 *
 * All of it lives in WORLD space, mounted as a sibling of `Map` rather than
 * inside it — `Map` carries `scale 0.4` and `position [-4,-3,-6]`, so world
 * coordinates placed inside it would be silently transformed.
 *
 * Every transform here is measured, not typed. `lib/gallery.ts`,
 * `lib/museum.ts` and `lib/landmarks.ts` hold the numbers;
 * `scripts/measure-gallery.mjs` regenerates and verifies the gallery ones.
 */

export function GallerySigns({
  onOpenStone,
  onOpenBook,
}: {
  onOpenStone: (s: LoreStone) => void;
  onOpenBook: () => void;
}) {
  const scene = useThree((s) => s.scene);

  // Dev drift check, run late on purpose: the same "measure on frame one"
  // mistake this replaces would make it report nonsense.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const t = setTimeout(() => {
      assertLandmarkGround(
        scene,
        new THREE.Raycaster(),
        (x, y, z) => new THREE.Vector3(x, y, z),
      );
    }, 4000);
    return () => clearTimeout(t);
  }, [scene]);

  return (
    <>
      {/* Door boards. Positions and heights come from lib/landmarks.ts, which
          records what is actually above each doorway — the cottage eave, the
          gatehouse vault, the portal arch — and why each board sits where it
          does relative to them.

          The four numbered wall headings (I..IV) were removed with the wall
          posters: with bare walls behind them they labelled nothing. The
          measured transforms survive in lib/gallery.ts if they are ever
          wanted back. */}
      {LANDMARK_LIST.map((l) => (
        <WorldSign
          key={l.id}
          at={l.sign.at}
          y={l.sign.y}
          title={l.sign.title}
          subtitle={l.sign.subtitle}
          width={l.sign.width}
        />
      ))}

      {/* Furniture, also world space: the table in the middle of the room and
          the five standing stones on the measured ring around it. */}
      <MuseumTable onOpenBook={onOpenBook} />
      <Monoliths onOpen={onOpenStone} />
      <Torches />
      <Bookshelf />
    </>
  );
}
