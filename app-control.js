const params = new URLSearchParams(location.search);
const room = params.get("room") || "default";

const BROKER = "wss://test.mosquitto.org:8081/mqtt";

const TOPIC_MSG = `speaker/messages/${room}`;
const TOPIC_ACK = `speaker/ack/${room}`;
const TOPIC_NOTES = `speaker/notes/${room}`;
const TOPIC_NOTES_ALERT = `speaker/notesAlert/${room}`;
const TOPIC_COUNTDOWN = `speaker/countdown/${room}`;
const TOPIC_ALERT = `speaker/alert/${room}`;
const TOPIC_STATE = `speaker/state/${room}`;
const TOPIC_RESET = `speaker/reset/${room}`;

const client = mqtt.connect(BROKER, {
  clientId: "control_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 800,
  keepalive: 30
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

// PREVIEW
const pClock = document.getElementById("pClock");
const pCountdown = document.getElementById("pCountdown");
const pMainMsg = document.getElementById("pMainMsg");
const pNotesText = document.getElementById("pNotesText");

// STATUS
const statusEl = document.getElementById("status");
const displayStateEl = document.getElementById("displayState");

let lastNotesText = "Sem notas.";

// IDs para reduzir duplicados (ajuda muito com reconnect/QoS)
function uid(){
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// HISTÓRICO
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

// MQTT
client.on("connect", () => {
  statusEl.textContent = `Ligado (room: ${room})`;
  client.subscribe(TOPIC_ACK, { qos: 0 });
  client.subscribe(TOPIC_STATE, { qos: 0 });
});

client.on("reconnect", () => statusEl.textContent = "A reconectar…");
client.on("close", () => statusEl.textContent = "Ligação perdida…");
client.on("offline", () => statusEl.textContent = "Servidor offline…");
client.on("error", () => statusEl.textContent = "Erro de ligação ao servidor.");

// RECEBER ESTADO DO DISPLAY
client.on("message", (topic, payload) => {
  let data;
  try { data = JSON.parse(payload.toString()); } catch { return; }

  if (topic === TOPIC_ACK) {
    if (data.status === "online") displayStateEl.textContent = "Display online.";
    if (data.status === "received") displayStateEl.textContent = `Entregue: "${data.text}"`;
  }

  if (topic === TOPIC_STATE) {
    pClock.textContent = data.clock || "--:--:--";
    pCountdown.textContent = data.countdown || "--:--";
    pMainMsg.textContent = data.mainMsg || "Aguardando…";
    pNotesText.textContent = data.notes || "Sem notas.";
  }
});

// PREVIEW INSTANTÂNEA
function updatePreviewInstant(mainMsg, notes, countdown) {
  if (mainMsg !== undefined) pMainMsg.textContent = mainMsg;
  if (notes !== undefined) pNotesText.textContent = notes;
  if (countdown !== undefined) pCountdown.textContent = countdown;
}

// MENSAGEM PRINCIPAL
sendBtn.addEventListener("click", () => sendMainMessage(msgInput.value));
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter") sendMainMessage(msgInput.value);
});

function sendMainMessage(text) {
  text = (text || "").trim();
  if (!text) return;

  client.publish(TOPIC_MSG, JSON.stringify({ id: uid(), text }), { qos: 0 });
  addToHistory(text);
  updatePreviewInstant(text);
  msgInput.value = "";
}

// NOTAS
sendNotesBtn.addEventListener("click", () => sendNotes(notesInput.value.trim()));
notesInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendNotes(notesInput.value.trim());
  }
});

function sendNotes(text) {
  text = (text || "").trim();
  if (!text) text = "Sem notas.";

  lastNotesText = text;
  client.publish(TOPIC_NOTES, JSON.stringify({ id: uid(), text }), { qos: 0 });
  addToNotesHistory(text);
  updatePreviewInstant(undefined, text);
  notesInput.value = "";
}

// ALERTA NOTAS (pisca e mantém texto)
alertNotesBtn.addEventListener("click", () => {
  client.publish(TOPIC_NOTES_ALERT, JSON.stringify({ id: uid(), action: "alertNotes" }), { qos: 0 });
});

// ALERTA GERAL (pisca vermelho na área da mensagem)
alertBtn.addEventListener("click", () => {
  client.publish(TOPIC_ALERT, JSON.stringify({ id: uid(), action: "alert" }), { qos: 0 });
});

// COUNTDOWN
btnSetCountdown.addEventListener("click", () => {
  const minutes = parseInt(countdownInput.value, 10);
  if (isNaN(minutes) || minutes < 0) return;

  const seconds = minutes * 60;
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "set", seconds }), { qos: 0 });

  const m = String(minutes).padStart(2, "0");
  updatePreviewInstant(undefined, undefined, `${m}:00`);
});

btnStartCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "start" }), { qos: 0 });
});

btnStopCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "stop" }), { qos: 0 });
});

btnResetCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "reset" }), { qos: 0 });
  updatePreviewInstant(undefined, undefined, "--:--");
});

// RESET TOTAL
resetAllBtn.addEventListener("click", () => {
  client.publish(TOPIC_RESET, JSON.stringify({ id: uid(), action: "resetAll" }), { qos: 0 });

  // preview imediato no control
  updatePreviewInstant("Aguardando…", "Sem notas.", "--:--");
});
