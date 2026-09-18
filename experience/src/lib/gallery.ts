/**
 * The gallery, measured.
 *
 * Every number in this file came out of `scripts/measure-gallery.mjs`, which
 * reads the board transforms straight from `Map.tsx` and the GLB. Nothing here
 * is eyeballed, and nothing here should be hand-edited — change the scene, run
 * the script, paste its output back.
 *
 * Why this file exists: plaques were previously positioned by typing
 * plausible-looking numbers. All four ended up facing into their own wall
 * (which renders the canvas mirrored), mis-centred by up to 2 world units, and
 * tall enough to overlap the boards they were labelling.
 *
 * Geometry facts the rest of the code depends on:
 * - A board is a 1x1 quad flat in XZ, rotated `[PI/2, 0, theta]`.
 * - Its inward normal is therefore `(-sin theta, 0, cos theta)`.
 * - Under Map's `position [-4,-3,-6] scale 0.4`, a board is 0.4 world across
 *   and sits at world y -2.539, so its top edge is at -2.339.
 */

export const BOARD_WORLD_SIZE = 0.4;
export const BOARD_WORLD_Y = -2.539;
export const BOARD_TOP_Y = BOARD_WORLD_Y + BOARD_WORLD_SIZE / 2;

/** Plaque geometry, derived from the board row it sits above. */
export const PLAQUE = {
  height: 0.3,
  /** Clearance between the top of a board and the bottom of the plaque. */
  gap: 0.1,
  /** Pushed off the wall along the inward normal so it cannot z-fight. */
  standoff: 0.03,
} as const;

/** World Y of every plaque: board top + gap + half the plaque's height. */
export const PLAQUE_Y = BOARD_TOP_Y + PLAQUE.gap + PLAQUE.height / 2;

export type WallId = "signal" | "understand" | "find" | "remember";

export interface GalleryWall {
  numeral: string;
  heading: string;
  /** World XZ centre of the wall's FLAT run — plaques only sit on flat wall. */
  centre: [number, number];
  /** Inward normal, unit, horizontal. */
  inward: [number, number];
  /** Y-rotation that points a plane's +Z along `inward`. */
  rotationY: number;
  /**
   * Plaque width. `signal` and `understand` share one front wall with centres
   * 1.28 apart, so both are capped at 1.05 to leave a 0.23 gap between them.
   */
  width: number;
}

export const GALLERY_WALLS: Record<WallId, GalleryWall> = {
  signal: {
    numeral: "I",
    heading: "The Signal",
    centre: [-10.8, -9.59],
    inward: [0, -1],
    rotationY: Math.PI,
    width: 1.05,
  },
  understand: {
    numeral: "II",
    heading: "Understanding Her",
    centre: [-12.08, -9.59],
    inward: [0, -1],
    rotationY: Math.PI,
    width: 1.05,
  },
  find: {
    numeral: "III",
    heading: "Finding Someone",
    centre: [-11.74, -15.16],
    inward: [0, 1],
    rotationY: 0,
    width: 2.1,
  },
  remember: {
    numeral: "IV",
    heading: "What It Remembers",
    centre: [-14.385, -12.57],
    inward: [1, 0],
    rotationY: Math.PI / 2,
    width: 1.66,
  },
};

/** World transform for a wall's plaque, standoff included. */
export function plaqueTransform(id: WallId) {
  const w = GALLERY_WALLS[id];
  return {
    position: [
      w.centre[0] + w.inward[0] * PLAQUE.standoff,
      PLAQUE_Y,
      w.centre[1] + w.inward[1] * PLAQUE.standoff,
    ] as [number, number, number],
    rotation: [0, w.rotationY, 0] as [number, number, number],
    width: w.width,
    height: PLAQUE.height,
  };
}

export type BoardRole = "logo" | "placard" | "hidden";

export interface BoardAssignment {
  wall: WallId;
  role: BoardRole;
  /** `ALLY_SERVICES` id. Absent when hidden. */
  service?: string;
}

/**
 * What each of the 25 boards shows.
 *
 * All of them are hidden: the wall posters were removed at the user's request.
 * The walls now carry only their carved section headings, and the architecture
 * lives on the tome on the table and the standing stones around it.
 *
 * The table is kept rather than deleted so a board can be switched back on by
 * changing one word, and so `measure-gallery.mjs` still accounts for all 25.
 */
export const GALLERY_BOARDS: Record<string, BoardAssignment> = {
  // I - The Signal (front wall, x -11.23 .. -9.18).
  square_: { wall: "signal", role: "hidden" },
  civil_instagram_final: { wall: "signal", role: "hidden" },
  "Robosoccer_1080x1080": { wall: "signal", role: "hidden" },
  bomb_squad_10: { wall: "signal", role: "hidden" },
  "Lakshman_rekha_1_1": { wall: "signal", role: "hidden" },
  "Code-Relay@Square": { wall: "signal", role: "hidden" },

  // II - Understanding Her (front wall, x -14.14 .. -11.66).
  "Sherlocked@square": { wall: "understand", role: "hidden" },
  post001: { wall: "understand", role: "hidden" },
  insta: { wall: "understand", role: "hidden" },
  "cc-insta_Final": { wall: "understand", role: "hidden" },
  wired_square: { wall: "understand", role: "hidden" },
  "Escape_RoomSquar-1": { wall: "understand", role: "hidden" },
  "IMG_2654": { wall: "understand", role: "hidden" },

  // III - Finding Someone (back wall, x -13.88 .. -10.86).
  "Jam_1080x1080": { wall: "find", role: "hidden" },
  "Roadies_Posters@2x": { wall: "find", role: "hidden" },
  final1080plss: { wall: "find", role: "hidden" },
  animeverse: { wall: "find", role: "hidden" },
  bits_with_benifits: { wall: "find", role: "hidden" },
  mad_ad_insta: { wall: "find", role: "hidden" },
  "AntakshariPostFinal": { wall: "find", role: "hidden" },
  meme_wars: { wall: "find", role: "hidden" },

  // IV - What It Remembers (left wall, z -13.23 .. -11.91).
  paint_nd_pixel_insta: { wall: "remember", role: "hidden" },
  Thinking_Cap_squar: { wall: "remember", role: "hidden" },
  post: { wall: "remember", role: "hidden" },
  Respawn: { wall: "remember", role: "hidden" },
};
