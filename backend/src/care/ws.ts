import type { WebSocket, WebSocketServer } from "ws";
import { listMonitorCards } from "./monitor.js";
import { careOrchestrator } from "./orchestrator.js";
import { putTts } from "./ttsCache.js";
import type { CareClientMessage, CareServerMessage } from "./types.js";

type Role = "patient" | "doctor" | "watch";

export class CareWsHub {
  private clients = new Map<WebSocket, Role>();

  attach(wss: WebSocketServer): void {
    careOrchestrator.wire({
      onSession: (session) => this.broadcast({ type: "care_session", session }),
      onTurn: (turn) => this.broadcast({ type: "care_turn", turn }),
      onDoctorView: (view) => {
        this.broadcast({ type: "care_doctor", view });
        void this.broadcastRoster();
      },
      onTts: (payload) => this.broadcastTts(payload),
      onError: (message) => this.broadcast({ type: "care_error", message }),
    });

    wss.on("connection", (socket) => {
      this.clients.set(socket, "doctor");
      void this.hydrate(socket);

      socket.on("message", (raw) => {
        void this.onMessage(socket, raw.toString());
      });
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => {
        this.clients.delete(socket);
        try {
          socket.terminate();
        } catch {
          /* ignore */
        }
      });
    });
  }

  private async hydrate(socket: WebSocket): Promise<void> {
    this.send(socket, {
      type: "care_session",
      session: careOrchestrator.getSession(),
    });
    this.send(socket, {
      type: "care_doctor",
      view: careOrchestrator.getDoctorView(),
    });
    try {
      const patients = await listMonitorCards();
      this.send(socket, { type: "care_roster", patients });
    } catch (err) {
      console.warn("[care-ws] roster hydrate failed:", err);
    }
  }

  private async broadcastRoster(): Promise<void> {
    try {
      const patients = await listMonitorCards();
      this.broadcast({ type: "care_roster", patients });
    } catch (err) {
      console.warn("[care-ws] roster broadcast failed:", err);
    }
  }

  private send(socket: WebSocket, msg: CareServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      console.warn(
        "[care-ws] send failed:",
        err instanceof Error ? err.message : err
      );
      this.clients.delete(socket);
      try {
        socket.terminate();
      } catch {
        /* ignore */
      }
    }
  }

  private broadcast(
    msg: CareServerMessage,
    filter?: (role: Role) => boolean
  ): void {
    for (const [socket, role] of this.clients) {
      if (filter && !filter(role)) continue;
      this.send(socket, msg);
    }
  }

  /**
   * Watch gets a small `audio_url` (HTTP fetch). Browser patient keeps
   * inline `audio_base64` so the web app needs no change.
   * Huge base64 over Mobile Hotspot WS is a common "broken pipe" trigger.
   */
  private broadcastTts(payload: {
    audio_base64: string;
    mime_type: string;
    text: string;
  }): void {
    const id = putTts(payload.audio_base64, payload.mime_type);
    const audioUrl = `/api/care/tts/${id}`;
    const b64Kb = Math.round(payload.audio_base64.length / 1024);
    console.log(
      `[care-ws] care_tts text=${payload.text.length}c b64≈${b64Kb}KB → watch=url patient=inline`
    );

    for (const [socket, role] of this.clients) {
      if (role === "watch") {
        this.send(socket, {
          type: "care_tts",
          audio_url: audioUrl,
          mime_type: payload.mime_type,
          text: payload.text,
        });
      } else if (role === "patient") {
        this.send(socket, {
          type: "care_tts",
          audio_base64: payload.audio_base64,
          audio_url: audioUrl,
          mime_type: payload.mime_type,
          text: payload.text,
        });
      }
    }
  }

  private async onMessage(socket: WebSocket, raw: string): Promise<void> {
    let msg: CareClientMessage;
    try {
      msg = JSON.parse(raw) as CareClientMessage;
    } catch {
      this.send(socket, { type: "care_error", message: "Invalid JSON" });
      return;
    }

    try {
      switch (msg.type) {
        case "hello":
          this.clients.set(socket, msg.role);
          this.hydrate(socket);
          break;
        case "start_checkin":
          await careOrchestrator.startCheckIn({
            name: msg.name,
            email: msg.email,
            userId: msg.userId,
            username: msg.username,
            demo: msg.demo,
          });
          break;
        case "patient_text":
          await careOrchestrator.handlePatientText(msg.text, msg.language);
          break;
        case "patient_audio":
          console.log(
            `[care-ws] patient_audio ≈${Math.round((msg.audio_base64?.length ?? 0) / 1024)}KB`
          );
          await careOrchestrator.handlePatientAudio(
            msg.audio_base64,
            msg.mime_type ?? "audio/wav"
          );
          break;
        case "watch_vitals":
          careOrchestrator.setLiveVitals({
            resting_hr: msg.resting_hr,
            spo2: msg.spo2,
            steps: msg.steps,
            activity_index: msg.activity_index,
          });
          break;
        case "finish_checkin":
          await careOrchestrator.finishNow();
          break;
        case "reset":
          careOrchestrator.resetAll();
          break;
        default:
          this.send(socket, {
            type: "care_error",
            message: "Unknown message type",
          });
      }
    } catch (err) {
      console.error("[care-ws] handler error:", err);
      this.broadcast({
        type: "care_error",
        message: err instanceof Error ? err.message : "Internal error",
      });
    }
  }
}

export const careWsHub = new CareWsHub();
