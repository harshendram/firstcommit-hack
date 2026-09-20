/**
 * The contract every reasoning backend implements, plus the offline stand-in.
 *
 * The live implementation is Amazon Bedrock (`bedrock.ts`). This file holds only
 * what both sides share: the tool shapes the agent may call, and a deterministic
 * client used by CI and by rehearsals with no network.
 */

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

export interface CareTurnResult {
  text: string;
  toolCalls: ToolCall[];
  /** Which Bedrock region served the turn — surfaced on the ops dashboard. */
  servedBy?: string;
}

export interface CareLlmClient {
  startSession(): void;
  sendPatientTurn(text: string): Promise<CareTurnResult>;
  sendSystemNote(note: string): Promise<CareTurnResult>;
  reset(): void;
}

export function normalizeSeverity(value: unknown): Severity | null {
  const raw = String(value ?? "").toLowerCase().trim();
  return raw === "low" || raw === "medium" || raw === "high" ? raw : null;
}

/** Keep only what a spoken line should contain — no JSON, no stage directions. */
export function cleanSpoken(raw: string): string {
  let text = raw
    .replace(/```(?:json)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();
  text = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]*/g);
  if (sentences && sentences.length > 2) {
    text = sentences.slice(0, 2).join(" ").trim();
  }
  return text;
}

/**
 * Deterministic reasoning for CI and offline rehearsal. It follows the same
 * escalation rules as the live agent so the acceptance tests mean something.
 */
export class OfflineCareLlmClient implements CareLlmClient {
  private turn = 0;
  private escalated = false;

  startSession(): void {
    this.turn = 0;
    this.escalated = false;
  }

  reset(): void {
    this.startSession();
  }

  async sendPatientTurn(text: string): Promise<CareTurnResult> {
    this.turn += 1;
    const lower = text.toLowerCase();
    const isFall =
      /(fell|fall)/.test(lower) ||
      /(can't|cannot) (get up|stand)/.test(lower);
    const isChest =
      lower.includes("chest") ||
      lower.includes("heart") ||
      /(can't|cannot) breathe/.test(lower);
    const isConfused =
      lower.includes("don't know") ||
      lower.includes("confused") ||
      lower.includes("strange") ||
      lower.includes("where i am");
    // Mild hip/ache alone should NOT escalate.
    const isMild =
      !isFall &&
      !isChest &&
      !isConfused &&
      (/(dizzy|dizziness|okay|fine|a bit|a little|slight)/.test(lower) ||
        (lower.includes("hip") &&
          /(pain|hurt)/.test(lower) &&
          !/(can't|cannot)/.test(lower)));

    if (this.escalated) {
      return {
        text: "I'm still right here with you. Take slow breaths — help is on the way.",
        toolCalls: [],
      };
    }

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

    if (this.turn === 1 && !isFall && !isChest && !isConfused) {
      return {
        text: "I'm here with you. Can you tell me what happened?",
        toolCalls: [
          {
            name: "assess",
            args: { severity: "low", reasoning: "Opening triage, gathering information" },
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
        { name: "assess", args: { severity, reasoning: condition } },
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

  async sendSystemNote(note: string): Promise<CareTurnResult> {
    if (note.includes("greeting")) {
      return { text: "Hello, I'm Rakshak. I'm here with you. Are you alright?", toolCalls: [] };
    }
    if (note.includes("arrival")) {
      return { text: "Your daughter's here now. I'm glad you're okay.", toolCalls: [] };
    }
    if (note.includes("check-in")) {
      return { text: "Still with me? How are you feeling now?", toolCalls: [] };
    }
    return { text: "I'm still here with you.", toolCalls: [] };
  }
}
