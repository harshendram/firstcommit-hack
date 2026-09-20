/**
 * Reasoning on Amazon Bedrock — Amazon Nova through the Converse API.
 *
 * Converse gives one request shape across every Bedrock model and, more usefully
 * here, first-class tool use: the agent calls `assess` / `generate_handoff` /
 * `escalate` / `stay_and_reassure` and we read structured arguments instead of
 * parsing prose. The orchestrator then decides what actually happens — the model
 * never places a call by itself.
 *
 * Availability:
 *   - Nova is served through a cross-region inference profile, so a single model
 *     id is already spread over several regions by Bedrock itself.
 *   - On top of that, `withFailover` retries the whole turn against a second
 *     region when the primary answers with a throttle or a 5xx.
 *   - A circuit breaker stops a dead region from adding latency to every turn.
 */

import {
  type ContentBlock,
  ConverseCommand,
  type Message,
  type Tool,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { bedrock, bedrockFailover } from "../aws/clients.js";
import { breaker, withFailover } from "../aws/resilience.js";
import { config, RAKSHAK_SYSTEM_PROMPT } from "../config.js";
import type { EscalationHop, Severity } from "../types.js";
import {
  type CareLlmClient,
  type CareTurnResult,
  cleanSpoken,
  type ToolCall,
} from "./careLlm.js";

const TOOLS: Tool[] = [
  {
    toolSpec: {
      name: "assess",
      description:
        "Call after each patient turn during triage with the current severity read.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Current severity read",
            },
            reasoning: { type: "string", description: "Brief clinical reasoning" },
          },
          required: ["severity", "reasoning"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "generate_handoff",
      description:
        "Produce the structured emergency handoff when severity is medium or high.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            patient_name: { type: "string" },
            age: { type: "number" },
            location: { type: "string" },
            condition: { type: "string" },
            symptoms: { type: "array", items: { type: "string" } },
            recommended_action: { type: "string" },
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
    },
  },
  {
    toolSpec: {
      name: "escalate",
      description: "Begin the escalation contact chain, immediately after generate_handoff.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            chain: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  contact_name: { type: "string" },
                  contact_role: {
                    type: "string",
                    enum: ["neighbour", "security", "family", "emergency_services"],
                  },
                  status: {
                    type: "string",
                    enum: ["pending", "notified", "acknowledged", "timed_out"],
                  },
                },
                required: ["contact_name", "contact_role", "status"],
              },
            },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: "stay_and_reassure",
      description:
        "Signal that the agent keeps the conversation going while help is on the way. Call once, after escalate.",
      inputSchema: { json: { type: "object", properties: {} } },
    },
  },
];

const TOOL_CONFIG: ToolConfiguration = { tools: TOOLS };

function parseToolCalls(blocks: ContentBlock[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const block of blocks) {
    const use = block.toolUse;
    if (!use?.name) continue;
    const args = (use.input ?? {}) as Record<string, unknown>;
    switch (use.name) {
      case "assess":
        calls.push({
          name: "assess",
          args: {
            severity: String(args.severity ?? "low").toLowerCase() as Severity,
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
              ? (args.symptoms as unknown[]).map(String).filter(Boolean)
              : [],
            recommended_action: String(args.recommended_action ?? ""),
          },
        });
        break;
      case "escalate":
        calls.push({
          name: "escalate",
          args: {
            chain: Array.isArray(args.chain) ? (args.chain as EscalationHop[]) : undefined,
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

function spokenText(blocks: ContentBlock[]): string {
  return cleanSpoken(
    blocks
      .map((b) => b.text ?? "")
      .join(" ")
      .trim()
  );
}

export class BedrockCareLlmClient implements CareLlmClient {
  private messages: Message[] = [];

  startSession(): void {
    this.messages = [];
  }

  reset(): void {
    this.messages = [];
  }

  async sendPatientTurn(text: string): Promise<CareTurnResult> {
    return this.turn(text, false);
  }

  async sendSystemNote(note: string): Promise<CareTurnResult> {
    return this.turn(
      `[SYSTEM NOTE — not spoken by the patient]\n${note}`,
      note.startsWith("greeting:")
    );
  }

  private async turn(userText: string, isGreeting: boolean): Promise<CareTurnResult> {
    this.messages.push({ role: "user", content: [{ text: userText }] });
    this.trimHistory();

    const started = Date.now();
    const send = (client: ReturnType<typeof bedrock>) =>
      client.send(
        new ConverseCommand({
          modelId: config.aws.bedrockModelId,
          system: [{ text: RAKSHAK_SYSTEM_PROMPT }],
          messages: this.messages,
          toolConfig: TOOL_CONFIG,
          inferenceConfig: {
            maxTokens: config.aws.bedrockMaxTokens,
            temperature: 0.3,
          },
        })
      );

    const { result, failedOver } = await breaker("bedrock", {
      threshold: 4,
      cooldownMs: 20_000,
    }).run(() =>
      withFailover(
        "bedrock.converse",
        () => send(bedrock()),
        () => send(bedrockFailover())
      )
    );

    const blocks = result.output?.message?.content ?? [];
    const toolCalls = parseToolCalls(blocks);
    let text = spokenText(blocks);

    // A turn that is nothing but tool calls leaves the patient in silence.
    if (!text) text = await this.askForASpokenLine();

    const servedBy = failedOver
      ? config.aws.bedrockFailoverRegion
      : config.aws.bedrockRegion;
    console.log(
      `[bedrock] ${config.aws.bedrockModelId} ${Date.now() - started}ms region=${servedBy}` +
        ` tools=${toolCalls.map((c) => c.name).join(",") || "none"}` +
        ` in=${result.usage?.inputTokens ?? "?"} out=${result.usage?.outputTokens ?? "?"}`
    );

    if (blocks.length > 0) {
      this.messages.push({ role: "assistant", content: blocks });
      // Converse requires every toolUse to be answered before the next user turn.
      const results: ContentBlock[] = blocks
        .filter((b) => b.toolUse?.toolUseId)
        .map((b) => ({
          toolResult: {
            toolUseId: b.toolUse!.toolUseId!,
            content: [{ json: { accepted: true } }],
            status: "success" as const,
          },
        }));
      if (results.length > 0) this.messages.push({ role: "user", content: results });
    }
    this.trimHistory();

    if (isGreeting && toolCalls.some((c) => c.name === "escalate")) {
      // Nothing has been said yet, so there is nothing to escalate about.
      return { text, toolCalls: toolCalls.filter((c) => c.name === "assess"), servedBy };
    }
    return { text, toolCalls, servedBy };
  }

  /** Last resort: one bare sentence, no tools, so the patient hears a human voice. */
  private async askForASpokenLine(): Promise<string> {
    const send = (client: ReturnType<typeof bedrock>) =>
      client.send(
        new ConverseCommand({
          modelId: config.aws.bedrockModelId,
          system: [{ text: RAKSHAK_SYSTEM_PROMPT }],
          messages: [
            ...this.messages,
            {
              role: "user",
              content: [
                {
                  text: "Say ONE short caring sentence to the patient now. Plain text only, no tools.",
                },
              ],
            },
          ],
          inferenceConfig: { maxTokens: 120, temperature: 0.3 },
        })
      );

    try {
      const { result } = await withFailover(
        "bedrock.retry",
        () => send(bedrock()),
        () => send(bedrockFailover())
      );
      const text = spokenText(result.output?.message?.content ?? []);
      if (text) return text;
    } catch (err) {
      console.warn("[bedrock] spoken-line retry failed:", err instanceof Error ? err.message : err);
    }
    return "I'm right here with you. Can you tell me how you're feeling?";
  }

  /** Keep a rolling window; the system prompt is passed separately every turn. */
  private trimHistory(): void {
    const MAX_MESSAGES = 24;
    if (this.messages.length <= MAX_MESSAGES) return;
    let cut = this.messages.length - MAX_MESSAGES;
    // Never start the window on an assistant turn or an orphaned toolResult.
    while (cut < this.messages.length && this.messages[cut].role !== "user") cut += 1;
    while (
      cut < this.messages.length &&
      this.messages[cut].content?.some((b) => b.toolResult)
    ) {
      cut += 1;
    }
    this.messages = this.messages.slice(cut);
  }
}
