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
  reconnectPeriod: 500,
  keepalive: 30,
  // ajuda em redes instáveis
  resubscribe: true
});

// ELEMENTOS
const mainMsgEl = document.getElementById("mainMsg");
const notesTextEl = document.getElementById("notesText");
const notesBoxEl = document.getElementById("right");
const clockEl = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");

// COUNTDOWN (robusto)
let countdownEndAt = null;   // timestamp ms
let countdownRunning = false;

// UTILS
function nowPT() {
  return new Date().toLocaleTimeString("pt-PT");
}

function remainingSeconds() {
  if (!countdownEndAt) return null;
  const ms = countdownEndAt - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

function renderCountdown() {
  if (!countdownEndAt) {
    countdownEl.textContent = "--:--";
    return;
  }
  const secs = remainingSeconds();
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  countdownEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function publishState() {
  // QoS 0 para não criar filas no broker
  const state = {
    ts: Date.now(),
    clock: clockEl.textContent,
    countdown: countdownEl.textContent,
    // também mando dados “reais” do countdown
    countdownEndAt,
    countdownRunning,
    mainMsg: mainMsgEl.textContent,
    notes: notesTextEl.textContent
  };
  client.publish(TOPIC_STATE, JSON.stringify(state), { qos: 0, retain: false });
}

// RELÓGIO + LOOP DE ESTADO (1Hz)
setInterval(() => {
  clockEl.textContent = nowPT();

  // countdown corre “por endAt”, não por seconds--
  if (countdownRunning && countdownEndAt) {
    if (remainingSeconds() <= 0) {
      countdownRunning = false; // terminou
    }
  }
  renderCountdown();
  publishState();
}, 1000);

// ALERTAS
function triggerMainAlert() {
  // só na mensagem (não muda fundo geral)
  mainMsgEl.classList.add("blink");
  setTimeout(() => mainMsgEl.classList.remove("blink"), 3000);
}

function triggerNotesAlert() {
  notesBoxEl.classList.add("notes-bg-blink");
  setTimeout(() => notesBoxEl.classList.remove("notes-bg-blink"), 3000);
}

function triggerGlobalAlert() {
  // pisca só na zona da mensagem mantendo vermelho
  mainMsgEl.classList.add("blink");
  setTimeout(() => mainMsgEl.classList.remove("blink"), 3000);
}

// MQTT
client.on("connect", () => {
  client.subscribe(TOPIC_MSG, { qos: 1 });
  client.subscribe(TOPIC_NOTES, { qos: 1 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 1 });
  client.subscribe(TOPIC_COUNTDOWN, { qos: 1 });
  client.subscribe(TOPIC_ALERT, { qos: 1 });
  client.subscribe(TOPIC_RESET, { qos: 1 });

  client.publish(TOPIC_ACK, JSON.stringify({ status: "online", ts: Date.now() }), { qos: 1, retain: false });
  publishState();
});

client.on("message", (topic, payload) => {
  let data;
  try { data = JSON.parse(payload.toString()); } catch { return; }

  if (topic === TOPIC_MSG) {
    mainMsgEl.textContent = data.text ?? "";
    triggerMainAlert();
    publishState();
    return;
  }

  if (topic === TOPIC_NOTES) {
    notesTextEl.textContent = (data.text && String(data.text).trim()) ? data.text : "Sem notas.";
    triggerNotesAlert();
    publishState();
    return;
  }

  if (topic === TOPIC_NOTES_ALERT) {
    // só alerta visual, sem alterar texto
    triggerNotesAlert();
    publishState();
    return;
  }

  if (topic === TOPIC_COUNTDOWN) {
    // Protocolo robusto:
    // set -> define endAt; start -> running=true; stop -> running=false; reset -> limpa
    if (data.action === "set") {
      if (Number.isFinite(Number(data.endAt))) {
        countdownEndAt = Number(data.endAt);
      } else if (Number.isFinite(Number(data.seconds))) {
        countdownEndAt = Date.now() + Number(data.seconds) * 1000;
      }
      countdownRunning = false;
      renderCountdown();
      publishState();
      return;
    }

    if (data.action === "start") {
      if (countdownEndAt) countdownRunning = true;
      publishState();
      return;
    }

    if (data.action === "stop") {
      countdownRunning = false;
      publishState();
      return;
    }

    if (data.action === "reset") {
      countdownEndAt = null;
      countdownRunning = false;
      renderCountdown();
      publishState();
      return;
    }

    return;
  }

  if (topic === TOPIC_ALERT) {
    triggerGlobalAlert();
    publishState();
    return;
  }

  if (topic === TOPIC_RESET) {
    // reset total
    mainMsgEl.textContent = "Aguardando mensagem…";
    notesTextEl.textContent = "Sem notas.";
    countdownEndAt = null;
    countdownRunning = false;
    renderCountdown();
    publishState();
    return;
  }
});
