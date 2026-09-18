/**
 * Timed end-to-end run-through script for demo validation.
 * Usage: npx tsx scripts/runthrough.ts
 */
const BASE = process.env.API_BASE ?? "http://localhost:3001/api";

interface Session {
  state: string;
  severity: string | null;
  transcript: { speaker: string; text: string }[];
  handoff: { condition: string } | null;
  escalation_chain: { contact_role: string; status: string }[];
  timeline: { label: string; elapsed_ms: number }[];
}

async function post(path: string, body?: unknown): Promise<Session> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as Session;
}

async function getSession(): Promise<Session> {
  const res = await fetch(`${BASE}/session`);
  return (await res.json()) as Session;
}

const SCENARIOS: { name: string; trigger: string; lines: string[] }[] = [
  {
    name: "fall",
    trigger: "simulated_fall",
    lines: ["I fell and I cannot get up. My hip hurts."],
  },
  {
    name: "chest",
    trigger: "manual_tap",
    lines: ["There's a tight pain in my chest and it's hard to breathe."],
  },
  {
    name: "confused",
    trigger: "voice_distress",
    lines: ["I don't know where I am... everything feels strange..."],
  },
  {
    name: "mild",
    trigger: "manual_tap",
    lines: ["I feel a little dizzy but I think I'm okay."],
  },
];

async function runOne(i: number): Promise<{
  ok: boolean;
  name: string;
  ms: number;
  state: string;
  detail: string;
}> {
  const scenario = SCENARIOS[i % SCENARIOS.length]!;
  const t0 = Date.now();
  await post("/reset");
  await post("/trigger", { trigger_type: scenario.trigger });
  let session: Session | null = null;
  for (const line of scenario.lines) {
    session = await post("/patient/text", { text: line });
  }
  // Stay-with-patient turn for escalated cases
  if (session && session.state !== "reassuring" && session.state !== "resolved") {
    session = await post("/patient/text", {
      text: "Please stay with me.",
    });
  }
  if (
    session &&
    (session.state === "awaiting_handover" || session.state === "escalating")
  ) {
    session = await post("/confirm-arrival");
  }
  const ms = Date.now() - t0;
  const final = session ?? (await getSession());

  const isMild = scenario.name === "mild";
  const ok = isMild
    ? final.state === "reassuring" || final.severity === "low"
    : final.state === "resolved" && final.handoff !== null;

  return {
    ok,
    name: scenario.name,
    ms,
    state: final.state,
    detail: final.handoff?.condition ?? final.severity ?? "",
  };
}

async function main() {
  console.log("Rakshak run-throughs × 12\n");
  const results = [];
  for (let i = 0; i < 12; i++) {
    try {
      const r = await runOne(i);
      results.push(r);
      console.log(
        `${r.ok ? "✓" : "✗"} #${i + 1} ${r.name.padEnd(8)} ${String(r.ms).padStart(5)}ms  state=${r.state}  ${r.detail.slice(0, 50)}`
      );
    } catch (e) {
      results.push({ ok: false, name: "error", ms: 0, state: "error", detail: String(e) });
      console.log(`✗ #${i + 1} ERROR ${e}`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const avg =
    results.reduce((a, r) => a + r.ms, 0) / Math.max(results.length, 1);
  console.log(`\n${passed}/${results.length} passed · avg ${avg.toFixed(0)}ms`);
  if (passed < results.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
