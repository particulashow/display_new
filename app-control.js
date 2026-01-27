const BROKER = "wss://test.mosquitto.org:8081/mqtt";

const roomInput = document.getElementById("room");
const msgInput = document.getElementById("msgInput");
const notesInput = document.getElementById("notesInput");
const countdownInput = document.getElementById("countdownInput");

const historyEl = document.getElementById("history");
const notesHistoryEl = document.getElementById("notesHistory");

const statusEl = document.getElementById("status");
const displayStateEl = document.getElementById("displayState");
const topicsEl = document.getElementById("topics");

const previewFrame = document.getElementById("previewFrame");

const sendBtn = document.getElementById("sendBtn");
const alertBtn = document.getElementById("alertBtn");
const sendNotesBtn = document.getElementById("sendNotesBtn");
const alertNotesBtn = document.getElementById("alertNotesBtn");

const btnSetCountdown = document.getElementById("btnSetCountdown");
const btnStartCountdown = document.getElementById("btnStartCountdown");
const btnStopCountdown = document.getElementById("btnStopCountdown");
const btnResetCountdown = document.getElementById("btnResetCountdown");

function qsRoom(){
  const u = new URL(location.href);
  const r = u.searchParams.get("room");
  return r || "default";
}
roomInput.value = qsRoom();

function topic(room, suffix){
  return `speaker/${suffix}/${room}`;
}

function getTopics(room){
  return {
    MSG: topic(room, "messages"),
    ACK: topic(room, "ack"),
    NOTES: topic(room, "notes"),
    NOTES_ALERT: topic(room, "notesAlert"),
    COUNTDOWN: topic(room, "countdown"),
    ALERT: topic(room, "alert"),
    STATE: topic(room, "state")
  };
}

let room = roomInput.value.trim() || "default";
let T = getTopics(room);

topicsEl.textContent = `topics: ${room}`;

function setPreview(){
  // aponta para o display na mesma pasta (se estiveres no mesmo deploy)
  // Se estiver em URL diferente, troca aqui.
  previewFrame.src = `display.html?room=${encodeURIComponent(room)}`;
}
setPreview();

const client = mqtt.connect(BROKER, {
  clientId: "control_" + Math.random().toString(16).slice(2),
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 8000
});

let connected = false;

function safeJSON(payload){
  try { return JSON.parse(payload.toString()); }
  catch { return null; }
}

function publish(t, obj){
  if (!connected) return;
  client.publish(t, JSON.stringify(obj), { qos: 0, retain: false });
}

function uiStatus(txt){
  statusEl.textContent = txt;
}

function addHistory(el, text, onPick){
  const item = document.createElement("div");
  item.className = "historyItem";
  item.textContent = text;
  item.title = "clicar para reutilizar";
  item.addEventListener("click", () => onPick(text));
  el.prepend(item);

  // limita entradas no DOM
  while (el.children.length > 30){
    el.lastElementChild.remove();
  }
}

function loadHist(key){
  try{
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function saveHist(key, arr){
  localStorage.setItem(key, JSON.stringify(arr.slice(0, 40)));
}

let histMsg = loadHist(`speaker_hist_msg_${room}`);
let histNotes = loadHist(`speaker_hist_notes_${room}`);

function renderHist(){
  historyEl.innerHTML = "";
  notesHistoryEl.innerHTML = "";

  histMsg.forEach(t => addHistory(historyEl, t, (x) => msgInput.value = x));
  histNotes.forEach(t => addHistory(notesHistoryEl, t, (x) => notesInput.value = x));
}
renderHist();

function pushHist(arr, key, text){
  const t = String(text || "").trim();
  if (!t) return;
  const next = [t, ...arr.filter(x => x !== t)];
  arr.length = 0;
  next.forEach(x => arr.push(x));
  saveHist(key, arr);
  renderHist();
}

function resubscribe(){
  if (!connected) return;

  // unsubscribe topics antigos e subscribe novos
  client.unsubscribe(Object.values(T));
  T = getTopics(room);

  client.subscribe([T.ACK, T.STATE]);
  uiStatus(`Ligado • room=${room}`);
  topicsEl.textContent = `topics: ${room}`;
}

roomInput.addEventListener("input", () => {
  const r = roomInput.value.trim() || "default";
  room = r;
  setPreview();
  // guarda room no URL sem recarregar
  const u = new URL(location.href);
  u.searchParams.set("room", room);
  history.replaceState(null, "", u.toString());

  // recarrega histórico por room
  histMsg = loadHist(`speaker_hist_msg_${room}`);
  histNotes = loadHist(`speaker_hist_notes_${room}`);
  renderHist();

  resubscribe();
});

client.on("connect", () => {
  connected = true;
  T = getTopics(room);
  client.subscribe([T.ACK, T.STATE]);
  uiStatus(`Ligado • room=${room}`);
  topicsEl.textContent = `topics: ${room}`;
});

client.on("reconnect", () => {
  connected = false;
  uiStatus("A reconectar…");
});

client.on("close", () => {
  connected = false;
  uiStatus("Desligado");
});

client.on("message", (topicName, payload) => {
  const data = safeJSON(payload);
  if (!data) return;

  if (topicName === T.ACK){
    // opcional: mostrar online/offline
    return;
  }

  if (topicName === T.STATE){
    displayStateEl.textContent =
      `Display: ${data.clock || "--:--:--"} | ${data.countdown || "--:--"} | ` +
      `${(data.mainMsg || "").slice(0, 40)}${(data.mainMsg || "").length > 40 ? "…" : ""}`;
  }
});

// Ações
sendBtn.addEventListener("click", () => {
  const text = msgInput.value.trim();
  if (!text) return;
  publish(T.MSG, { text, ts: Date.now() });
  pushHist(histMsg, `speaker_hist_msg_${room}`, text);
});

alertBtn.addEventListener("click", () => {
  publish(T.ALERT, { ts: Date.now() });
});

sendNotesBtn.addEventListener("click", () => {
  const text = notesInput.value.trim();
  publish(T.NOTES, { text, ts: Date.now() });
  if (text) pushHist(histNotes, `speaker_hist_notes_${room}`, text);
});

alertNotesBtn.addEventListener("click", () => {
  publish(T.NOTES_ALERT, { ts: Date.now() });
});

btnSetCountdown.addEventListener("click", () => {
  const min = Number(countdownInput.value);
  const seconds = Number.isFinite(min) ? Math.max(0, Math.floor(min * 60)) : 0;
  publish(T.COUNTDOWN, { action: "set", seconds, ts: Date.now() });
});

btnStartCountdown.addEventListener("click", () => {
  publish(T.COUNTDOWN, { action: "start", ts: Date.now() });
});

btnStopCountdown.addEventListener("click", () => {
  publish(T.COUNTDOWN, { action: "stop", ts: Date.now() });
});

btnResetCountdown.addEventListener("click", () => {
  publish(T.COUNTDOWN, { action: "reset", ts: Date.now() });
});

// Atalhos úteis
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement === msgInput) sendBtn.click();
  if (e.key === "Enter" && document.activeElement === notesInput) sendNotesBtn.click();
});
