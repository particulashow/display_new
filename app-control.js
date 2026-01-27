const params = new URLSearchParams(location.search);
const room = params.get("room") || "default";

const BROKER = "wss://test.mosquitto.org:8081/mqtt";

const TOPIC_MSG         = `speaker/messages/${room}`;
const TOPIC_ACK         = `speaker/ack/${room}`;
const TOPIC_NOTES       = `speaker/notes/${room}`;
const TOPIC_NOTES_ALERT = `speaker/notesAlert/${room}`;
const TOPIC_COUNTDOWN   = `speaker/countdown/${room}`;
const TOPIC_ALERT       = `speaker/alert/${room}`;
const TOPIC_STATE       = `speaker/state/${room}`;
const TOPIC_RESET       = `speaker/reset/${room}`;

const client = mqtt.connect(BROKER, {
  clientId: "control_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 500,
  keepalive: 30
});

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

function uid(){
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stampSync(){
  const t = new Date().toLocaleTimeString("pt-PT");
  lastSyncEl.textContent = `Última sync: ${t}`;
}

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

function updatePreviewInstant(mainMsg, notes, countdown) {
  if (mainMsg !== undefined) pMainMsg.textContent = mainMsg;
  if (notes !== undefined) pNotesText.textContent = notes;
  if (countdown !== undefined) pCountdown.textContent = countdown;
}

function previewMsgAlert(){
  pCenter.classList.remove("p-msg-blink");
  void pCenter.offsetWidth;
  pCenter.classList.add("p-msg-blink");
  setTimeout(() => pCenter.classList.remove("p-msg-blink"), 3100);
}

function previewNotesAlert(){
  pRight.classList.remove("p-notes-blink");
  void pRight.offsetWidth;
  pRight.classList.add("p-notes-blink");
  setTimeout(() => pRight.classList.remove("p-notes-blink"), 3100);
}

client.on("connect", () => {
  statusEl.textContent = `Ligado (room: ${room})`;

  // ✅ subscrições para sync + alarmes
  client.subscribe(TOPIC_ACK, { qos: 1 });
  client.subscribe(TOPIC_STATE, { qos: 1 });

  client.subscribe(TOPIC_MSG, { qos: 1 });
  client.subscribe(TOPIC_NOTES, { qos: 1 });
  client.subscribe(TOPIC_ALERT, { qos: 1 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 1 });
  client.subscribe(TOPIC_COUNTDOWN, { qos: 1 });

  stampSync();
});

client.on("reconnect", () => statusEl.textContent = "A reconectar…");
client.on("close", () => statusEl.textContent = "Ligação perdida…");
client.on("offline", () => statusEl.textContent = "Servidor offline…");
client.on("error", () => statusEl.textContent = "Erro de ligação ao servidor.");

client.on("message", (topic, payload) => {
  let data;
  try { data = JSON.parse(payload.toString()); } catch { return; }

  if (topic === TOPIC_ACK) {
    if (data.status === "online") displayStateEl.textContent = "Display online.";
    stampSync();
    return;
  }

  // ✅ estado completo (clock, countdown, msg, notes)
  if (topic === TOPIC_STATE) {
    pClock.textContent = data.clock || "--:--:--";
    pCountdown.textContent = data.countdown || "--:--";
    pMainMsg.textContent = data.mainMsg || "Aguardando…";
    pNotesText.textContent = data.notes || "Sem notas.";
    stampSync();
    return;
  }

  // ✅ eventos (para preview ficar viva mesmo se o state atrasar)
  if (topic === TOPIC_MSG) {
    if (typeof data.text === "string") updatePreviewInstant(data.text, undefined, undefined);
    previewMsgAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_NOTES) {
    if (typeof data.text === "string") updatePreviewInstant(undefined, data.text || "Sem notas.", undefined);
    previewNotesAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_ALERT) {
    if (data.action === "alert") previewMsgAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_NOTES_ALERT) {
    if (data.action === "alertNotes") previewNotesAlert();
    stampSync();
    return;
  }

  if (topic === TOPIC_COUNTDOWN) {
    if (data.action === "set" && Number.isFinite(Number(data.seconds))) {
      const total = Number(data.seconds);
      const m = Math.floor(total / 60);
      const s = total % 60;
      updatePreviewInstant(undefined, undefined, `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
      stampSync();
      return;
    }
    if (data.action === "reset") {
      updatePreviewInstant(undefined, undefined, "--:--");
      stampSync();
      return;
    }
  }
});

sendBtn.addEventListener("click", () => sendMainMessage(msgInput.value));
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter") sendMainMessage(msgInput.value);
});

function sendMainMessage(text) {
  text = (text || "").trim();
  if (!text) return;
  client.publish(TOPIC_MSG, JSON.stringify({ id: uid(), text }), { qos: 1, retain: false });
  addToHistory(text);
  updatePreviewInstant(text);
  previewMsgAlert(); // ✅ mostra logo na preview
  msgInput.value = "";
}

sendNotesBtn.addEventListener("click", () => sendNotes(notesInput.value));
notesInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); sendNotes(notesInput.value); }
});

function sendNotes(text) {
  text = (text || "").trim();
  if (!text) text = "Sem notas.";
  client.publish(TOPIC_NOTES, JSON.stringify({ id: uid(), text }), { qos: 1, retain: false });
  addToNotesHistory(text);
  updatePreviewInstant(undefined, text);
  previewNotesAlert(); // ✅ mostra logo na preview
  notesInput.value = "";
}

alertNotesBtn.addEventListener("click", () => {
  client.publish(TOPIC_NOTES_ALERT, JSON.stringify({ id: uid(), action: "alertNotes" }), { qos: 1, retain: false });
  previewNotesAlert(); // ✅ preview instant
});

alertBtn.addEventListener("click", () => {
  client.publish(TOPIC_ALERT, JSON.stringify({ id: uid(), action: "alert" }), { qos: 1, retain: false });
  previewMsgAlert(); // ✅ preview instant
});

btnSetCountdown.addEventListener("click", () => {
  const minutes = parseInt(countdownInput.value, 10);
  if (isNaN(minutes) || minutes < 0) return;
  const seconds = minutes * 60;
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "set", seconds }), { qos: 1, retain: false });
  updatePreviewInstant(undefined, undefined, `${String(minutes).padStart(2,"0")}:00`);
});

btnStartCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "start" }), { qos: 1, retain: false });
});

btnStopCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "stop" }), { qos: 1, retain: false });
});

btnResetCountdown.addEventListener("click", () => {
  client.publish(TOPIC_COUNTDOWN, JSON.stringify({ id: uid(), action: "reset" }), { qos: 1, retain: false });
  updatePreviewInstant(undefined, undefined, "--:--");
});

resetAllBtn.addEventListener("click", () => {
  client.publish(TOPIC_RESET, JSON.stringify({ id: uid(), action: "resetAll" }), { qos: 1, retain: false });
  updatePreviewInstant("Aguardando…", "Sem notas.", "--:--");
});
