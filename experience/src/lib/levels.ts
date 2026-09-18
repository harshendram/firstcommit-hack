/**
 * The five beats of Suraksha's day, each one revealing the AWS service behind it.
 *
 * `range` is a slice of global scroll progress (0..1). The stage is 6 viewports
 * tall, so each level owns roughly one screen of scrolling.
 */
export interface Level {
  id: string;
  /** AWS service name, or null for the quiet opening/closing beats. */
  service: string | null;
  /** Filename under /public/aws. Official AWS Architecture Icons, unmodified. */
  icon: string | null;
  eyebrow: string;
  headline: string;
  body: string;
  range: [number, number];
}

export const LEVELS: Level[] = [
  {
    id: "quiet",
    service: null,
    icon: null,
    eyebrow: "6:40 am",
    headline: "Before she's up, Suraksha says nothing.",
    body: "No camera in the hallway. No panic button on the wall. A watch on her wrist, and a tablet she can ignore.",
    range: [0.0, 0.18],
  },
  {
    id: "lambda",
    service: "AWS Lambda",
    icon: "lambda.svg",
    eyebrow: "7:14 am · first movement",
    headline: "She gets up. A function wakes.",
    body: "The watch posts a single signal to API Gateway. A Lambda container picks it up — no server was running a moment ago, and none will be a moment later.",
    range: [0.18, 0.36],
  },
  {
    id: "bedrock",
    service: "Amazon Bedrock",
    icon: "bedrock.svg",
    eyebrow: "Nova 2 Lite",
    headline: "Suraksha thinks — then asks her first.",
    body: "A Strands agent reasons over what it actually knows, and answers in her language. Cedar checks every tool call before it runs, so she decides what her children get told.",
    range: [0.36, 0.54],
  },
  {
    id: "dynamodb",
    service: "Amazon DynamoDB",
    icon: "dynamodb.svg",
    eyebrow: "One item per fact",
    headline: "It remembers what her normal looks like.",
    body: "Weeks of ordinary mornings in a single table. That memory is the only reason Suraksha can tell an unusual day from a quiet one.",
    range: [0.54, 0.72],
  },
  {
    id: "stepfunctions",
    service: "AWS Step Functions",
    icon: "stepfunctions.svg",
    eyebrow: "Only when it matters",
    headline: "No answer. So it finds someone who can come.",
    body: "Rahul, then Priya, then the neighbour — one at a time, each with a real timeout, each waiting on a task token. Nobody gets a siren. Somebody gets a knock on the door.",
    range: [0.72, 0.9],
  },
  {
    id: "resolve",
    service: null,
    icon: null,
    eyebrow: "Most days",
    headline: "Nothing happens. That's the point.",
    body: "Suraksha is built to stay quiet. The architecture exists so that the one morning it matters, it already knows what to do.",
    range: [0.9, 1.0],
  },
];
