(() => {
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "default").trim();

  // Opcional: podes passar ?broker=wss%3A%2F%2F...
  const BROKER = params.get("broker") || "wss://test.mosquitto.org:8081/mqtt";

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
    reconnectPeriod: 2000,
    connectTimeout: 8000
  });

  // ELEMENTOS
  const mainMsgEl = document.getElementById("mainMsg");
  const notesTextEl = document.getElementById("notesText");
  const notesBoxEl = document.getElementById("right");
  const clockEl = document.getElementById("clock");
  const countdownEl = document.getElementById("countdown");

  let countdownSeconds = null;
  let countdownInterval = null;

  // Debounce de publishState (evita spam)
  let stateTimer = null;
  function requestStatePublish(){
    clearTimeout(stateTimer);
    stateTimer = setTimeout(publishState, 120);
  }

  // RELÓGIO
  setInterval(() => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("pt-PT");
    requestStatePublish();
  }, 1000);

  // COUNTDOWN
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
      requestStatePublish();
    }, 1000);
  }

  function stopCountdown(){
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // ALERTAS
  function triggerMainAlert(){
    document.body.style.background = "var(--bg-alert)";
    mainMsgEl.classList.add("blink");
    setTimeout(() => {
      document.body.style.background = "var(--bg-normal)";
      mainMsgEl.classList.remove("blink");
    }, 3000);
  }

  function triggerNotesAlert(){
    notesBoxEl.classList.add("notes-bg-blink");
    setTimeout(() => notesBoxEl.classList.remove("notes-bg-blink"), 2000);
  }

  function triggerGlobalAlert(){
    document.body.style.background = "var(--bg-alert)";
    setTimeout(() => {
      document.body.style.background = "var(--bg-normal)";
    }, 3000);
  }

  // ESTADO PARA PREVIEW (retained)
  function publishState(){
    if (!client.connected) return;
    const state = {
      room,
      clock: clockEl.textContent,
      countdown: countdownEl.textContent,
      mainMsg: mainMsgEl.textContent,
      notes: notesTextEl.textContent
    };
    client.publish(TOPIC_STATE, JSON.stringify(state), { qos: 1, retain: true });
  }

  function safeJSON(payload){
    try { return JSON.parse(payload.toString()); }
    catch { return null; }
  }

  // MQTT
  client.on("connect", () => {
    client.subscribe([TOPIC_MSG, TOPIC_NOTES, TOPIC_NOTES_ALERT, TOPIC_COUNTDOWN, TOPIC_ALERT], { qos: 1 });

    // ACK retained (o control consegue ver o display “online” mesmo entrando depois)
    client.publish(TOPIC_ACK, JSON.stringify({ status: "online", room }), { qos: 1, retain: true });

    publishState();
  });

  client.on("message", (topic, payload) => {
    const data = safeJSON(payload);
    if (!data) return;

    if (topic === TOPIC_MSG) {
      mainMsgEl.textContent = (data.text ?? "").toString() || " ";
      triggerMainAlert();
      requestStatePublish();
      return;
    }

    if (topic === TOPIC_NOTES) {
      notesTextEl.textContent = (data.text ?? "").toString() || "Sem notas.";
      triggerNotesAlert();
      requestStatePublish();
      return;
    }

    if (topic === TOPIC_NOTES_ALERT) {
      triggerNotesAlert();
      requestStatePublish();
      return;
    }

    if (topic === TOPIC_COUNTDOWN) {
      const action = data.action;
      if (action === "set") {
        const sec = Number(data.seconds);
        countdownSeconds = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : null;
        renderCountdown();
        requestStatePublish();
      }
      if (action === "start") startCountdown();
      if (action === "stop") stopCountdown();
      if (action === "reset") {
        countdownSeconds = null;
        stopCountdown();
        renderCountdown();
        requestStatePublish();
      }
      return;
    }

    if (topic === TOPIC_ALERT) {
      triggerGlobalAlert();
      requestStatePublish();
      return;
    }
  });
})();
