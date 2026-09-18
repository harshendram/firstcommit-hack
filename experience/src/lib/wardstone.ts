/**
 * The wardstone — the in-world name for Suraksha's watch.
 *
 * Everything below mirrors the real pipeline in `ally/`. Nothing here invents a
 * capability the product does not have: the questions, the severities, the tier
 * names and the ordering are the ones the backend actually uses. Only the clock
 * is compressed, and the overlay says so on screen.
 *
 * Real timings, for reference:
 *   FALL_WINDOW_MIN = 2            (ally/config.py) — minutes she has to answer
 *   ESCALATION_CONTACT_TIMEOUT=180 (ally/config.py) — seconds per family contact
 */

/** One row in the overlay's "what is actually happening" rail. */
export interface RailStep {
  id: string;
  /** File under /public/aws — the same seven icons the museum walls carry. */
  icon?: string;
  /** Badge over the row. Omitted when the step is plain code, not a service. */
  service?: string;
  /** The real call this step maps to. */
  call: string;
  /** Said plainly, for someone who does not read Python. */
  note: string;
  /** Where to look in the repo. */
  source: string;
  /** Rendered dim: the real workflow has this step, this run never reached it. */
  skipped?: boolean;
}

/** Demo clock. Real windows are minutes; the overlay labels the compression. */
export const TIMING = {
  /** Impact screen before Suraksha speaks. */
  impactMs: 1900,
  /** Stand-in for FALL_WINDOW_MIN = 2 minutes. */
  answerMs: 12_000,
  /** Stand-in for ESCALATION_CONTACT_TIMEOUT = 180 seconds. */
  stepMs: 2100,
  /** How long the character is on the ground and input-locked. */
  fallLockMs: 1600,
} as const;

export const HONESTY_NOTE =
  "Simulated in the browser · the real window is 2 minutes to answer, then 3 minutes per contact";

/** Beat 1 — the watch feels it. */
export const IMPACT_STEP: RailStep = {
  id: "impact",
  icon: "lambda.svg",
  service: "AWS Lambda",
  call: 'POST /ally/watch { kind: "fall" }',
  note: "Accelerometer and gyroscope agree it was a fall. One request, one Lambda, running only for this moment.",
  source: "ally/app.py · watch()",
};

/** Beat 2 — it asks her first. This is the whole product. */
export const ASK_STEP: RailStep = {
  id: "ask",
  icon: "polly.svg",
  service: "Amazon Polly",
  call: "on_possible_fall() → channel.post(audience=\"parent\")",
  note: "A fall is never a silent alert and never an immediate blast to the family. She gets a moment to say she is fine.",
  source: "ally/agents/orchestrator.py · on_possible_fall()",
};

/** The question Suraksha actually asks, in both languages the backend sends. */
export const ASK_COPY = {
  hi: "मुझे लगा कि आप गिर गई हैं। आप ठीक हैं?",
  en: "It looked like you may have fallen. Are you alright?",
} as const;

/**
 * Suraksha is the band on the wrist and the voice that speaks through it.
 * One name for both: the face wears it and the dialogue is its own.
 */
export const DEVICE_NAME = "SURAKSHA";

/** Roman numerals, so the sequence and the gallery walls count the same way. */
export const ROMAN = ["I", "II", "III", "IV", "V"] as const;

/**
 * What the wardstone says out loud, shown in the comic balloon above her.
 * Short lines: this is a speech bubble, not a paragraph.
 */
export const BUBBLE = {
  impact: { hi: "", en: "…that was a fall." },
  ask: { hi: ASK_COPY.hi, en: ASK_COPY.en },
  okay: { hi: "ठीक है। मैं कुछ नहीं कहूँगी।", en: "Good. I'll say nothing." },
  escalating: { hi: "", en: "No answer. I'm finding someone." },
  resolvedOkay: { hi: "", en: "Nobody was called." },
  resolvedHelp: { hi: "", en: "Priya is on her way." },
} as const;

export type BubbleKey = keyof typeof BUBBLE;

/** Branch A — she answers. Everything stops. */
export const OKAY_STEPS: RailStep[] = [
  {
    id: "okay",
    icon: "dynamodb.svg",
    service: "Amazon DynamoDB",
    call: "on_im_okay() → investigation closed",
    note: "The investigation closes where it stands. The family is never told it happened.",
    source: "ally/agents/orchestrator.py · on_im_okay()",
  },
  {
    id: "audit",
    call: "consent audit log",
    note: "The only trace is a line Amma can read herself, on her own privacy screen.",
    source: "ally/policy/hook.py · ConsentGuard",
  },
];

/** Branch B — she cannot answer. Code decides, then people are found. */
export const ESCALATION_STEPS: RailStep[] = [
  {
    id: "gate",
    call: "GateResult(passed=True, score=0.8)",
    note: "watch_detected_possible_fall · strong. A deterministic gate runs before any model is asked anything.",
    source: "ally/scoring/deviation.py",
  },
  {
    id: "judge",
    icon: "nova.svg",
    service: "Amazon Nova",
    call: "judge → severity, confidence",
    note: "The model informs the decision. It never makes it.",
    source: "ally/scoring/judge.py",
  },
  {
    id: "policy",
    call: "tiers.decide(after_fall=True, no_response=True)",
    note: "She may be on the floor and unable to answer: treat silence as critical. → tier 2 · coordinate_family",
    source: "ally/policy/tiers.py",
  },
  {
    id: "rahul",
    icon: "stepfunctions.svg",
    service: "AWS Step Functions",
    call: "ask_contact(Rahul) · waitForTaskToken",
    note: "A push lands on Rahul's phone with answer buttons. The workflow waits — it does not poll, and it does not give up.",
    source: "ally/escalation/steps.py · ask_contact()",
  },
  {
    id: "priya",
    icon: "stepfunctions.svg",
    service: "AWS Step Functions",
    call: "next_contact() → ask_contact(Priya)",
    note: "Rahul's window passed. Priya accepted from the notification itself — she is nine minutes away.",
    source: "ally/escalation/steps.py · next_contact()",
  },
  {
    id: "cedar",
    skipped: true,
    call: "ask_parent_neighbour() → contact_neighbour()",
    note: "Not reached this time. Had both children stayed quiet, Suraksha would ask Amma about the neighbour first — and wake her only if Amma's own Cedar rule allows it.",
    source: "ally/policy/consent.py",
  },
  {
    id: "resolved",
    call: "escalation resolved",
    note: "One person, actually coming. Nobody else was told.",
    source: "ally/escalation/service.py",
  },
];

/* ------------------------------------------------------------------ *
 * Opening story. Shown every run by default so demos repeat; the opt-out
 * is local-only, like `stoneVisibility` (decision D1 — no network).
 * ------------------------------------------------------------------ */

const INTRO_KEY = "ally.intro.hidden";

export function introHidden(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false; // private mode / storage blocked: tell the story anyway
  }
}

export function setIntroHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(INTRO_KEY, "1");
    else localStorage.removeItem(INTRO_KEY);
  } catch {
    /* nothing to do — the story just shows again next time */
  }
}

/* ------------------------------------------------------------------ *
 * Command bus.
 *
 * The Stumble pill lives in the DOM HUD; the character lives inside the
 * R3F tree. Module-level state is how this file's neighbours already
 * bridge that gap (see `playerPosition` in characterController.tsx).
 * ------------------------------------------------------------------ */

type FallListener = () => void;
const listeners = new Set<FallListener>();

/** Ask the character to take a fall. No-op until the controller is mounted. */
export function requestFall() {
  for (const fn of listeners) fn();
}

/** Returns an unsubscribe function. */
export function subscribeFall(fn: FallListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Keeps her on the ground for as long as the panel is open. Getting up halfway
 * through would undercut the one beat that matters: she is down and not
 * answering. Read per-frame, so it is module state rather than React state.
 */
export const fallHold = { active: false };

export function setFallHold(active: boolean) {
  fallHold.active = active;
}

/* ------------------------------------------------------------------ *
 * Wrist glow — read every frame by the 3D wardstone on her forearm, so
 * the watch reacts before any DOM appears.
 * ------------------------------------------------------------------ */

export type WristMood = "calm" | "alert" | "resolved";
export const wrist = { mood: "calm" as WristMood };

export function setWristMood(mood: WristMood) {
  wrist.mood = mood;
}
