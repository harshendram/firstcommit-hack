import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionDeclaration,
  Type,
} from "@google/genai";
import { config, RAKSHAK_SYSTEM_PROMPT } from "../config.js";
import type { EscalationHop, Severity } from "../types.js";

export interface AssessArgs {
  severity: Severity;
  reasoning: string;
}

export interface HandoffArgs {
  patient_name: string;
  age: number;
  location: string;
  condition: string;
  symptoms: string[];
  recommended_action: string;
}

export interface EscalateArgs {
  chain?: EscalationHop[];
}

export type ToolCall =
  | { name: "assess"; args: AssessArgs }
  | { name: "generate_handoff"; args: HandoffArgs }
  | { name: "escalate"; args: EscalateArgs }
  | { name: "stay_and_reassure"; args: Record<string, never> };

export interface GeminiTurnResult {
  text: string;
  toolCalls: ToolCall[];
}

const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "assess",
    description:
      "Call after each patient turn during triage with current severity assessment.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        severity: {
          type: Type.STRING,
          enum: ["low", "medium", "high"],
          description: "Current severity read",
        },
        reasoning: {
          type: Type.STRING,
          description: "Brief clinical reasoning",
        },
      },
      required: ["severity", "reasoning"],
    },
  },
  {
    name: "generate_handoff",
    description:
      "Generate structured emergency handoff when severity is medium or high.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_name: { type: Type.STRING },
        age: { type: Type.NUMBER },
        location: { type: Type.STRING },
        condition: { type: Type.STRING },
        symptoms: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        recommended_action: { type: Type.STRING },
      },
      required: [
        "patient_name",
        "age",
        "location",
        "condition",
        "symptoms",
        "recommended_action",
      ],
    },
  },
  {
    name: "escalate",
    description:
      "Begin the escalation contact chain immediately after generate_handoff.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        chain: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              contact_name: { type: Type.STRING },
              contact_role: {
                type: Type.STRING,
                enum: ["neighbour", "security", "family", "emergency_services"],
              },
              status: {
                type: Type.STRING,
                enum: ["pending", "notified", "acknowledged", "timed_out"],
              },
            },
            required: ["contact_name", "contact_role", "status"],
          },
        },
      },
    },
  },
  {
    name: "stay_and_reassure",
    description:
      "Signal that the AI will continue the conversation during escalation and awaiting handover. Call once after escalate.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

export interface GeminiClient {
  startSession(): void;
  sendPatientTurn(text: string): Promise<GeminiTurnResult>;
  sendSystemNote(note: string): Promise<GeminiTurnResult>;
  reset(): void;
}

function parseToolCalls(parts: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const part of parts) {
    const p = part as {
      functionCall?: { name?: string; args?: Record<string, unknown> };
    };
    const fc = p.functionCall;
    if (!fc?.name) continue;
    const args = (fc.args ?? {}) as Record<string, unknown>;
    switch (fc.name) {
      case "assess":
        calls.push({
          name: "assess",
          args: {
            severity: args.severity as Severity,
            reasoning: String(args.reasoning ?? ""),
          },
        });
        break;
      case "generate_handoff":
        calls.push({
          name: "generate_handoff",
          args: {
            patient_name: String(args.patient_name ?? ""),
            age: Number(args.age ?? 0),
            location: String(args.location ?? ""),
            condition: String(args.condition ?? ""),
            symptoms: Array.isArray(args.symptoms)
              ? (args.symptoms as string[])
              : [],
            recommended_action: String(args.recommended_action ?? ""),
          },
        });
        break;
      case "escalate":
        calls.push({
          name: "escalate",
          args: {
            chain: Array.isArray(args.chain)
              ? (args.chain as EscalationHop[])
              : undefined,
          },
        });
        break;
      case "stay_and_reassure":
        calls.push({ name: "stay_and_reassure", args: {} });
        break;
    }
  }
  return calls;
}

export class LiveGeminiClient implements GeminiClient {
  private ai: GoogleGenAI;
  private chat: ReturnType<GoogleGenAI["chats"]["create"]> | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  startSession(): void {
    this.chat = this.ai.chats.create({
      model: config.geminiModel,
      config: {
        systemInstruction: RAKSHAK_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
        temperature: 0.4,
      },
    });
  }

  reset(): void {
    this.chat = null;
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const delays = [0, 800, 1600, 3200];
    let lastErr: unknown;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]! > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = String(err);
        const retryable =
          msg.includes("503") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED");
        if (!retryable || i === delays.length - 1) throw err;
        console.warn(
          `[gemini] ${label} transient error, retry ${i + 1}/${delays.length - 1}:`,
          msg.slice(0, 160)
        );
      }
    }
    throw lastErr;
  }

  private async send(message: string): Promise<GeminiTurnResult> {
    if (!this.chat) this.startSession();

    const accumulated: ToolCall[] = [];
    let spoken = "";

    let response = await this.withRetry(
      () => this.chat!.sendMessage({ message }),
      "sendMessage"
    );

    for (let round = 0; round < 5; round++) {
      const text = (response.text ?? "").trim();
      if (text) spoken = text;

      const parts = (response.candidates?.[0]?.content?.parts ??
        []) as unknown[];
      const calls = parseToolCalls(parts);

      if (calls.length === 0) break;

      for (const tc of calls) accumulated.push(tc);

      try {
        response = await this.withRetry(
          () =>
            this.chat!.sendMessage({
              message: calls.map((tc) => ({
                functionResponse: {
                  name: tc.name,
                  response: { ok: true, received: tc.args },
                },
              })),
            }),
          "functionResponse"
        );
      } catch (err) {
        console.warn("[gemini] functionResponse follow-up failed:", err);
        break;
      }
    }

    // Prefer latest assess + one of each other tool
    const unique: ToolCall[] = [];
    const seen = new Set<string>();
    let lastAssess: ToolCall | null = null;
    for (const tc of accumulated) {
      if (tc.name === "assess") {
        lastAssess = tc;
        continue;
      }
      if (seen.has(tc.name)) continue;
      seen.add(tc.name);
      unique.push(tc);
    }
    if (lastAssess) unique.unshift(lastAssess);

    if (!spoken && unique.length > 0) {
      spoken =
        "I'm right here with you. Take a slow breath — I'm going to get you help.";
    }

    return { text: spoken, toolCalls: unique };
  }

  sendPatientTurn(text: string): Promise<GeminiTurnResult> {
    return this.send(`Patient said: ${text}`);
  }

  sendSystemNote(note: string): Promise<GeminiTurnResult> {
    return this.send(`[System] ${note}`);
  }
}

/** Deterministic mock for offline / stage-safe demos. */
export class MockGeminiClient implements GeminiClient {
  private turn = 0;
  private escalated = false;

  startSession(): void {
    this.turn = 0;
    this.escalated = false;
  }

  reset(): void {
    this.startSession();
  }

  async sendPatientTurn(text: string): Promise<GeminiTurnResult> {
    this.turn += 1;
    const lower = text.toLowerCase();
    const isFall =
      lower.includes("fell") ||
      lower.includes("fall") ||
      lower.includes("can't get up") ||
      lower.includes("cannot get up") ||
      lower.includes("can't stand") ||
      lower.includes("cannot stand");
    const isChest =
      lower.includes("chest") ||
      lower.includes("heart") ||
      /(can't|cannot) breathe/.test(lower);
    const isConfused =
      lower.includes("don't know") ||
      lower.includes("confused") ||
      lower.includes("strange") ||
      lower.includes("where i am");
    // Mild hip/ache alone should NOT escalate
    const isMild =
      !isFall &&
      !isChest &&
      !isConfused &&
      (lower.includes("dizzy") ||
        lower.includes("dizziness") ||
        lower.includes("okay") ||
        lower.includes("fine") ||
        lower.includes("a bit") ||
        lower.includes("a little") ||
        lower.includes("slight") ||
        (lower.includes("hip") &&
          (lower.includes("pain") || lower.includes("hurt")) &&
          !lower.includes("can't") &&
          !lower.includes("cannot")));

    if (this.escalated) {
      return {
        text: "I'm still right here with you. Take slow breaths — help is on the way.",
        toolCalls: [],
      };
    }

    // Mild path: stay in conversation, no escalation
    if (isMild) {
      return {
        text: "That sounds uncomfortable, but I'm glad you're talking with me. Would you like me to stay on the line a bit longer?",
        toolCalls: [
          {
            name: "assess",
            args: {
              severity: "low",
              reasoning: "Mild symptoms, patient responsive and stable",
            },
          },
        ],
      };
    }

    // Opening turn with no clear severity signal yet
    if (this.turn === 1 && !isFall && !isChest && !isConfused) {
      return {
        text: "I'm here with you. Can you tell me what happened?",
        toolCalls: [
          {
            name: "assess",
            args: {
              severity: "low",
              reasoning: "Opening triage, gathering information",
            },
          },
        ],
      };
    }

    const severity: Severity = isChest || isFall || isConfused ? "high" : "medium";
    const condition = isChest
      ? "possible cardiac event — chest pain / breathing difficulty"
      : isFall
        ? "possible hip fracture after fall — unable to stand"
        : isConfused
          ? "acute confusion / altered mental status"
          : "acute distress, needs immediate family attention";

    this.escalated = true;
    return {
      text: "Security has been informed and a text message has gone to your daughter — is that okay? I'm going to stay right here with you.",
      toolCalls: [
        {
          name: "assess",
          args: {
            severity,
            reasoning: condition,
          },
        },
        {
          name: "generate_handoff",
          args: {
            patient_name: "Lakshmi Devi",
            age: 72,
            location: "Flat 3B, Brigade Residency, Bengaluru",
            condition,
            symptoms: isFall
              ? ["fall", "unable to stand", "hip pain"]
              : isChest
                ? ["chest pain", "shortness of breath"]
                : isConfused
                  ? ["confusion", "disorientation"]
                  : ["distress"],
            recommended_action: isChest
              ? "Urgent medical evaluation; do not leave patient alone"
              : "Family/EMS assist; check for fracture; keep patient still",
          },
        },
        { name: "escalate", args: {} },
        { name: "stay_and_reassure", args: {} },
      ],
    };
  }

  async sendSystemNote(note: string): Promise<GeminiTurnResult> {
    if (note.includes("greeting")) {
      return {
        text: "Hello, I'm Rakshak. I'm here with you. Are you alright?",
        toolCalls: [],
      };
    }
    if (note.includes("arrival")) {
      return {
        text: "Your daughter's here now. I'm glad you're okay.",
        toolCalls: [],
      };
    }
    if (note.includes("check-in")) {
      return {
        text: "Still with me? How are you feeling now?",
        toolCalls: [],
      };
    }
    return { text: "I'm still here with you.", toolCalls: [] };
  }
}

export function createGeminiClient(): GeminiClient {
  if (config.llmProvider === "mock") {
    console.log("[llm] Using MockGeminiClient (LLM_PROVIDER=mock)");
    return new MockGeminiClient();
  }
  if (config.llmProvider === "sarvam") {
    throw new Error(
      "Use createLlmClient() from llm.ts for Sarvam — createGeminiClient is Gemini/mock only"
    );
  }
  if (!config.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is required when LLM_PROVIDER=gemini."
    );
  }
  console.log(`[llm] GEMINI · model=${config.geminiModel}`);
  return new LiveGeminiClient();
}
