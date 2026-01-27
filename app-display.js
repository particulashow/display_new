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

const mainMsgEl = document.getElementById("mainMsg");
const notesTextEl = document.getElementById("notesText");
const notesBoxEl = document.getElementById("right");
const clockEl = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");

let countdownSeconds = null;
let countdownInterval = null;
let isConnected = false;

// MQTT client
const client = mqtt.connect(BROKER, {
  clientId: "display_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 8000,
  will: {
    topic: TOPIC_ACK,
    payload: JSON.stringify({ status: "offline", ts: Date.now() }),
    qos: 0,
    retain: false
  }
});

function safeJSON(payload){
  try { return JSON.parse(payload.toString()); }
  catch { return null; }
}

function setAlert(on){
  document.body.classList.toggle("alert", !!on);
}

function pulseMain(){
  mainMsgEl.classList.remove("pulse");
  // força reflow para reiniciar animação
  void mainMsgEl.offsetWidth;
  mainMsgEl.classList.add("pulse");
}

function flashNotes(){
  notesBoxEl.classList.remove("notesFlash");
  void notesBoxEl.offsetWidth;
  notesBoxEl.classList.add("notesFlash");
}

function renderCountdown(){
  if (countdownSeconds === null || typeof countdownSeconds !== "number"){
    countdownEl.textContent = "--:--";
    return;
  }
  const m = Math.floor(countdownSeconds / 60);
  const s = countdownSeconds % 60;
  countdownEl.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function startCountdown(){
  stopCountdown();
  countdownInterval = setInterval(() => {
    if (typeof countdownSeconds === "number" && countdownSeconds > 0){
      countdownSeconds--;
      renderCountdown();
      publishState();
    }
  }, 1000);
}

function stopCountdown(){
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
}

// Estado (para preview no control)
let publishQueued = false;
function publishState(){
  if (!isConnected) return;
  if (publishQueued) return;
  publishQueued = true;

  // throttling leve
  setTimeout(() => {
    publishQueued = false;
    const state = {
      ts: Date.now(),
      clock: clockEl.textContent,
      countdown: countdownEl.textContent,
      mainMsg: mainMsgEl.textContent,
      notes: notesTextEl.textContent
    };
    client.publish(TOPIC_STATE, JSON.stringify(state), { retain: false, qos: 0 });
  }, 120);
}

// Relógio
setInterval(() => {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString("pt-PT");
  publishState();
}, 1000);

// MQTT events
client.on("connect", () => {
  isConnected = true;

  client.subscribe([
    TOPIC_MSG,
    TOPIC_NOTES,
    TOPIC_NOTES_ALERT,
    TOPIC_COUNTDOWN,
    TOPIC_ALERT
  ]);

  client.publish(TOPIC_ACK, JSON.stringify({ status: "online", ts: Date.now() }), { qos: 0, retain: false });
  publishState();
});

client.on("reconnect", () => {
  isConnected = false;
});

client.on("close", () => {
  isConnected = false;
});

client.on("message", (topic, payload) => {
  const data = safeJSON(payload);
  if (!data) return;

  if (topic === TOPIC_MSG){
    mainMsgEl.textContent = data.text ?? "";
    pulseMain();
    setAlert(true);
    setTimeout(() => setAlert(false), 1200);
    publishState();
    return;
  }

  if (topic === TOPIC_NOTES){
    notesTextEl.textContent = (data.text && String(data.text).trim()) ? data.text : "Sem notas.";
    flashNotes();
    publishState();
    return;
  }

  if (topic === TOPIC_NOTES_ALERT){
    flashNotes();
    publishState();
    return;
  }

  if (topic === TOPIC_COUNTDOWN){
    const action = data.action;

    if (action === "set"){
      const secs = Number(data.seconds);
      countdownSeconds = Number.isFinite(secs) ? Math.max(0, Math.floor(secs)) : null;
      renderCountdown();
      publishState();
      return;
    }

    if (action === "start"){
      if (countdownSeconds !== null) startCountdown();
      publishState();
      return;
    }

    if (action === "stop"){
      stopCountdown();
      publishState();
      return;
    }

    if (action === "reset"){
      countdownSeconds = null;
      stopCountdown();
      renderCountdown();
      publishState();
      return;
    }
  }

  if (topic === TOPIC_ALERT){
    setAlert(true);
    setTimeout(() => setAlert(false), 1400);
    publishState();
  }
});
