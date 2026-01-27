const params = new URLSearchParams(location.search);
const room = params.get("room") || "default";

/*
  IMPORTANTE:
  Se deixares "default", num broker público podes apanhar mensagens de outras pessoas.
  Recomendo mesmo usares sempre um room único:
  ?room=evento_2026_01_27
*/

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

/* DEDUPE POR ID (resolve duplicados e reduz “fantasmas” de reconnect/QoS)
   Mantém cache curta para não crescer.
*/
const seen = new Map(); // id -> ts
const SEEN_TTL_MS = 60_000;

function gcSeen(){
  const t = Date.now();
  for (const [id, ts] of seen.entries()){
    if (t - ts > SEEN_TTL_MS) seen.delete(id);
  }
}

function markAndCheckId(data){
  // se não tiver id, não dedupe (pode vir de terceiros)
  const id = data && data.id;
  if (!id) return false;
  const t = Date.now();
  gcSeen();
  if (seen.has(id)) return true;
  seen.set(id, t);
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

// RESET TOTAL
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

// ESTADO
function publishState() {
  const state = {
    clock: clockEl.textContent,
    countdown: countdownEl.textContent,
    mainMsg: mainMsgEl.textContent,
    notes: notesTextEl.textContent
  };
  client.publish(TOPIC_STATE, JSON.stringify(state), { qos: 0 });
}

// MQTT
client.on("connect", () => {
  client.subscribe(TOPIC_MSG,         { qos: 0 });
  client.subscribe(TOPIC_NOTES,       { qos: 0 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 0 });
  client.subscribe(TOPIC_COUNTDOWN,   { qos: 0 });
  client.subscribe(TOPIC_ALERT,       { qos: 0 });
  client.subscribe(TOPIC_RESET,       { qos: 0 });

  client.publish(TOPIC_ACK, JSON.stringify({ status: "online", room }), { qos: 0 });
  publishState();
});

client.on("message", (topic, payload) => {
  let data;
  try { data = JSON.parse(payload.toString()); }
  catch { return; }

  // ignora duplicados por id
  if (markAndCheckId(data)) return;

  // Mensagem principal
  if (topic === TOPIC_MSG) {
    if (typeof data.text !== "string") return;
    mainMsgEl.textContent = data.text;
    triggerMsgAlert();
    publishState();
    return;
  }

  // Notas
  if (topic === TOPIC_NOTES) {
    if (typeof data.text !== "string") return;
    notesTextEl.textContent = data.text || "Sem notas.";
    triggerNotesAlert();
    publishState();
    return;
  }

  // Alerta notas (só pisca, não altera texto)
  if (topic === TOPIC_NOTES_ALERT) {
    if (data.action !== "alertNotes") return;
    triggerNotesAlert();
    return;
  }

  // Alerta geral (só pisca no centro, não altera texto)
  if (topic === TOPIC_ALERT) {
    if (data.action !== "alert") return;
    triggerMsgAlert();
    return;
  }

  // Countdown
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

  // Reset total
  if (topic === TOPIC_RESET) {
    if (data.action !== "resetAll") return;
    resetAll();
  }
});
