(() => {
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "default").trim();
  const BROKER = params.get("broker") || "wss://test.mosquitto.org:8081/mqtt";

  const TOPIC_MSG = `speaker/messages/${room}`;
  const TOPIC_ACK = `speaker/ack/${room}`;
  const TOPIC_NOTES = `speaker/notes/${room}`;
  const TOPIC_NOTES_ALERT = `speaker/notesAlert/${room}`;
  const TOPIC_COUNTDOWN = `speaker/countdown/${room}`;
  const TOPIC_ALERT = `speaker/alert/${room}`;
  const TOPIC_STATE = `speaker/state/${room}`;

  // QoS 0 = mais rápido (sem handshake). QoS 1 só para STATE/ACK (retained).
  const FAST = { qos: 0 };
  const RELIABLE_RETAIN = { qos: 1, retain: true };

  const client = mqtt.connect(BROKER, {
    clientId: "display_" + Math.random().toString(16).slice(2),
    clean: true,
    reconnectPeriod: 1200,
    connectTimeout: 8000
  });

  const mainMsgEl = document.getElementById("mainMsg");
  const notesTextEl = document.getElementById("notesText");
  const notesBoxEl = document.getElementById("right");
  const clockEl = document.getElementById("clock");
  const countdownEl = document.getElementById("countdown");

  let countdownSeconds = null;
  let countdownInterval = null;

  // Throttle de publishState (máx 4x/seg) + só quando algo muda
  let lastStateJSON = "";
  let lastPublishTs = 0;

  function getState(){
    return {
      room,
      clock: clockEl.textContent,
      countdown: countdownEl.textContent,
      mainMsg: mainMsgEl.textContent,
      notes: notesTextEl.textContent
    };
  }

  function publishState(force = false){
    if (!client.connected) return;

    const now = Date.now();
    if (!force && (now - lastPublishTs) < 250) return; // max 4/s
    lastPublishTs = now;

    const stateJSON = JSON.stringify(getState());
    if (!force && stateJSON === lastStateJSON) return;

    lastStateJSON = stateJSON;
    client.publish(TOPIC_STATE, stateJSON, RELIABLE_RETAIN);
  }

  // RELÓGIO (já não publica estado a cada tick)
  setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString("pt-PT");
    // Se quiseres o relógio no preview “super fiel”, descomenta:
    // publishState();
  }, 1000);

  function renderCountdown(){
    if (countdownSeconds === null){
      countdownEl.textContent = "--:--";
      return;
    }
    const m = Math.floor(countdownSeconds / 60);
    const s = countdownSeconds % 60;
    countdownEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function startCountdown(){
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      if (countdownSeconds === null) return;
      if (countdownSeconds > 0) countdownSeconds--;
      renderCountdown();
      publishState();
    }, 1000);
  }

  function stopCountdown(){
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  function triggerMainAlert(){
    document.body.style.background = "var(--bg-alert)";
    mainMsgEl.classList.add("blink");
    setTimeout(() => {
      document.body.style.background = "var(--bg-normal)";
      mainMsgEl.classList.remove("blink");
    }, 3000);
  }

  // Agora pisca 3s e em laranja via CSS
  function triggerNotesAlert(){
    notesBoxEl.classList.add("notes-bg-blink");
    setTimeout(() => notesBoxEl.classList.remove("notes-bg-blink"), 3000);
  }

  function triggerGlobalAlert(){
    document.body.style.background = "var(--bg-alert)";
    setTimeout(() => {
      document.body.style.background = "var(--bg-normal)";
    }, 3000);
  }

  function safeJSON(payload){
    try { return JSON.parse(payload.toString()); }
    catch { return null; }
  }

  client.on("connect", () => {
    client.subscribe([TOPIC_MSG, TOPIC_NOTES, TOPIC_NOTES_ALERT, TOPIC_COUNTDOWN, TOPIC_ALERT], FAST);

    client.publish(TOPIC_ACK, JSON.stringify({ status: "online", room }), RELIABLE_RETAIN);

    // Estado inicial retained para o preview apanhar logo tudo
    publishState(true);
  });

  client.on("message", (topic, payload) => {
    const data = safeJSON(payload);
    if (!data) return;

    if (topic === TOPIC_MSG) {
      mainMsgEl.textContent = (data.text ?? "").toString() || " ";
      triggerMainAlert();
      publishState();
      return;
    }

    if (topic === TOPIC_NOTES) {
      notesTextEl.textContent = (data.text ?? "").toString() || "Sem notas.";
      triggerNotesAlert();
      publishState();
      return;
    }

    if (topic === TOPIC_NOTES_ALERT) {
      triggerNotesAlert();
      publishState();
      return;
    }

    if (topic === TOPIC_COUNTDOWN) {
      const action = data.action;

      if (action === "set") {
        const sec = Number(data.seconds);
        countdownSeconds = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : null;
        renderCountdown();
        publishState();
      }
      if (action === "start") startCountdown();
      if (action === "stop") stopCountdown();
      if (action === "reset") {
        countdownSeconds = null;
        stopCountdown();
        renderCountdown();
        publishState();
      }
      return;
    }

    if (topic === TOPIC_ALERT) {
      triggerGlobalAlert();
      publishState();
    }
  });
})();
