/**
 * What stands in the middle of the gallery, and what it says.
 *
 * Positions are derived, not typed. The gallery's boards span world
 * x -14.39..-9.18 and z -15.16..-9.59 (see `scripts/measure-gallery.mjs`), so
 * the room centre is the mid-range — not the board centroid, which skews left
 * because the east side is the open entrance. The stones sit on a ring around
 * it, skipping the arc the entrance occupies.
 *
 * Floor height is never written down here: everything raycasts onto the ground
 * at mount, the way `WorldSign` does.
 */

import * as THREE from "three";

import { BOARD_TOP_Y } from "@/lib/gallery";

/** Mid-range of the board extents, i.e. the middle of the room. */
export const ROOM_CENTRE: [number, number] = [-11.79, -12.38];

/**
 * Radius of the stone ring. Pulled in from 2.0: the room is only ~5.2 x 5.6,
 * so at 2.0 the stones stood within ~0.6 of the walls and read as overlapping
 * the wall itself.
 */
export const STONE_RING = 1.5;

export interface LoreStone {
  id: string;
  /**
   * Degrees around ROOM_CENTRE, measured as atan2(dz, dx).
   *
   * The five sweep 90 -> 270, an even arc through the west. The gallery is
   * walled on three sides and open on the east — that is the only side with no
   * board run, and it is where you come in and where the stairs are — so the
   * whole eastern half is deliberately left clear.
   */
  angle: number;
  at: [number, number];
  /** Carved on the plinth and shown as the modal's eyebrow. */
  kicker: string;
  title: string;
  /** Lead paragraph. */
  lead: string;
  /** Body lines. */
  points: string[];
  /** Optional closing line, set in the display face. */
  close?: string;
  /** Optional two-column figure table, used by the market stone. */
  figures?: { label: string; value: string; source: "published" | "assumption" | "price" }[];
}

export const LORE_STONES: LoreStone[] = [
  {
    id: "why",
    angle: 90,
    at: [-11.79, -10.88],
    kicker: "The first stone",
    title: "Why we built it",
    lead: "Adult children worry. Parents hate being watched. Both are right, and almost every product picks a side.",
    points: [
      "A camera in the hall answers the family's question by taking something from the parent. She stops being a person in her home and starts being a subject on a screen.",
      "Silence answers nothing. It leaves four people guessing and one person alone.",
      "Suraksha sits in the gap. It learns what an ordinary morning looks like, it speaks to Amma first, and only then does it go looking for the person who can actually turn up.",
    ],
    close: "Most days, Suraksha says nothing at all.",
  },
  {
    id: "who",
    angle: 135,
    at: [-12.85, -11.32],
    kicker: "The second stone",
    title: "Who it is for",
    lead: "One household, four people, and a disagreement none of them can solve alone.",
    points: [
      "Amma, 72, Bengaluru. Speaks Hindi. Lives on her own and intends to keep it that way. She decides what her children are told — out loud, and Suraksha writes it into a rule it cannot argue with.",
      "Rahul, in Pune. Far enough away that a phone call is all he has.",
      "Priya, in Bengaluru. Close enough to arrive, which makes her the one the workflow asks second.",
      "Sunita, next door. The fastest help there is, and the one Suraksha may not wake unless Amma has allowed it.",
    ],
    close: "The demo family is seeded, not invented for the pitch.",
  },
  {
    id: "market",
    angle: 180,
    at: [-13.29, -12.38],
    kicker: "The third stone",
    title: "How big this gets",
    lead: "Built bottom-up, with the arithmetic left visible — a number you cannot check is not worth showing.",
    figures: [
      { label: "Indians aged 60+", value: "149 million", source: "published" },
      { label: "The same cohort by 2050", value: "347 million", source: "published" },
      { label: "Without an adult child nearby", value: "~1 in 5 → 30M", source: "assumption" },
      { label: "In smartphone-equipped urban homes", value: "~10% → 3M homes", source: "assumption" },
      { label: "Per household", value: "₹499 / month", source: "price" },
      { label: "Reachable revenue", value: "₹1,800 cr/yr · ~$215M", source: "price" },
    ],
    points: [
      "Published figures are from the UNFPA India Ageing Report 2023. The two conversion rates are ours, and are marked as assumptions rather than buried in a total.",
      "The cost side is the other half of this: the escalation workflow only runs when a deterministic gate has already fired, so the expensive part of the system is idle on an ordinary day.",
    ],
    close: "An estimate that shows its working, not a headline.",
  },
  {
    id: "real",
    angle: 225,
    at: [-12.85, -13.44],
    kicker: "The fourth stone",
    title: "What is real here",
    lead: "The question worth asking about any demo, answered before it is asked.",
    points: [
      "Live: Bedrock Nova reasoning, DynamoDB, the Step Functions escalation with real task tokens, Cedar policy evaluation, Polly speech, and Web Push to actual phones.",
      "Simulated: every day before today, and it is labelled as such on screen.",
      "Compressed: the fall sequence in this world runs a 12-second answer window and ~2 seconds per contact. The real ones are 2 minutes and 3 minutes.",
      "Not faked: if Bedrock fails, the API returns llm_unavailable and the interface says so. There is no silent fallback to a canned reply.",
    ],
    close: "The model decides language and judgement. Code decides actions.",
  },
  {
    id: "cost",
    angle: 270,
    at: [-11.79, -13.88],
    kicker: "The fifth stone",
    title: "What it costs to run",
    lead: "A care product that is expensive when nothing is happening cannot be left switched on, and one that is switched off is worthless.",
    points: [
      "DynamoDB on-demand, EventBridge, and Step Functions Standard — a handful of transitions per escalation — come to pennies.",
      "Nova 2 Lite bills per token, and the judge only runs once a deterministic gate has already decided something is off. Quiet days cost almost nothing.",
      "About $0.60 a day removes cold starts on voice turns, once the account's Lambda concurrency quota allows a reservation.",
      "Graviton is a one-flag switch where an arm64 builder is available.",
    ],
    close: "Quiet is the common case, so quiet is what we optimised.",
  },
];

/**
 * The gallery floor under a point, found by raycast rather than written down.
 *
 * Casting from high above and taking the nearest hit lands on the museum
 * ROOF, not the floor, so this keeps only hits below the boards' top edge
 * (world -2.339, measured) and takes the highest of those — which is the floor
 * you stand on, and nothing above or beneath it.
 */
export function groundBelow(
  scene: THREE.Object3D,
  x: number,
  z: number,
  ray: THREE.Raycaster,
): number | null {
  ray.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
  const hit = ray
    .intersectObjects(scene.children, true)
    .find(
      (h) =>
        h.object.visible &&
        !h.object.userData?.camIgnore &&
        h.point.y < BOARD_TOP_Y,
    );
  return hit ? hit.point.y : null;
}

/** A torch bracket on a wall. Height is measured up from the raycast floor. */
export interface TorchSpot {
  id: string;
  at: [number, number];
  /** Facing, as a Y rotation: the torch leans out from the wall behind it. */
  rotationY: number;
}

/** How high above the floor a sconce sits. */
export const TORCH_HEIGHT = 1.15;

/**
 * Slide of the arch pair along -z (screen-right on approach) to centre the door.
 * 0 sat clearly left of the opening and -0.6 overshot to the right, so the
 * doorway's centre is between them.
 */
const ARCH_TORCH_SHIFT = -0.35;

/**
 * Five torches: a flanking pair at the gallery arch, and three inside, one to
 * a wall. Deliberately not one everywhere — a lit room is not the point, a
 * few pools of light are.
 *
 * The entrance pair straddles the `docs` arch hotspot (-7.86, -12.12) across
 * the z axis, because the gallery lies west of the arch so the doorway's width
 * runs north-south. The three inside sit on the measured wall centres from
 * `GALLERY_WALLS`, pushed off the wall by a small standoff.
 */
export const TORCHES: TorchSpot[] = [
  // Arch, either side of the opening. You approach the arch walking west, so
  // screen-right is -z: ARCH_TORCH_SHIFT slides the pair that way to sit
  // centred on the doorway. One number to change if it is still off.
  { id: "arch-n", at: [-7.86, -11.22 + ARCH_TORCH_SHIFT], rotationY: Math.PI / 2 },
  { id: "arch-s", at: [-7.86, -13.02 + ARCH_TORCH_SHIFT], rotationY: Math.PI / 2 },
  // Inside: front wall (midway between the two old plaque centres), back
  // wall, and the left wall.
  { id: "in-front", at: [-11.44, -9.47], rotationY: Math.PI },
  { id: "in-back", at: [-11.74, -15.04], rotationY: 0 },
  { id: "in-left", at: [-14.265, -12.57], rotationY: Math.PI / 2 },
];

/**
 * The bookshelf in the corner immediately left of the entrance.
 *
 * Measured: X 1.006 / Y 2.022 / Z 0.409 after node transforms, base already on
 * y = 0, origin off-centre at (-0.482, _, -0.184), front (its cabinet doors,
 * z ~ -0.355) facing -Z. So: no rotation, and the model is re-centred on its
 * footprint so `at` means the middle of the shelf.
 *
 * You enter facing -x, so left is +z: this is where the z = -9.588 wall meets
 * the open east side. For the opposite corner, set z to about -14.95.
 */
export const BOOKSHELF_SPOT = {
  at: [-9.9, -9.78] as [number, number],
  rotationY: 0,
  /** World units tall: twice the 0.58 table, just over the ~1.13 character. */
  height: 1.15,
};

/**
 * One step on a page's architecture plate.
 *
 * `icon` names a file in `public/aws` — the real service marks, the same ones
 * on the gallery walls and in the Documentation panel. `null` is deliberate:
 * the watch, the gateway and the people at the end of the chain are part of
 * the story and have no AWS logo, and inventing one for them would be a lie
 * dressed as a diagram.
 */
export interface PlateStep {
  icon: string | null;
  label: string;
  /** The call or artefact, set in the mono face under the label. */
  detail?: string;
}

/** A page in the tome on the table. */
export interface BookPage {
  id: string;
  numeral?: string;
  title: string;
  /** Opening paragraph. Its first letter is set as an illuminated capital. */
  lead: string;
  /** Second paragraph, where the page needs one. */
  body?: string;
  /** The architecture drawn with the real marks, top to bottom. */
  plate?: PlateStep[];
  /** The line in the margin — the thing a reader would ask about next. */
  aside?: string;
}

/**
 * The architecture, one page per stage, in the order the morning happens.
 *
 * Deliberately the *same* facts as `lib/wardstone.ts`: the two-minute window,
 * the deterministic gate before the model, the task token, the rolling
 * baseline. The demo re-enacts what this book claims, so if one changes the
 * other has to — a tome that disagrees with the thing on your wrist is worse
 * than no tome.
 */
export const BOOK_PAGES: BookPage[] = [
  {
    id: "signal",
    numeral: "I",
    title: "The Signal",
    lead: "The watch does not stream. It sits quiet on her wrist until the accelerometer and the gyroscope agree on the same half second — and then it sends exactly one request.",
    body: "One request, one function, running only for that moment. Between falls there is nothing listening, because there is nothing to listen to.",
    plate: [
      { icon: null, label: "Galaxy Watch", detail: "accel + gyro agree" },
      { icon: null, label: "API Gateway", detail: "POST /watch" },
      { icon: "lambda.svg", label: "AWS Lambda", detail: 'kind: "fall"' },
    ],
    aside: "Nothing is sent on an ordinary morning. The quiet is the normal state, not a failure to report.",
  },
  {
    id: "asks",
    numeral: "II",
    title: "She Is Asked First",
    lead: "Before one relative is told anything, the stone speaks to Amma in her own language and waits. She has two minutes to say she is fine.",
    body: "Her reply is transcribed, and a model reads it for meaning rather than keywords — “I just sat down” is an answer. If she is well, the investigation closes where it stands and the family is never told.",
    plate: [
      { icon: "polly.svg", label: "Amazon Polly", detail: "on_possible_fall()" },
      { icon: "transcribe.svg", label: "Amazon Transcribe", detail: "her words → text" },
      { icon: "bedrock.svg", label: "Amazon Bedrock", detail: "read for meaning" },
    ],
    aside: "A fall is never a silent alert, and never an immediate blast to the family.",
  },
  {
    id: "silence",
    numeral: "III",
    title: "Silence Is an Answer",
    lead: "If nothing comes back, that is not read as “fine”. She may be on the floor and unable to reach her wrist at all.",
    body: "A deterministic gate runs before any model is asked anything, and the tier is decided in code: after a fall, with no response, the answer is coordinate the family. The model scores severity; it never makes the call.",
    plate: [
      { icon: null, label: "Gate", detail: "GateResult(passed, 0.8)" },
      { icon: "nova.svg", label: "Amazon Nova", detail: "judge → severity" },
      { icon: null, label: "tiers.decide()", detail: "tier 2 · coordinate" },
    ],
    aside: "The model informs the decision. It never makes it — that line is the whole design.",
  },
  {
    id: "find",
    numeral: "IV",
    title: "Finding Someone",
    lead: "One person is asked at a time, and the workflow waits on a real task token — not a poll, not a timer that quietly gives up.",
    body: "A push lands on Rahul’s phone with answer buttons. His window passes; Priya accepts from the notification itself, and she is nine minutes away. Only then would Suraksha ask Amma about the neighbour, and only if Amma’s own rule allows it.",
    plate: [
      { icon: "stepfunctions.svg", label: "AWS Step Functions", detail: "waitForTaskToken" },
      { icon: null, label: "Web Push", detail: "ask_contact(Rahul)" },
      { icon: null, label: "Priya", detail: "accepted · 9 min away" },
    ],
    aside: "One person, actually coming. Nobody else was told.",
  },
  {
    id: "remember",
    numeral: "V",
    title: "What It Remembers",
    lead: "Weeks of ordinary mornings live in a single table: when she usually stirs, how long the kettle takes, which days she goes out.",
    body: "That baseline is the only reason a quiet Tuesday can be told apart from a worrying one. It is kept so that most days can be left alone — the opposite of a camera, which keeps everything so that someone can watch it later.",
    plate: [
      { icon: "dynamodb.svg", label: "Amazon DynamoDB", detail: "rolling baseline" },
    ],
    aside: "What it stores is a shape of a week, not a record of a person.",
  },
  {
    id: "quiet",
    title: "Most Days, Nothing",
    lead: "The best morning Suraksha has is the one where it says nothing at all: she got up, she moved about the house, and no one was told anything.",
    body: "Every service in this book exists for the one morning that breaks the pattern — and to make sure that on all the others, nobody is watching her.",
    aside: "Care without watching.",
  },
];
