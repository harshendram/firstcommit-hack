import { config, DEMO_PATIENT } from "../config.js";
import type { Severity } from "../types.js";
import type { GeminiClient, GeminiTurnResult, ToolCall } from "./gemini.js";

/**
 * Sarvam reasoning models expose OpenAI-style tool calling, but whenever they
 * emit a tool call the `content` field comes back null — and on the follow-up
 * round they parrot the server-side placeholder "(no content)" as the spoken
 * line. So instead of tools we ask for a single JSON object per turn and
 * synthesise the tool calls ourselves. One round trip per turn also keeps the
 * watch latency low.
 */
const SARVAM_SYSTEM_PROMPT = `You are Rakshak, a calm, warm AI first responder talking to an elderly person
who may have just fallen. This is a live voice call, so every spoken line must
be ONE short sentence — never a paragraph, never a list.

Your job:
1. TRIAGE — ask one simple question at a time ("Are you able to stand up?",
   "Where does it hurt?", "Can you breathe okay?"). Keep it human, unhurried.
2. ESCALATE only when they actually need a person: tell them plainly what you
   did ("Security has been informed and a text message has gone to your daughter — is that okay?").
3. STAY — keep talking to them until help arrives. Never hang up on them.

Severity guide:
- "low": mild discomfort only, and they can stand, talk and breathe normally
  (e.g. "just a bit of hip pain, I can get up"). Stay with them, do NOT call anyone.
- "medium": pain or unsteadiness that needs family attention soon.
- "high": urgent — cannot get up, chest pain, trouble breathing, bleeding,
  confusion, or they are asking for help.

Escalation rule: set "escalate" to true ONLY when severity is "high", or when
severity is "medium" and they cannot manage on their own. Never escalate on the
very first greeting, before they have said anything.

When "escalate" is false, never say that help is coming, that someone has been
called, or that you are waiting with them for help — nobody has been contacted.
Just keep them company and ask how they are doing.

Patient you are speaking to:
- Name: ${DEMO_PATIENT.name}
- Age: ${DEMO_PATIENT.age}
- Location: ${DEMO_PATIENT.location}
- Medical history: ${DEMO_PATIENT.medical_history.join(", ")}
- Medications: ${DEMO_PATIENT.medications.join(", ")}

OUTPUT FORMAT — this is absolute. Reply with ONLY a single JSON object, no
markdown fences, no commentary before or after:
{"say":"<one short sentence spoken aloud to the patient>",
 "severity":"low|medium|high",
 "reasoning":"<short clinical read, not spoken>",
 "escalate":true|false,
 "condition":"<short clinical phrase>",
 "symptoms":["<symptom>"],
 "recommended_action":"<short instruction for the responder>"}
"say" is the only field the patient hears — never put JSON, field names or
stage directions inside it.

LANGUAGE (critical for this demo):
- Greeting / system notes before the patient speaks: clear simple English is fine.
- Once the patient speaks Hindi or Hindi–English code-mix (Hinglish), your
  "say" MUST match them — natural Hinglish or Hindi, not formal English-only.
- If they speak English, reply in clear simple English.
- Switch language when they switch. Never ignore a Hindi/code-mix turn.`;

interface SarvamTurn {
  say?: unknown;
  severity?: unknown;
  reasoning?: unknown;
  escalate?: unknown;
  condition?: unknown;
  symptoms?: unknown;
  recommended_action?: unknown;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Sarvam sometimes returns these instead of a real reply. */
const PLACEHOLDERS = new Set(["(no content)", "no content", "null", "undefined", "none"]);

function isDegenerate(text: string): boolean {
  return text.length === 0 || PLACEHOLDERS.has(text.trim().toLowerCase());
}

/** Pull the first balanced JSON object out of a model reply. */
function extractJson(raw: string): SarvamTurn | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as SarvamTurn;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Keep only what a voice line should contain. */
function cleanSpoken(raw: string): string {
  let text = raw
    .replace(/```(?:json)?/gi, " ")
    .replace(/^\s*[\r\n]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Model occasionally wraps the whole sentence in quotes
  text = text.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  // Drop leaked stage directions like [Call assess] or (severity: high)
  text = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]*/g);
  if (sentences && sentences.length > 2) {
    text = sentences.slice(0, 2).join(" ").trim();
  }
  return text;
}

function normalizeSeverity(value: unknown): Severity | null {
  const raw = String(value ?? "").toLowerCase().trim();
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return null;
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").toLowerCase().trim();
  return raw === "true" || raw === "yes" || raw === "1";
}

export class LiveSarvamLlmClient implements GeminiClient {
  private messages: ChatMessage[] = [];
  private baseUrl = "https://api.sarvam.ai/v1/chat/completions";
  private escalated = false;

  startSession(): void {
    this.messages = [{ role: "system", content: SARVAM_SYSTEM_PROMPT }];
    this.escalated = false;
  }

  reset(): void {
    this.messages = [];
    this.escalated = false;
  }

  async sendPatientTurn(text: string): Promise<GeminiTurnResult> {
    this.ensureSession();
    this.messages.push({ role: "user", content: text });
    return this.complete(false);
  }

  async sendSystemNote(note: string): Promise<GeminiTurnResult> {
    this.ensureSession();
    this.messages.push({
      role: "user",
      content: `[SYSTEM NOTE — not spoken by the patient, reply in the same JSON format]\n${note}`,
    });
    return this.complete(note.startsWith("greeting:"));
  }

  private ensureSession(): void {
    if (this.messages.length === 0) this.startSession();
  }

  private async complete(isGreeting: boolean): Promise<GeminiTurnResult> {
    const raw = await this.request(this.messages);
    const parsed = extractJson(raw);

    let spoken = cleanSpoken(String(parsed?.say ?? (parsed ? "" : raw)));
    if (isDegenerate(spoken)) {
      spoken = cleanSpoken(await this.retryPlainSentence());
    }

    const severity = normalizeSeverity(parsed?.severity);
    const calls: ToolCall[] = [];

    if (severity) {
      calls.push({
        name: "assess",
        args: {
          severity,
          reasoning: String(parsed?.reasoning ?? "").trim() || "Ongoing triage",
        },
      });
    }

    const wantsEscalation =
      !isGreeting && (truthy(parsed?.escalate) || severity === "high");

    if (wantsEscalation && !this.escalated) {
      this.escalated = true;
      calls.push({
        name: "generate_handoff",
        args: {
          patient_name: DEMO_PATIENT.name,
          age: DEMO_PATIENT.age,
          location: DEMO_PATIENT.location,
          condition:
            String(parsed?.condition ?? "").trim() || "Distress after a fall",
          symptoms: Array.isArray(parsed?.symptoms)
            ? (parsed.symptoms as unknown[]).map((s) => String(s)).filter(Boolean)
            : [],
          recommended_action:
            String(parsed?.recommended_action ?? "").trim() ||
            "Urgent family check-in; do not leave alone",
        },
      });
      calls.push({ name: "escalate", args: {} });
      calls.push({ name: "stay_and_reassure", args: {} });
    }

    // Feed the structured reply back so the model keeps the JSON shape
    this.messages.push({
      role: "assistant",
      content: JSON.stringify({
        say: spoken,
        severity: severity ?? "low",
        escalate: wantsEscalation,
      }),
    });
    this.trimHistory();

    if (!spoken) {
      console.warn("[sarvam-llm] no usable spoken line — using fallback");
      spoken = "I'm right here with you. Can you tell me how you're feeling?";
    }

    return { text: spoken, toolCalls: calls };
  }

  /** Last resort: ask for a bare sentence with no JSON wrapper. */
  private async retryPlainSentence(): Promise<string> {
    const text = await this.request([
      ...this.messages,
      {
        role: "user",
        content:
          "[SYSTEM NOTE] Your last reply was empty. Say ONE short caring sentence to the patient now. Plain text only, no JSON.",
      },
    ]);
    return isDegenerate(text) ? "" : text;
  }

  /** Keep the system prompt plus a rolling window of turns. */
  private trimHistory(): void {
    const MAX_TURNS = 20;
    if (this.messages.length <= MAX_TURNS + 1) return;
    this.messages = [
      this.messages[0],
      ...this.messages.slice(this.messages.length - MAX_TURNS),
    ];
  }

  private async request(messages: ChatMessage[]): Promise<string> {
    const body = {
      model: config.sarvamLlmModel,
      messages,
      temperature: 0.3,
      max_tokens: 400,
      // Thinking mode leaves `content` null and dumps everything into
      // reasoning_content, which is useless for a spoken reply.
      reasoning_effort: null,
    };

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      try {
        const res = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "api-subscription-key": config.sarvamApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });

        if (!res.ok) {
          const errBody = await res.text();
          const retryable = res.status === 429 || res.status >= 500;
          lastErr = new Error(`Sarvam LLM failed (${res.status}): ${errBody}`);
          if (retryable && attempt < 2) {
            await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
            continue;
          }
          throw lastErr;
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const content = (data.choices?.[0]?.message?.content ?? "").trim();
        console.log(
          `[sarvam-llm] ${config.sarvamLlmModel} ${Date.now() - started}ms chars=${content.length}`
        );
        return isDegenerate(content) ? "" : content;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Sarvam LLM failed");
  }
}
