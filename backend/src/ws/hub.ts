import type { WebSocket, WebSocketServer } from "ws";
import { putTts } from "../care/ttsCache.js";
import { orchestrator } from "../services/orchestrator.js";
import type {
  ClientMessage,
  ClientRole,
  ConversationTurn,
  ServerMessage,
  SessionEvent,
} from "../types.js";

interface ClientMeta {
  role: ClientRole;
}

export class WsHub {
  private clients = new Map<WebSocket, ClientMeta>();
  /** Last emergency TTS — replayed when a watch joins mid-session (late /ws). */
  private lastTts: {
    audio_base64: string;
    mime_type: string;
    text: string;
  } | null = null;

  attach(wss: WebSocketServer): void {
    orchestrator.wire({
      broadcast: (session) => this.broadcastSession(session),
      onTranscriptDelta: (turn) => this.broadcastTranscriptDelta(turn),
      onTts: (payload) => this.broadcastTts(payload),
    });

    wss.on("connection", (socket) => {
      this.clients.set(socket, { role: "dashboard" });
      // Send current session immediately
      this.send(socket, { type: "session", session: orchestrator.getSession() });

      socket.on("message", (raw) => {
        void this.onMessage(socket, raw.toString());
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
      });
    });
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: ServerMessage, filter?: (role: ClientRole) => boolean): void {
    for (const [socket, meta] of this.clients) {
      if (filter && !filter(meta.role)) continue;
      this.send(socket, msg);
    }
  }

  broadcastSession(session: SessionEvent): void {
    if (session.state === "idle") this.lastTts = null;
    this.broadcast({ type: "session", session });
  }

  broadcastTranscriptDelta(turn: ConversationTurn): void {
    const session_id = orchestrator.getSession().session_id;
    this.broadcast({ type: "transcript_delta", turn, session_id });
  }

  /**
   * Watch gets a small `audio_url` (HTTP fetch). Browser patient keeps
   * inline `audio_base64` — huge TTS frames over Mobile Hotspot WS cause
   * "broken pipe" and the watch never hears the greeting.
   */
  broadcastTts(payload: {
    audio_base64: string;
    mime_type: string;
    text: string;
  }): void {
    this.lastTts = payload;
    const id = putTts(payload.audio_base64, payload.mime_type);
    const audioUrl = `/api/care/tts/${id}`;
    const b64Kb = Math.round(payload.audio_base64.length / 1024);
    console.log(
      `[ws] tts_audio text=${payload.text.length}c b64≈${b64Kb}KB → watch=url patient=inline`
    );

    for (const [socket, meta] of this.clients) {
      if (meta.role === "watch") {
        this.send(socket, {
          type: "tts_audio",
          audio_url: audioUrl,
          mime_type: payload.mime_type,
          text: payload.text,
        });
      } else if (meta.role === "patient") {
        this.send(socket, {
          type: "tts_audio",
          audio_base64: payload.audio_base64,
          audio_url: audioUrl,
          mime_type: payload.mime_type,
          text: payload.text,
        });
      }
    }
  }

  /** Push the latest clip to one watch that missed the live broadcast. */
  private replayLastTtsToWatch(socket: WebSocket): void {
    const payload = this.lastTts;
    if (!payload) return;
    const session = orchestrator.getSession();
    if (session.state === "idle" || session.state === "resolved") return;
    const id = putTts(payload.audio_base64, payload.mime_type);
    console.log(`[ws] replaying last TTS to late watch (${payload.text.length}c)`);
    this.send(socket, {
      type: "tts_audio",
      audio_url: `/api/care/tts/${id}`,
      mime_type: payload.mime_type,
      text: payload.text,
    });
  }

  private async onMessage(socket: WebSocket, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(socket, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      switch (msg.type) {
        case "hello": {
          this.clients.set(socket, { role: msg.role });
          this.send(socket, {
            type: "session",
            session: orchestrator.getSession(),
          });
          if (msg.role === "watch") {
            this.replayLastTtsToWatch(socket);
          }
          break;
        }
        case "trigger": {
          await orchestrator.handleTrigger(msg.trigger_type);
          break;
        }
        case "patient_text": {
          await orchestrator.handlePatientText(
            msg.text,
            msg.language
          );
          break;
        }
        case "patient_audio": {
          await orchestrator.handlePatientAudio(
            msg.audio_base64,
            msg.mime_type
          );
          break;
        }
        case "confirm_arrival": {
          await orchestrator.confirmArrival();
          break;
        }
        case "family_on_my_way": {
          await orchestrator.handleFamilyOnMyWay(msg.contact_role ?? "family");
          break;
        }
        case "family_arrived": {
          await orchestrator.handleFamilyArrived();
          break;
        }
        case "reset": {
          this.lastTts = null;
          orchestrator.reset();
          break;
        }
        default:
          this.send(socket, { type: "error", message: "Unknown message type" });
      }
    } catch (err) {
      console.error("[ws] handler error:", err);
      const message = err instanceof Error ? err.message : "Internal error";
      // Surface to the sender and every connected client (command + patient)
      this.broadcast({ type: "error", message });
    }
  }
}

export const wsHub = new WsHub();
