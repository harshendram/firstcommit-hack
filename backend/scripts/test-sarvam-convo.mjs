// Drive the real LiveSarvamLlmClient through two demo conversations.
import { LiveSarvamLlmClient } from "../src/services/sarvamLlm.js";
import { config } from "../src/config.js";

const scripts = {
  mild: [
    "I'm okay, it's just a bit of hip pain, I can get up by myself.",
    "Yeah, no pain now. I'm okay.",
    "I'll sit on the sofa for a bit.",
  ],
  severe: [
    "I fell in the kitchen, I can't get up.",
    "My hip hurts a lot and I feel dizzy.",
    "Please help me.",
  ],
};

for (const [name, turns] of Object.entries(scripts)) {
  console.log(`\n================ ${name.toUpperCase()} (${config.sarvamLlmModel})`);
  const client = new LiveSarvamLlmClient();
  client.startSession();

  const t0 = Date.now();
  const greeting = await client.sendSystemNote(
    "greeting: The watch detected a possible fall. In ONE short sentence, ask whether the patient is alright and whether they can get up. Do NOT escalate yet."
  );
  console.log(`AI  (${Date.now() - t0}ms): ${greeting.text}`);
  console.log(`    tools: ${JSON.stringify(greeting.toolCalls.map((c) => c.name))}`);

  for (const turn of turns) {
    console.log(`\nPT: ${turn}`);
    const t = Date.now();
    const res = await client.sendPatientTurn(turn);
    console.log(`AI  (${Date.now() - t}ms): ${res.text}`);
    console.log(
      `    tools: ${JSON.stringify(
        res.toolCalls.map((c) => (c.name === "assess" ? `assess:${c.args.severity}` : c.name))
      )}`
    );
  }
}
