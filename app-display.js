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
  clientId: "display_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 800,
  keepalive: 30
});

// ELEMENTOS
const mainMsgEl = document.getElementById("mainMsg");
const notesTextEl = document.getElementById("notesText");
const notesBoxEl = document.getElementById("right");
const centerEl = document.getElementById("center");
const clockEl = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");

let countdownSeconds = null;
let countdownInterval = null;

// Anti-duplicados (evita “alarmes fantasma” em reconnect/QoS1)
const lastSeen = new Map(); // key -> {ts, sig}
const DEDUPE_WINDOW_MS = 15000;

function nowMs(){ return Date.now(); }

function shouldIgnoreDuplicate(topic, sig){
  const k = topic;
  const prev = lastSeen.get(k);
  const t = nowMs();
  if (prev && prev.sig === sig && (t - prev.ts) < DEDUPE_WINDOW_MS) return true;
  lastSeen.set(k, { ts: t, sig });
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
    if (countdownSeconds > 0) countdownSeconds--;
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
  void notesBoxEl.offsetWidth; // reflow
  notesBoxEl.classList.add("notes-bg-blink");
  setTimeout(() => notesBoxEl.classList.remove("notes-bg-blink"), 3100);
}

function triggerMsgAlert() {
  // pisca só na coluna do meio
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

  // limpar classes
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
  client.publish(TOPIC_STATE, JSON.stringify(state));
}

// MQTT
client.on("connect", () => {
  client.subscribe(TOPIC_MSG, { qos: 0 });
  client.subscribe(TOPIC_NOTES, { qos: 0 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 0 });
  client.subscribe(TOPIC_COUNTDOWN, { qos: 0 });
  client.subscribe(TOPIC_ALERT, { qos: 0 });
  client.subscribe(TOPIC_RESET, { qos: 0 });

  client.publish(TOPIC_ACK, JSON.stringify({ status: "online" }), { qos: 0 });
  publishState();
});

client.on("message", (topic, payload) => {
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }

  // assinatura simples para dedupe
  const sig = JSON.stringify(data);
  if (shouldIgnoreDuplicate(topic, sig)) return;

  if (topic === TOPIC_MSG) {
    if (typeof data.text === "string") {
      mainMsgEl.textContent = data.text;
      triggerMsgAlert(); // agora o “alerta geral” é só na área da mensagem
      publishState();
    }
  }

  if (topic === TOPIC_NOTES) {
    notesTextEl.textContent = (data.text || "Sem notas.");
    triggerNotesAlert();
    publishState();
  }

  if (topic === TOPIC_NOTES_ALERT) {
    triggerNotesAlert();
  }

  if (topic === TOPIC_ALERT) {
    // alerta geral: piscar vermelho na área da mensagem
    triggerMsgAlert();
  }

  if (topic === TOPIC_COUNTDOWN) {
    if (data.action === "set") {
      countdownSeconds = Number(data.seconds) || 0;
      renderCountdown();
      publishState();
    }
    if (data.action === "start") startCountdown();
    if (data.action === "stop") stopCountdown();
    if (data.action === "reset") {
      countdownSeconds = null;
      stopCountdown();
      renderCountdown();
      publishState();
    }
  }

  if (topic === TOPIC_RESET) {
    resetAll();
  }
});
