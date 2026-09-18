/**
 * The three places the world is about, and the measured heights they sit at.
 *
 * ## Why these numbers are written down
 *
 * The door boards used to find their own height: a ray straight down from
 * y = 30 on the sign's first frame, first hit wins, plus 1.7. Three separate
 * things were wrong with that, and all three were seen in the running scene:
 *
 * 1. **The first frame is too early.** World matrices are not current yet, so
 *    the ray hits the map at its *authoring* transform — the untransformed
 *    village is ~50 units across — and the board locks in at y ≈ 21, which is
 *    what "the boards are too high in the sky" was.
 * 2. **The ray hits whatever is in the way.** With no camera on a bare
 *    `Raycaster` and `camIgnore` only checked on the hit object (never its
 *    parents), the Teammates board once measured off the spawning character's
 *    torso at y = 19, and the quest beacon then measured off the board and
 *    stacked on top of it.
 * 3. **The first hit is not the ground.** Both doors have something over them:
 *    the cottage eave sits at −1.299 above ground at −2.954, and the gatehouse
 *    vault at −0.679 above a floor at −3.077. "Ground + 1.7" off those puts the
 *    board over the roof.
 *
 * So the heights are measured once and committed, the way `lib/gallery.ts`
 * holds the plaque transforms.
 *
 * ## How they were measured
 *
 * By casting straight down through the *running* scene (the only faithful
 * model: `Map.tsx` re-declares the glTF node transforms in JSX, so a ray
 * against `world.glb`'s own node tree gives different answers) and reading the
 * hit stack at each XZ. A stack at the cottage door, for instance:
 *
 *   −1.299  cottage eave
 *   −1.490 · −1.521 · −1.550  upper floor
 *   −2.401 · −2.441  deck
 *   −2.954  ground            ← the one that matters
 *
 * `assertLandmarkGround()` re-checks these against the live scene in dev and
 * warns if the map ever moves under them, which is the drift the numbers here
 * cannot notice on their own.
 */

import type * as THREE from "three";

import type { HotspotId } from "@/lib/hotspots";
import { TEAM_NAME } from "@/lib/hotspots";

export interface Landmark {
  id: HotspotId;
  /**
   * The hanging board.
   *
   * `at` is deliberately NOT always the hotspot coordinate. Two of the three
   * hotspots sit *under* something — the cottage eave, the gatehouse vault —
   * so a board there is either buried in masonry or floating over the roof.
   * Each board is pulled out to the open air on its approach side instead,
   * close enough that walking to the board walks you into the hotspot.
   */
  sign: {
    at: [number, number];
    /** World Y of the board's centre. Measured, not offset from anything. */
    y: number;
    title: string;
    subtitle?: string;
    /** Board width; the default in `WorldSign` is 1.1. */
    width?: number;
  };
  /** Where the quest beacon stands, and the ground it stands on. */
  beacon: {
    at: [number, number];
    ground: number;
  };
}

export const LANDMARKS: Record<HotspotId, Landmark> = {
  team: {
    id: "team",
    // Ground −3.00. The board hangs in the open east of the deck rail: at the
    // door itself the eave is only 0.05 above where the board wants to be.
    sign: {
      at: [-0.35, -1.0],
      y: -1.25,
      title: "Teammates",
      subtitle: `Team ${TEAM_NAME}`,
    },
    beacon: { at: [-0.35, -1.0], ground: -3.0 },
  },
  docs: {
    id: "docs",
    // The gatehouse face is at x ≈ −7.7; the arch opening tops out at −0.958
    // and the parapet at −0.110. The board sits on that band of wall, clear of
    // the stone by 0.35 so billboarding never swings it into the wall.
    sign: {
      at: [-7.35, -12.12],
      y: -0.92,
      title: "AWS Architecture",
      subtitle: "Gallery",
      width: 1.45,
    },
    // Inside the room, by the bookshelf — NOT at the gate. The Documentation
    // modal only opens in here now (D15), so a beacon on the gatehouse left
    // you standing on the threshold with the compass reading 0 m and nothing
    // happening. 0.63 from the (−10.4,−9.4) docs zone, so arriving at the
    // beacon opens the panel; the floor is a flat −3.080 across the gallery,
    // and unlike the two docs zones themselves this spot has open sky above,
    // so the beacon is not buried in the wall over the mouth.
    beacon: { at: [-10.6, -10.0], ground: -3.08 },
  },
  portal: {
    id: "portal",
    // Asked for explicitly: a board over the portal. The arch tops out at
    // −1.392, so the board clears it by a hand's width.
    sign: {
      at: [-4.0, -2.8],
      y: -1.1,
      title: "The Way Out",
      subtitle: "Suraksha's written story",
    },
    // In front of the arch, not inside it: a beacon on the portal's own XZ
    // would hover behind the stone.
    beacon: { at: [-4.0, -1.85], ground: -3.78 },
  },
};

/**
 * The gallery floor, measured the same way and flat across the whole room:
 * −11.2,−8.6 · −10.4,−9.4 · −10.6,−10.0 · −9.9,−9.78 · −9.3,−10.6 and the
 * room centre all return −3.080.
 *
 * Lives here rather than in `lib/museum.ts`, which states outright that it
 * writes down no floor heights — its furniture raycasts at mount, which is
 * fine for something standing ON the floor. The quest beacon is not: it hangs
 * 2.2 above it, and D14 is about not finding that number with a ray.
 */
export const GALLERY_FLOOR = -3.08;

export const LANDMARK_LIST = Object.values(LANDMARKS);

/**
 * Dev-only drift check: does the live scene still have ground where we say?
 *
 * Deliberately tests *any* hit in the column rather than the first one — the
 * first hit is a roof at two of the three, and that confusion is what this
 * file exists to end. Extra objects in the scene can only add hits, so a
 * mismatch means the map itself moved.
 */
export function assertLandmarkGround(
  scene: THREE.Object3D,
  ray: THREE.Raycaster,
  vec: (x: number, y: number, z: number) => THREE.Vector3,
) {
  for (const l of LANDMARK_LIST) {
    const [x, z] = l.beacon.at;
    ray.set(vec(x, 30, z), vec(0, -1, 0));
    const hits = ray.intersectObjects(scene.children, true);
    const near = hits.some((h) => Math.abs(h.point.y - l.beacon.ground) < 0.3);
    if (!near) {
      console.warn(
        `[landmarks] ${l.id}: no surface near the committed ground ${l.beacon.ground} at (${x}, ${z}). ` +
          `Column: ${hits
            .slice(0, 8)
            .map((h) => h.point.y.toFixed(3))
            .join(", ")}. Re-measure lib/landmarks.ts.`,
      );
    }
  }
}
