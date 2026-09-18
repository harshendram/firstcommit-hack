/** Sanity-check the three demo outcomes against the post-op recovery curve. */
import { buildSeedHistory, CARE_PATIENT } from "../src/care/seed.js";
import { classifyRisk, computeBaseline, buildMemoryAnchor, buildTrend } from "../src/care/baseline.js";
import { EMPTY_SYMPTOMS, type SymptomScores } from "../src/care/types.js";

const history = buildSeedHistory();
const baseline = computeBaseline(history);
const recent = history.slice(-4);

console.log(`Patient: ${CARE_PATIENT.name} — ${CARE_PATIENT.procedure}`);
console.log(`Post-op day ${baseline.post_op_day}`);
console.log(`Expected today:`, baseline.symptoms, `mobility ${baseline.activity_index}`);
console.log(`\nMemory anchor:`);
console.log("  " + (buildMemoryAnchor(history, baseline)?.spokenOpening ?? "(none)"));
console.log("\nTrend:");
for (const t of buildTrend(history, baseline)) console.log(`  ${t.label} — ${t.detail}`);

const cases: { name: string; symptoms: Partial<SymptomScores>; meds: boolean; activity: number }[] = [
  { name: "GREEN  — good day", symptoms: { pain: 1 }, meds: true, activity: 88 },
  { name: "AMBER  — pain back, walking less", symptoms: { pain: 2 }, meds: true, activity: 40 },
  { name: "RED    — fever + wound discharge", symptoms: { pain: 2, fever: 1, wound: 2 }, meds: true, activity: 38 },
  { name: "RED    — wound discharge alone", symptoms: { wound: 3 }, meds: true, activity: 60 },
];

console.log("\n--- Outcomes ---");
for (const c of cases) {
  const out = classifyRisk({
    symptoms: { ...EMPTY_SYMPTOMS, ...c.symptoms },
    medication_taken: c.meds,
    activity_index: c.activity,
    baseline,
    recent,
  });
  console.log(`\n${c.name}`);
  console.log(`  -> ${out.risk.toUpperCase()} (score ${out.score}) ${out.action}`);
  console.log(`  ${out.recommendation}`);
  for (const r of out.reasoning) console.log(`   · ${r}`);
}
