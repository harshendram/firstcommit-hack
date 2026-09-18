import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { careWsHub } from "./care/ws.js";
import { config } from "./config.js";
import { ensureSchema } from "./db/schema.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { careRouter } from "./routes/care.js";
import { profilesRouter } from "./routes/profiles.js";
import { twilioRouter } from "./routes/twilio.js";
import { usersRouter } from "./routes/users.js";
import { startTunnel } from "./services/tunnel.js";
import { twilioNotifier } from "./services/twilio.js";
import { wsHub } from "./ws/hub.js";

const app = express();
app.use(cors());
// Twilio webhooks are application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "10mb" }));

/** UptimeRobot / load-balancer probes — always 200 when the process is up. */
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "rakshak" });
});

app.use("/api", apiRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/care", careRouter);
app.use("/api/twilio", twilioRouter);

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
    config.escalationMode === "live" && twilioNotifier.ready
      ? `live/${config.escalationChannel}`
      : config.escalationMode === "live"
        ? "live(no-creds→sim)"
        : "simulated";
  const llm = config.llmProvider.padEnd(36);
  console.log(`
╔══════════════════════════════════════════════╗
║  RAKSHAK Orchestrator                        ║
║  HTTP  http://${config.host}:${config.port}              ║
║  WS    ws://${config.host}:${config.port}/ws            ║
║  Care  ws://${config.host}:${config.port}/care          ║
║  LLM   ${llm}║
║  Esc   ${esc.padEnd(36)}║
╚══════════════════════════════════════════════╝
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
    const origin = await startTunnel();
    if (origin && twilioNotifier.ready) {
      await twilioNotifier.syncInboundWebhook(origin);
      console.log(`[twilio] keypad ack ready · ${origin}/api/twilio/voice/ack`);
    }
  })();
});
