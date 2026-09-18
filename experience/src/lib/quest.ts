/**
 * The guided route through the world.
 *
 * Four things are worth seeing and nothing told anyone to see them, so people
 * left without the fall — the one part that shows what Suraksha actually does.
 *
 * Targets are read from `lib/landmarks.ts`, which holds the measured beacon
 * spot and ground for each of the three places. `HotspotId` is deliberately
 * NOT extended: decision D3 freezes it at `portal | docs | team`, and the
 * quest only needs to read those coordinates.
 */

import { GALLERY_FLOOR, LANDMARKS } from "@/lib/landmarks";
import { ROOM_CENTRE } from "@/lib/museum";

export type QuestStepId = "makers" | "stack" | "tome" | "fall" | "story";

export interface QuestStep {
  id: QuestStepId;
  /** Shown as the card's heading. */
  title: string;
  /** One line under it, saying where to go or what to do. */
  hint: string;
  /**
   * World XZ the beacon and compass point at.
   *
   * `null` for the fall, which is a HUD action with no location — the compass
   * has nothing to bear on and must dim rather than point somewhere arbitrary.
   */
  at: [number, number] | null;
  /**
   * Measured ground under `at`, for the beacon to stand on. `null` with `at`.
   *
   * Passed in rather than raycast: the beacon used to find its own floor and
   * take the first hit, which put it on a rooftop — or, once, on top of a door
   * board that had made the same mistake.
   */
  ground: number | null;
}

export const QUEST_STEPS: QuestStep[] = [
  {
    id: "makers",
    title: "Meet the makers",
    hint: "The timber cottage door",
    at: LANDMARKS.team.beacon.at,
    ground: LANDMARKS.team.beacon.ground,
  },
  {
    id: "stack",
    title: "See what it runs on",
    hint: "Through the stone arch, by the bookshelf",
    at: LANDMARKS.docs.beacon.at,
    ground: LANDMARKS.docs.beacon.ground,
  },
  {
    id: "tome",
    title: "Read the tome",
    hint: "The book on the table, in the middle of the room",
    // Over the table itself. The room centre is derived in `lib/museum.ts`
    // from the board extents, and the floor under it is the flat −3.080 the
    // whole gallery sits on.
    at: ROOM_CENTRE,
    ground: GALLERY_FLOOR,
  },
  {
    id: "fall",
    title: "Watch it happen",
    hint: "Press the Stumble control, bottom right — or F",
    at: null,
    ground: null,
  },
  {
    id: "story",
    title: "Read the written story",
    hint: "The teal stone portal",
    at: LANDMARKS.portal.beacon.at,
    ground: LANDMARKS.portal.beacon.ground,
  },
];

/** Closing this hotspot's modal completes that step. */
export const HOTSPOT_FOR_STEP: Partial<Record<QuestStepId, "portal" | "docs" | "team">> = {
  makers: "team",
  stack: "docs",
  story: "portal",
};

export const QUEST_DONE = QUEST_STEPS.length;
