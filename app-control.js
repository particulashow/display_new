const params = new URLSearchParams(location.search);
const room = params.get("room") || "default";

if (!window.mqtt) {
  const el = document.getElementById("status");
  if (el) el.textContent = "MQTT.js não carregou. Verifica o script CDN.";
  throw new Error("MQTT.js não carregou");
}

// Broker MQTT via WebSocket seguro
const BROKER = "wss://broker.emqx.io:8084/mqtt";

const TOPIC_MSG         = `speaker/messages/${room}`;
const TOPIC_ACK         = `speaker/ack/${room}`;
const TOPIC_NOTES       = `speaker/notes/${room}`;
const TOPIC_NOTES_ALERT = `speaker/notesAlert/${room}`;
const TOPIC_COUNTDOWN   = `speaker/countdown/${room}`;
const TOPIC_ALERT       = `speaker/alert/${room}`;
const TOPIC_STATE       = `speaker/state/${room}`;
const TOPIC_RESET       = `speaker/reset/${room}`;

const client = mqtt.connect(BROKER, {
  clientId: "control_" + Date.now() + "_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 2500,
  keepalive: 30,
  resubscribe: true,
  connectTimeout: 8000
});

// ELEMENTOS
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const alertBtn = document.getElementById("alertBtn");
const resetAllBtn = document.getElementById("resetAllBtn");

const alertNotesBtn = document.getElementById("alertNotesBtn");
const notesInput = document.getElementById("notesInput");
const sendNotesBtn = document.getElementById("sendNotesBtn");

const historyEl = document.getElementById("history");
const notesHistoryEl = document.getElementById("notesHistory");

const countdownInput = document.getElementById("countdownInput");
const btnSetCountdown = document.getElementById("btnSetCountdown");
const btnStartCountdown = document.getElementById("btnStartCountdown");
const btnStopCountdown = document.getElementById("btnStopCountdown");
const btnResetCountdown = document.getElementById("btnResetCountdown");

const pClock = document.getElementById("pClock");
const pCountdown = document.getElementById("pCountdown");
const pMainMsg = document.getElementById("pMainMsg");
const pNotesText = document.getElementById("pNotesText");

const pCenter = document.getElementById("pCenter");
const pRight = document.getElementById("pRight");

const statusEl = document.getElementById("status");
const displayStateEl = document.getElementById("displayState");
const lastSyncEl = document.getElementById("lastSync");

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stampSync() {
  lastSyncEl.textContent = `Última sync: ${new Date().toLocaleTimeString("pt-PT")}`;
}

function nowPT() {
  return new Date().toLocaleTimeString("pt-PT");
}

// Preview: alarmes
function previewMsgAlert() {
  pCenter.classList.remove("p-msg-blink");
  void pCenter.offsetWidth;
  pCenter.classList.add("p-msg-blink");
  setTimeout(() => pCenter.classList.remove("p-msg-blink"), 3100);
}

function previewNotesAlert() {
  pRight.classList.remove("p-notes-blink");
  void pRight.offsetWidth;
  pRight.classList.add("p-notes-blink");
  setTimeout(() => pRight.classList.remove("p-notes-blink"), 3100);
}

// Históricos
function addToHistory(text) {
  const div = document.createElement("div");
  div.className = "history-item";
  div.textContent = text;
  div.onclick = () => sendMainMessage(text);
  historyEl.prepend(div);
}

function addToNotesHistory(text) {
  const div = document.createElement("div");
  div.className = "history-item";
  div.textContent = text;
  div.onclick = () => sendNotes(text);
  notesHistoryEl.prepend(div);
}

// Countdown preview local
let previewEndAt = null;
let previewRunning = false;

function renderPreviewCountdown() {
  if (!previewEndAt) {
    pCountdown.textContent = "--:--";
    return;
  }

  const ms = previewEndAt - Date.now();
  const secs = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;

  pCountdown.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  if (secs <= 0) previewRunning = false;
}

// preview local: relógio + countdown
setInterval(() => {
  pClock.textContent = nowPT();

  if (previewRunning) {
    renderPreviewCountdown();
  }
}, 250);

// Anti-backlog
let lastStateTs = 0;

function shouldAcceptState(ts) {
  if (!Number.isFinite(ts)) return true;

  if (ts < lastStateTs - 3000) return false;
  if (ts >= lastStateTs) lastStateTs = ts;

  return true;
}

// MQTT
client.on("connect", () => {
  statusEl.textContent = `Ligado (room: ${room})`;

  client.subscribe(TOPIC_ACK, { qos: 1 });
  client.subscribe(TOPIC_STATE, { qos: 1 });
  client.subscribe(TOPIC_ALERT, { qos: 1 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 1 });
  client.subscribe(TOPIC_COUNTDOWN, { qos: 1 });
  client.subscribe(TOPIC_MSG, { qos: 1 });
  client.subscribe(TOPIC_NOTES, { qos: 1 });

  stampSync();
});

client.on("reconnect", () => {
  statusEl.textContent = "A reconectar…";
});

client.on("close", () => {
  statusEl.textContent = "Ligação perdida…";
});

client.on("offline", () => {
  statusEl.textContent = "Servidor offline…";
});

client.on("error", (err) => {
  statusEl.textContent = "Erro MQTT: " + (err?.message || err);
  console.error("MQTT error:", err);
});

// Receber
client.on("message", (topic, payload) => {
  let data;

  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }

  if (topic === TOPIC_ACK) {
    if (data.status === "online") {
      displayStateEl.textContent = "Display online.";
    }

    stampSync();
    return;
  }

  if (topic === TOPIC_STATE) {
    if (!shouldAcceptState(data.ts)) return;

    if (data.clock) pClock.textContent = data.clock;
    if (typeof data.mainMsg === "string") pMainMsg.textContent = data.mainMsg;
    if (typeof data.notes === "string") pNotesText.textContent = data.notes;

    if (Number.isFinite(Number(data.countdownEndAt))) {
      previewEndAt = Number(data.countdownEndAt);
      previewRunning = !!data.countdownRunning;
      renderPreviewCountdown();
    } else if (typeof data.countdown === "string") {
      pCountdown.textContent = data.countdown;
    } else {
      previewEndAt = null;
      previewRunning = false;
      pCountdown.textContent = "--:--";
    }

    stampSync();
    return;
  }

  if (topic === TOPIC_MSG) {
    if (typeof data.text === "string") pMainMsg.textContent = data.text;
    previewMsgAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_NOTES) {
    if (typeof data.text === "string") pNotesText.textContent = data.text || "Sem notas.";
    previewNotesAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_ALERT) {
    previewMsgAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_NOTES_ALERT) {
    previewNotesAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_COUNTDOWN) {
    if (data.action === "set") {
      if (Number.isFinite(Number(data.endAt))) {
        previewEndAt = Number(data.endAt);
      } else if (Number.isFinite(Number(data.seconds))) {
        previewEndAt = Date.now() + Number(data.seconds) * 1000;
      }

      previewRunning = false;
      renderPreviewCountdown();
      stampSync();
      return;
    }

    if (data.action === "start") {
      previewRunning = true;
      stampSync();
      return;
    }

    if (data.action === "stop") {
      previewRunning = false;
      stampSync();
      return;
    }

    if (data.action === "reset") {
      previewEndAt = null;
      previewRunning = false;
      pCountdown.textContent = "--:--";
      stampSync();
    }
  }
});

// Enviar
sendBtn.addEventListener("click", () => sendMainMessage(msgInput.value));

msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter") sendMainMessage(msgInput.value);
});

function sendMainMessage(text) {
  text = (text || "").trim();
  if (!text) return;

  client.publish(TOPIC_MSG, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    text
  }), { qos: 1, retain: false });

  addToHistory(text);

  pMainMsg.textContent = text;
  previewMsgAlert();
  msgInput.value = "";
}

sendNotesBtn.addEventListener("click", () => sendNotes(notesInput.value));

notesInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendNotes(notesInput.value);
  }
});

function sendNotes(text) {
  text = (text || "").trim();
  if (!text) text = "Sem notas.";

  client.publish(TOPIC_NOTES, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    text
  }), { qos: 1, retain: false });

  addToNotesHistory(text);

  pNotesText.textContent = text;
  previewNotesAlert();
  notesInput.value = "";
}

alertNotesBtn.addEventListener("click", () => {
  client.publish(TOPIC_NOTES_ALERT, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "alertNotes"
  }), { qos: 1, retain: false });

  previewNotesAlert();
});

alertBtn.addEventListener("click", () => {
  client.publish(TOPIC_ALERT, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "alert"
  }), { qos: 1, retain: false });

  previewMsgAlert();
});

// Countdown
btnSetCountdown.addEventListener("click", () => {
  const minutes = parseInt(countdownInput.value, 10);
  if (isNaN(minutes) || minutes < 0) return;

  const seconds = minutes * 60;
  const endAt = Date.now() + seconds * 1000;

  client.publish(TOPIC_COUNTDOWN, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "set",
    endAt,
    seconds
  }), { qos: 1, retain: false });

  previewEndAt = endAt;
  previewRunning = false;
  renderPreviewCountdown();
});

btnStartCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "start"
  }), { qos: 1, retain: false });

  previewRunning = true;
});

btnStopCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "stop"
  }), { qos: 1, retain: false });

  previewRunning = false;
});

btnResetCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "reset"
  }), { qos: 1, retain: false });

  previewEndAt = null;
  previewRunning = false;
  pCountdown.textContent = "--:--";
});

resetAllBtn.addEventListener("click", () => {
  client.publish(TOPIC_RESET, JSON.stringify({
    id: uid(),
    ts: Date.now(),
    action: "resetAll"
  }), { qos: 1, retain: false });

  pMainMsg.textContent = "Aguardando…";
  pNotesText.textContent = "Sem notas.";
  previewEndAt = null;
  previewRunning = false;
  pCountdown.textContent = "--:--";
});
