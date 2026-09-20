/** In-world interaction points (XZ). Tight radii — only fire at the door. */
export type HotspotId = "portal" | "docs" | "team";

export interface Hotspot {
  id: HotspotId;
  /** World-space XZ */
  pos: [number, number];
  radius: number;
}

export const HOTSPOTS: Hotspot[] = [
  // Teal stone portal — visit main website
  { id: "portal", pos: [-4.0, -2.8], radius: 1.15 },

  // Inside the gallery, by the bookshelf. The two zones at the gatehouse arch
  // (-7.86,-12.12 and -7.4,-11.5) were removed on request: they opened the
  // very same Documentation modal you get at the shelf, so you read the stack
  // on the doorstep and had no reason to walk in. The gate keeps its board and
  // its quest beacon; the modal now waits inside.
  { id: "docs", pos: [-11.2, -8.6], radius: 1.55 },
  { id: "docs", pos: [-10.4, -9.4], radius: 1.35 },

  // Tudor / rulebook house door — Incridea location id 1
  { id: "team", pos: [-1.0, -1.0], radius: 1.25 },
];

/** Prefer docs over team when zones overlap (museum path never shows Teammates). */
export function hotspotAt(x: number, z: number): Hotspot | null {
  const hits: { h: Hotspot; d: number }[] = [];
  for (const h of HOTSPOTS) {
    const d = Math.hypot(x - h.pos[0], z - h.pos[1]);
    if (d <= h.radius) hits.push({ h, d });
  }
  if (hits.length === 0) return null;

  const docs = hits.filter((x) => x.h.id === "docs");
  if (docs.length > 0) {
    docs.sort((a, b) => a.d - b.d);
    return docs[0]!.h;
  }

  hits.sort((a, b) => a.d - b.d);
  return hits[0]!.h;
}

/** The team behind Suraksha, shown at the Tudor cottage door. */
export const TEAM_NAME = "StarBugs";

/**
 * Names only — no role lines. Credit here is shared, not carved up.
 *
 * `crest` picks the heraldic beast drawn on the avatar (see `Crest.tsx`).
 * Initials in a coloured disc read as an org chart; this modal is parchment.
 */
export const TEAM = [
  { name: "Harshendra", crest: "stag", color: "#4f6b4e" },
  { name: "Naomi", crest: "owl", color: "#44566b" },
  { name: "Shashwath", crest: "fox", color: "#6b5344" },
] as const;

/** Suraksha AWS stack shown on museum walls and in the docs modal. */
export const ALLY_SERVICES = [
  {
    id: "lambda",
    service: "AWS Lambda",
    icon: "lambda.svg",
    title: "Quiet wake",
    body: "A single wrist signal hits API Gateway; Lambda runs only for that moment.",
  },
  {
    id: "bedrock",
    service: "Amazon Bedrock",
    icon: "bedrock.svg",
    title: "Ask her first",
    body: "An agent reasons over what it knows, then talks to Amma in her language.",
  },
  {
    id: "nova",
    service: "Amazon Nova",
    icon: "nova.svg",
    title: "Nova reasoning",
    body: "Bedrock Nova models power the short, careful answers Suraksha needs.",
  },
  {
    id: "dynamodb",
    service: "Amazon DynamoDB",
    icon: "dynamodb.svg",
    title: "Memory of normal",
    body: "Weeks of ordinary mornings so Suraksha can tell quiet from worrying.",
  },
  {
    id: "stepfunctions",
    service: "AWS Step Functions",
    icon: "stepfunctions.svg",
    title: "Find someone",
    body: "Care chain with real timeouts — Rahul, then Priya, then a neighbour.",
  },
  {
    id: "polly",
    service: "Amazon Polly",
    icon: "polly.svg",
    title: "Speak gently",
    body: "Voice replies Amma can hear without reading a screen.",
  },
  {
    id: "transcribe",
    service: "Amazon Transcribe",
    icon: "transcribe.svg",
    title: "Hear her words",
    body: "Streaming speech recognition that picks Hindi or English per clip, so code-mix just works.",
  },
  {
    id: "textract",
    service: "Amazon Textract",
    icon: "textract.svg",
    title: "Read the paperwork",
    body: "A discharge summary becomes structured care context instead of a scanned page nobody opens.",
  },
  {
    id: "comprehend-medical",
    service: "Amazon Comprehend Medical",
    icon: "comprehend-medical.svg",
    title: "Name the medicines",
    body: "Pulls medications, dosages and conditions out of that text so follow-ups are grounded.",
  },
  {
    id: "sns",
    service: "Amazon SNS",
    icon: "sns.svg",
    title: "Tell the family",
    body: "One transactional message to the person who should hear it, mirrored to the on-call topic.",
  },
  {
    id: "connect",
    service: "Amazon Connect",
    icon: "connect.svg",
    title: "Make the call",
    body: "When a message is not enough, a phone rings — and pressing 1 reaches the conversation.",
  },
  {
    id: "s3",
    service: "Amazon S3",
    icon: "s3.svg",
    title: "Hold it briefly",
    body: "Documents and call audio, encrypted, presigned, and expired on a lifecycle rule.",
  },
] as const;

/** @deprecated Prefer ALLY_SERVICES — kept for any leftover imports. */
export const DOC_FEATURES = ALLY_SERVICES.map((s) => ({
  title: s.title,
  body: s.body,
}));
