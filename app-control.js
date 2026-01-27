(() => {
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "default").trim();
  const BROKER = params.get("broker") || "wss://test.mosquitto.org:8081/mqtt";

  document.getElementById("roomLabel").textContent = room;

  const TOPIC_MSG = `speaker/messages/${room}`;
  const TOPIC_ACK = `speaker/ack/${room}`;
  const TOPIC_NOTES = `speaker/notes/${room}`;
  const TOPIC_NOTES_ALERT = `speaker/notesAlert/${room}`;
  const TOPIC_COUNTDOWN = `speaker/countdown/${room}`;
  const TOPIC_ALERT = `speaker/alert/${room}`;
  const TOPIC_STATE = `speaker/state/${room}`;

  const FAST = { qos: 0 };                 // rápido
  const RELIABLE_RETAIN = { qos: 1, retain: true }; // para estado/ack

  const client = mqtt.connect(BROKER, {
    clientId: "control_" + Math.random().toString(16).slice(2),
    clean: true,
    reconnectPeriod: 1200,
    connectTimeout: 8000
  });

  const msgInput = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const alertBtn = document.getElementById("alertBtn");

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

  const statusEl = document.getElementById("status");
  const displayStateEl = document.getElementById("displayState");

  let lastNotesText = "Sem notas.";

  function safeJSON(payload){
    try { return JSON.parse(payload.toString()); }
    catch { return null; }
  }

  function addToHistory(text){
    const t = (text || "").trim();
    if (!t) return;
    const div = document.createElement("div");
    div.className = "history-item";
    div.textContent = t;
    div.onclick = () => sendMainMessage(t);
    historyEl.prepend(div);
  }

  function addToNotesHistory(text){
    const t = (text || "").trim();
    const div = document.createElement("div");
    div.className = "history-item";
    div.textContent = t || "Sem notas.";
    div.onclick = () => sendNotes(t);
    notesHistoryEl.prepend(div);
  }

  client.on("connect", () => {
    statusEl.textContent = `Ligado (room: ${room})`;
    client.subscribe([TOPIC_ACK, TOPIC_STATE], { qos: 1 });
  });

  client.on("reconnect", () => statusEl.textContent = "A reconectar…");
  client.on("close", () => statusEl.textContent = "Ligação perdida…");
  client.on("offline", () => statusEl.textContent = "Servidor offline…");
  client.on("error", () => statusEl.textContent = "Erro de ligação ao servidor.");

  client.on("message", (topic, payload) => {
    const data = safeJSON(payload);
    if (!data) return;

    if (topic === TOPIC_ACK) {
      if (data.status === "online") displayStateEl.textContent = "Display online ✅";
      return;
    }

    if (topic === TOPIC_STATE) {
      pClock.textContent = data.clock || "--:--:--";
      pCountdown.textContent = data.countdown || "--:--";
      pMainMsg.textContent = data.mainMsg || "A aguardar…";
      pNotesText.textContent = data.notes || "Sem notas.";
    }
  });

  function updatePreviewInstant(mainMsg, notes, countdown){
    if (mainMsg !== undefined) pMainMsg.textContent = mainMsg;
    if (notes !== undefined) pNotesText.textContent = notes;
    if (countdown !== undefined) pCountdown.textContent = countdown;
  }

  sendBtn.addEventListener("click", () => sendMainMessage(msgInput.value));
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMainMessage(msgInput.value);
  });

  function sendMainMessage(text){
    text = (text || "").trim();
    if (!text) return;

    // Mensagem rápida (QoS 0) + também retained para “apanhar ao entrar”
    client.publish(TOPIC_MSG, JSON.stringify({ text }), { qos: 0, retain: true });

    addToHistory(text);
    updatePreviewInstant(text);
    msgInput.value = "";
  }

  sendNotesBtn.addEventListener("click", () => sendNotes(notesInput.value));
  notesInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      sendNotes(notesInput.value);
    }
  });

  function sendNotes(text){
    text = (text || "").trim();
    if (!text) text = "Sem notas.";
    lastNotesText = text;

    client.publish(TOPIC_NOTES, JSON.stringify({ text }), { qos: 0, retain: true });

    addToNotesHistory(text);
    updatePreviewInstant(undefined, text);
    notesInput.value = "";
  }

  alertNotesBtn.addEventListener("click", () => {
    // dispara o blink rápido
    client.publish(TOPIC_NOTES_ALERT, JSON.stringify({ action: "alertNotes" }), FAST);
    // reenvia o texto retained para consistência
    client.publish(TOPIC_NOTES, JSON.stringify({ text: lastNotesText }), { qos: 0, retain: true });
  });

  btnSetCountdown.addEventListener("click", () => {
    const minutes = parseInt(countdownInput.value, 10);
    if (Number.isNaN(minutes) || minutes < 0) return;

    const seconds = minutes * 60;
    client.publish(TOPIC_COUNTDOWN, JSON.stringify({ action: "set", seconds }), FAST);

    const m = String(minutes).padStart(2, "0");
    updatePreviewInstant(undefined, undefined, `${m}:00`);
  });

  btnStartCountdown.addEventListener("click", () => {
    client.publish(TOPIC_COUNTDOWN, JSON.stringify({ action: "start" }), FAST);
  });

  btnStopCountdown.addEventListener("click", () => {
    client.publish(TOPIC_COUNTDOWN, JSON.stringify({ action: "stop" }), FAST);
  });

  btnResetCountdown.addEventListener("click", () => {
    client.publish(TOPIC_COUNTDOWN, JSON.stringify({ action: "reset" }), FAST);
    updatePreviewInstant(undefined, undefined, "--:--");
  });

  alertBtn.addEventListener("click", () => {
    client.publish(TOPIC_ALERT, JSON.stringify({ action: "alert" }), FAST);
  });
})();
