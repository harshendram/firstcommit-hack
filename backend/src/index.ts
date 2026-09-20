import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { awsSummary } from "./aws/clients.js";
import { breakerStates } from "./aws/resilience.js";
import { careWsHub } from "./care/ws.js";
import { config } from "./config.js";
import { ensureSchema } from "./db/schema.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { careRouter } from "./routes/care.js";
import { notificationsRouter } from "./routes/notifications.js";
import { profilesRouter } from "./routes/profiles.js";
import { usersRouter } from "./routes/users.js";
import { notifier } from "./services/notifications.js";
import { wsHub } from "./ws/hub.js";

const app = express();
app.use(cors());
// Amazon Connect contact flows post JSON; SNS posts JSON with a text/plain type.
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "10mb", type: ["application/json", "text/plain"] }));

/**
 * Liveness. Always 200 while the process is up — this is what the Application
 * Load Balancer target group and the Route 53 health check poll, and it must not
 * fail because a downstream dependency is having a moment.
 */
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "rakshak", region: config.aws.region });
});

/**
 * Readiness. Reports each AWS dependency's circuit-breaker state so a degraded
 * service is visible on the dashboard rather than inferred from failed turns.
 * Still 200 when a breaker is open: the app degrades, it does not fall over.
 */
app.get("/health/deep", (_req, res) => {
  const breakers = breakerStates();
  res.status(200).json({
    ok: true,
    service: "rakshak",
    region: config.aws.region,
    model: config.aws.bedrockModelId,
    voice: {
      stt: "amazon-transcribe",
      tts: `amazon-polly:${config.aws.pollyVoice}:${config.aws.pollyEngine}`,
    },
    escalation: {
      mode: config.escalationMode,
      channel: config.escalationChannel,
      voiceReady: notifier.voiceReady,
      smsReady: config.aws.smsEnabled,
    },
    breakers,
    degraded: Object.entries(breakers)
      .filter(([, state]) => state !== "closed")
      .map(([name]) => name),
  });
});

app.use("/api", apiRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/care", careRouter);
app.use("/api/notifications", notificationsRouter);

const server = createServer(app);

// Two path-scoped WebSocketServers on the same `server` conflict: each attaches
// an `upgrade` listener, and a non-matching path aborts with HTTP 400 before the
// correct server can handle it. Route upgrades manually instead.
const wss = new WebSocketServer({ noServer: true });
wsHub.attach(wss);

const careWss = new WebSocketServer({ noServer: true });
careWsHub.attach(careWss);

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (pathname === "/care") {
    careWss.handleUpgrade(req, socket, head, (ws) => {
      careWss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

server.listen(config.port, config.host, () => {
  const esc =
    config.escalationMode === "live" && notifier.ready
      ? `live/${config.escalationChannel}`
      : config.escalationMode === "live"
        ? "live(no-channel→sim)"
        : "simulated";
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  RAKSHAK Orchestrator                                    ║
║  HTTP  http://${config.host}:${config.port}${" ".repeat(26)}║
║  WS    ws://${config.host}:${config.port}/ws${" ".repeat(25)}║
║  Care  ws://${config.host}:${config.port}/care${" ".repeat(23)}║
║  AWS   ${awsSummary().padEnd(50)}║
║  LLM   ${`bedrock:${config.aws.bedrockModelId}`.slice(0, 50).padEnd(50)}║
║  Voice ${`transcribe + polly:${config.aws.pollyVoice}`.padEnd(50)}║
║  Esc   ${esc.padEnd(50)}║
╚══════════════════════════════════════════════════════════╝
`);

  void (async () => {
    try {
      await ensureSchema();
    } catch (err) {
      console.error(
        "[db] schema init failed:",
        err instanceof Error ? err.message : err
      );
    }
    if (config.publicApiUrl) {
      console.log(
        `[connect] contact-flow callback → ${config.publicApiUrl}/api/notifications/voice/ack`
      );
    } else {
      console.warn(
        "[connect] PUBLIC_API_URL unset — the contact flow cannot reach this API for 'press 1'. " +
          "The Family PWA button still acknowledges."
      );
    }
  })();
});
