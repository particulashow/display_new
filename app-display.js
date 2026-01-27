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
  clientId: "display_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 500,
  keepalive: 30
});

// ELEMENTOS
const mainMsgEl   = document.getElementById("mainMsg");
const notesTextEl = document.getElementById("notesText");
const notesBoxEl  = document.getElementById("right");
const centerEl    = document.getElementById("center");
const clockEl     = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");

let countdownSeconds = null;
let countdownInterval = null;

// DEDUPE por ID
const seen = new Map();
const SEEN_TTL_MS = 60_000;

function gcSeen(){
  const t = Date.now();
  for (const [id, ts] of seen.entries()){
    if (t - ts > SEEN_TTL_MS) seen.delete(id);
  }
}

function markAndCheckId(data){
  const id = data && data.id;
  if (!id) return false;
  gcSeen();
  if (seen.has(id)) return true;
  seen.set(id, Date.now());
  return false;
}

// RELÓGIO
setInterval(() => {
  clockEl.textContent = new Date().toLocaleTimeString("pt-PT");
  publishState();
}, 1000);

// COUNTDOWN
function renderCountdown() {
  if (countdownSeconds === null) {
    countdownEl.textContent = "--:--";
    return;
  }
  const m = Math.floor(countdownSeconds / 60);
  const s = countdownSeconds % 60;
  countdownEl.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function startCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (typeof countdownSeconds === "number" && countdownSeconds > 0) countdownSeconds--;
    renderCountdown();
    publishState();
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
}

// ALERTAS
function triggerNotesAlert() {
  notesBoxEl.classList.remove("notes-bg-blink");
  void notesBoxEl.offsetWidth;
  notesBoxEl.classList.add("notes-bg-blink");
  setTimeout(() => notesBoxEl.classList.remove("notes-bg-blink"), 3100);
}

function triggerMsgAlert() {
  centerEl.classList.remove("msg-bg-blink");
  void centerEl.offsetWidth;
  centerEl.classList.add("msg-bg-blink");
  setTimeout(() => centerEl.classList.remove("msg-bg-blink"), 3100);
}

// RESET
function resetAll() {
  mainMsgEl.textContent = "Aguardando mensagem…";
  notesTextEl.textContent = "Sem notas.";

  countdownSeconds = null;
  stopCountdown();
  renderCountdown();

  notesBoxEl.classList.remove("notes-bg-blink");
  centerEl.classList.remove("msg-bg-blink");

  publishState();
}

// STATE (✅ QoS 1 + retain)
function publishState() {
  if (!client || !client.connected) return;

  const state = {
    clock: clockEl.textContent,
    countdown: countdownEl.textContent,
    mainMsg: mainMsgEl.textContent,
    notes: notesTextEl.textContent
  };

  client.publish(
    TOPIC_STATE,
    JSON.stringify(state),
    { qos: 1, retain: true }
  );
}

// MQTT
client.on("connect", () => {
  client.subscribe(TOPIC_MSG,         { qos: 1 });
  client.subscribe(TOPIC_NOTES,       { qos: 1 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 1 });
  client.subscribe(TOPIC_COUNTDOWN,   { qos: 1 });
  client.subscribe(TOPIC_ALERT,       { qos: 1 });
  client.subscribe(TOPIC_RESET,       { qos: 1 });

  client.publish(TOPIC_ACK, JSON.stringify({ status: "online", room }), { qos: 1, retain: false });
  publishState();
});

client.on("message", (topic, payload) => {
  let data;
  try { data = JSON.parse(payload.toString()); }
  catch { return; }

  if (markAndCheckId(data)) return;

  if (topic === TOPIC_MSG) {
    if (typeof data.text !== "string") return;
    mainMsgEl.textContent = data.text;
    triggerMsgAlert();
    publishState();
    return;
  }

  if (topic === TOPIC_NOTES) {
    if (typeof data.text !== "string") return;
    notesTextEl.textContent = data.text || "Sem notas.";
    triggerNotesAlert();
    publishState();
    return;
  }

  if (topic === TOPIC_NOTES_ALERT) {
    if (data.action !== "alertNotes") return;
    triggerNotesAlert();
    return;
  }

  if (topic === TOPIC_ALERT) {
    if (data.action !== "alert") return;
    triggerMsgAlert();
    return;
  }

  if (topic === TOPIC_COUNTDOWN) {
    if (typeof data.action !== "string") return;

    if (data.action === "set") {
      countdownSeconds = Number(data.seconds);
      if (!Number.isFinite(countdownSeconds) || countdownSeconds < 0) countdownSeconds = 0;
      renderCountdown();
      publishState();
      return;
    }

    if (data.action === "start") { startCountdown(); return; }
    if (data.action === "stop")  { stopCountdown(); return; }

    if (data.action === "reset") {
      countdownSeconds = null;
      stopCountdown();
      renderCountdown();
      publishState();
      return;
    }
  }

  if (topic === TOPIC_RESET) {
    if (data.action !== "resetAll") return;
    resetAll();
  }
});
