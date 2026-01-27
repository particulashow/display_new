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

const client = mqtt.connect(BROKER, {
  clientId: "display_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 1000
});

/* ELEMENTOS */
const mainMsgEl = document.getElementById("mainMsg");
const notesTextEl = document.getElementById("notesText");
const notesBoxEl = document.getElementById("right");
const clockEl = document.getElementById("clock");
const countdownEl = document.getElementById("countdown");

let countdownSeconds = null;
let countdownInterval = null;

/* RELÓGIO */
setInterval(() => {
  clockEl.textContent = new Date().toLocaleTimeString("pt-PT");
  publishState();
}, 1000);

/* COUNTDOWN */
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

/* ALERTAS */
function triggerMainAlert() {
  document.body.style.background = "var(--bg-alert)";
  mainMsgEl.classList.add("blink");
  setTimeout(() => {
    document.body.style.background = "var(--bg-normal)";
    mainMsgEl.classList.remove("blink");
  }, 3000);
}

function triggerNotesAlert() {
  notesBoxEl.classList.remove("notes-bg-blink");
  void notesBoxEl.offsetWidth; // força reflow
  notesBoxEl.classList.add("notes-bg-blink");

  setTimeout(() => {
    notesBoxEl.classList.remove("notes-bg-blink");
  }, 3100);
}

function triggerGlobalAlert() {
  document.body.style.background = "var(--bg-alert)";
  setTimeout(() => {
    document.body.style.background = "var(--bg-normal)";
  }, 3000);
}

/* ESTADO */
function publishState() {
  const state = {
    clock: clockEl.textContent,
    countdown: countdownEl.textContent,
    mainMsg: mainMsgEl.textContent,
    notes: notesTextEl.textContent
  };
  client.publish(TOPIC_STATE, JSON.stringify(state));
}

/* MQTT */
client.on("connect", () => {
  client.subscribe(TOPIC_MSG);
  client.subscribe(TOPIC_NOTES);
  client.subscribe(TOPIC_NOTES_ALERT);
  client.subscribe(TOPIC_COUNTDOWN);
  client.subscribe(TOPIC_ALERT);

  client.publish(TOPIC_ACK, JSON.stringify({ status: "online" }));
  publishState();
});

client.on("message", (topic, payload) => {
  const data = JSON.parse(payload.toString());

  if (topic === TOPIC_MSG) {
    mainMsgEl.textContent = data.text;
    triggerMainAlert();
    publishState();
  }

  if (topic === TOPIC_NOTES) {
    notesTextEl.textContent = data.text || "Sem notas.";
    triggerNotesAlert();
    publishState();
  }

  if (topic === TOPIC_NOTES_ALERT) {
    triggerNotesAlert();
  }

  if (topic === TOPIC_COUNTDOWN) {
    if (data.action === "set") {
      countdownSeconds = data.seconds;
      renderCountdown();
    }
    if (data.action === "start") startCountdown();
    if (data.action === "stop") stopCountdown();
    if (data.action === "reset") {
      countdownSeconds = null;
      stopCountdown();
      renderCountdown();
    }
    publishState();
  }

  if (topic === TOPIC_ALERT) {
    triggerGlobalAlert();
    publishState();
  }
});
