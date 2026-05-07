const params = new URLSearchParams(location.search);
const room = params.get("room") || "default";

if (!window.mqtt) {
  console.error("MQTT.js não carregou");
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
  clientId: "display_" + Date.now() + "_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 2500,
  keepalive: 30,
  resubscribe: true,
  connectTimeout: 8000
});

// ELEMENTOS
const mainMsgEl = document.getElementById("mainMsg");
const notesTextEl = document.getElementById("notesText");
const notesBoxEl = document.getElementById("right");
const centerEl = document.getElementById("center");
const clockEl = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");

// COUNTDOWN
let countdownEndAt = null;
let countdownRunning = false;

// STATE debounce
let publishTimer = null;

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

function getState() {
  return {
    ts: Date.now(),
    clock: clockEl.textContent,
    countdown: countdownEl.textContent,
    countdownEndAt,
    countdownRunning,
    mainMsg: mainMsgEl.textContent,
    notes: notesTextEl.textContent
  };
}

function publishState() {
  client.publish(TOPIC_STATE, JSON.stringify(getState()), {
    qos: 1,
    retain: true
  });
}

function scheduleStatePublish(delay = 120) {
  clearTimeout(publishTimer);

  publishTimer = setTimeout(() => {
    publishState();
  }, delay);
}

// Relógio + countdown local
setInterval(() => {
  clockEl.textContent = nowPT();

  if (countdownRunning && countdownEndAt) {
    if (remainingSeconds() <= 0) {
      countdownRunning = false;
      renderCountdown();
      scheduleStatePublish();
      return;
    }
  }

  renderCountdown();
}, 250);

// ALERTAS
function triggerMainAlert() {
  centerEl.classList.remove("msg-bg-blink");
  void centerEl.offsetWidth;
  centerEl.classList.add("msg-bg-blink");
  setTimeout(() => centerEl.classList.remove("msg-bg-blink"), 3000);
}

function triggerNotesAlert() {
  notesBoxEl.classList.remove("notes-bg-blink");
  void notesBoxEl.offsetWidth;
  notesBoxEl.classList.add("notes-bg-blink");
  setTimeout(() => notesBoxEl.classList.remove("notes-bg-blink"), 3000);
}

function triggerGlobalAlert() {
  triggerMainAlert();
}

// MQTT
client.on("connect", () => {
  client.subscribe(TOPIC_MSG, { qos: 1 });
  client.subscribe(TOPIC_NOTES, { qos: 1 });
  client.subscribe(TOPIC_NOTES_ALERT, { qos: 1 });
  client.subscribe(TOPIC_COUNTDOWN, { qos: 1 });
  client.subscribe(TOPIC_ALERT, { qos: 1 });
  client.subscribe(TOPIC_RESET, { qos: 1 });

  client.publish(TOPIC_ACK, JSON.stringify({
    status: "online",
    ts: Date.now()
  }), { qos: 1, retain: false });

  publishState();
});

client.on("reconnect", () => {
  console.log("Display: a reconectar…");
});

client.on("close", () => {
  console.log("Display: ligação perdida.");
});

client.on("offline", () => {
  console.log("Display: servidor offline.");
});

client.on("error", (err) => {
  console.error("MQTT error:", err);
});

client.on("message", (topic, payload) => {
  let data;

  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }

  if (topic === TOPIC_MSG) {
    mainMsgEl.textContent = data.text ?? "";
    triggerMainAlert();
    scheduleStatePublish();
    return;
  }

  if (topic === TOPIC_NOTES) {
    notesTextEl.textContent =
      data.text && String(data.text).trim()
        ? data.text
        : "Sem notas.";

    triggerNotesAlert();
    scheduleStatePublish();
    return;
  }

  if (topic === TOPIC_NOTES_ALERT) {
    triggerNotesAlert();
    scheduleStatePublish();
    return;
  }

  if (topic === TOPIC_COUNTDOWN) {
    if (data.action === "set") {
      if (Number.isFinite(Number(data.endAt))) {
        countdownEndAt = Number(data.endAt);
      } else if (Number.isFinite(Number(data.seconds))) {
        countdownEndAt = Date.now() + Number(data.seconds) * 1000;
      }

      countdownRunning = false;
      renderCountdown();
      scheduleStatePublish();
      return;
    }

    if (data.action === "start") {
      if (countdownEndAt) countdownRunning = true;
      scheduleStatePublish();
      return;
    }

    if (data.action === "stop") {
      countdownRunning = false;
      scheduleStatePublish();
      return;
    }

    if (data.action === "reset") {
      countdownEndAt = null;
      countdownRunning = false;
      renderCountdown();
      scheduleStatePublish();
      return;
    }

    return;
  }

  if (topic === TOPIC_ALERT) {
    triggerGlobalAlert();
    scheduleStatePublish();
    return;
  }

  if (topic === TOPIC_RESET) {
    mainMsgEl.textContent = "Aguardando mensagem…";
    notesTextEl.textContent = "Sem notas.";
    countdownEndAt = null;
    countdownRunning = false;
    renderCountdown();
    scheduleStatePublish();
  }
});
