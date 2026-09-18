import WebSocket from "ws";

const url = process.argv[2] ?? "ws://localhost:3001/ws";
console.log("connecting", url);

const ws = new WebSocket(url);
ws.on("open", () => {
  console.log("OPEN");
  ws.send(JSON.stringify({ type: "hello", role: "patient" }));
  setTimeout(() => {
    console.log("SEND trigger");
    ws.send(JSON.stringify({ type: "trigger", trigger_type: "simulated_fall" }));
  }, 400);
});
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "session") {
    console.log(
      "SESSION",
      m.session.state,
      "turns",
      m.session.transcript.length,
      m.session.transcript.map((t: { speaker: string; text: string }) => `[${t.speaker}] ${t.text}`).join(" | ")
    );
  } else if (m.type === "tts_audio") {
    console.log("TTS", m.text.slice(0, 80));
  } else if (m.type === "error") {
    console.log("ERROR", m.message);
  } else {
    console.log("MSG", m.type);
  }
});
ws.on("error", (e) => console.log("ERR", e.message));
ws.on("close", (c, r) => console.log("CLOSE", c, r.toString()));
setTimeout(() => {
  ws.close();
  process.exit(0);
}, 4000);
