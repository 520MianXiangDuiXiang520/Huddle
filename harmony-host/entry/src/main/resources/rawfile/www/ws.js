(() => {
  const listeners = new Set();
  let ws = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let watchdogTimer = null;
  let statePollTimer = null;
  let statePollInFlight = false;
  let lastServerHeartbeat = 0;
  let connectionDead = false;
  let resyncRequested = false;
  // HarmonyOS's local TCP-to-WebSocket bridge can stop delivering server
  // frames after the browser sends a heartbeat. Harmony room URLs opt out
  // (?hb=0); Android keeps WS heartbeats. Also auto-fallback if the host
  // never sends serverHeartbeat (Harmony does not).
  let pollMode = new URLSearchParams(location.search).get("hb") === "0";
  let sawServerHeartbeat = false;
  let pollFallbackTimer = null;
  /** live | waiting — waiting = room ended; soft probe only */
  let mode = "live";
  let failStreak = 0;
  // Page-lifetime fallback when localStorage is flaky or two connect() races
  // both see an empty store and would mint different ids.
  let memoryDeviceId = null;
  // Seat taken by another tab/device on this identity — never auto-reconnect.
  let sessionReplaced = false;
  let openedAt = 0;

  function deviceId() {
    const key = "huddleDeviceId";
    // Host App may pass a stable ?d=… (e.g. huddle-host). Prefer it so a flaky
    // WebView localStorage cannot mint a second host identity.
    let fromUrl = null;
    try {
      fromUrl = new URLSearchParams(location.search).get("d");
    } catch (_) {}
    if (fromUrl && fromUrl.length >= 8) {
      memoryDeviceId = fromUrl;
      try {
        localStorage.setItem(key, fromUrl);
      } catch (_) {}
      return fromUrl;
    }
    if (memoryDeviceId && memoryDeviceId.length >= 8) return memoryDeviceId;
    let id = null;
    try {
      id = localStorage.getItem(key);
    } catch (_) {}
    if (!id || id.length < 8) {
      try {
        id = sessionStorage.getItem(key);
      } catch (_) {}
    }
    // Host App identity is only valid via ?d=huddle-host. A leftover value in
    // guest browsers would steal the host seat — discard and mint a new id.
    if (id === "huddle-host") id = null;
    if (!id || id.length < 8) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
        "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    memoryDeviceId = id;
    try {
      localStorage.setItem(key, id);
    } catch (_) {}
    try {
      sessionStorage.setItem(key, id);
    } catch (_) {}
    return id;
  }

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws?d=${encodeURIComponent(deviceId())}`;
  }

  function emit(msg) {
    listeners.forEach((fn) => {
      try {
        fn(msg);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (pollMode) {
      startStatePolling();
      return;
    }
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
      }
    }, 1000);
    watchdogTimer = setInterval(() => {
      const now = Date.now();
      // Only judge liveness from serverHeartbeat once the host has proven it
      // speaks that protocol. Harmony never sends it — we fall back to pollMode.
      if (
        sawServerHeartbeat &&
        lastServerHeartbeat &&
        now - lastServerHeartbeat > 3000 &&
        !connectionDead
      ) {
        connectionDead = true;
        if (mode === "live") {
          emit({ type: "_status", text: "连接不稳定", ok: false, dead: true });
        }
      }
    }, 500);
    // Hosts that omit serverHeartbeat (Harmony) → HTTP /sync, no client HB.
    clearTimeout(pollFallbackTimer);
    pollFallbackTimer = setTimeout(() => {
      if (sawServerHeartbeat || pollMode) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pollMode = true;
      if (connectionDead) {
        connectionDead = false;
        emit({ type: "_status", text: "已连接", ok: true });
      }
      startHeartbeat();
    }, 2000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (statePollTimer) clearInterval(statePollTimer);
    if (pollFallbackTimer) clearTimeout(pollFallbackTimer);
    heartbeatTimer = null;
    watchdogTimer = null;
    statePollTimer = null;
    pollFallbackTimer = null;
    statePollInFlight = false;
  }

  // HarmonyOS fallback: its local TCP bridge accepts WebSocket actions but can
  // drop later server->browser frames. Poll the same host over ordinary HTTP,
  // which remains reliable and returns the Room's authoritative snapshots.
  function startStatePolling() {
    const poll = () => {
      if (statePollInFlight || !ws || ws.readyState !== WebSocket.OPEN) return;
      statePollInFlight = true;
      const ac =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const abortTimer = ac
        ? setTimeout(() => {
            try {
              ac.abort();
            } catch (_) {}
          }, 2000)
        : null;
      fetch(`/sync?d=${encodeURIComponent(deviceId())}`, {
        cache: "no-store",
        signal: ac ? ac.signal : undefined,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((snapshot) => {
          if (!snapshot) return;
          // Successful HTTP sync proves the host is reachable.
          lastServerHeartbeat = Date.now();
          if (connectionDead) {
            connectionDead = false;
            emit({ type: "_status", text: "已连接", ok: true });
          }
          if (snapshot.room) emit(snapshot.room);
          if (snapshot.game) emit(snapshot.game);
        })
        .catch(() => {})
        .finally(() => {
          if (abortTimer) clearTimeout(abortTimer);
          statePollInFlight = false;
        });
    };
    poll();
    statePollTimer = setInterval(poll, 400);
  }

  function clearReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(delayMs) {
    clearReconnect();
    reconnectTimer = setTimeout(connect, delayMs);
  }

  function enterWaiting(text) {
    if (mode === "waiting") {
      emit({
        type: "roomClosed",
        text: text || "等待房主开启新游戏",
        waiting: true,
      });
      return;
    }
    mode = "waiting";
    failStreak = 0;
    connectionDead = true;
    stopHeartbeat();
    clearReconnect();
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch (_) {}
      ws = null;
    }
    emit({
      type: "roomClosed",
      text: text || "房主已结束房间",
      waiting: true,
    });
    // Soft probe so guests can rejoin when host opens again.
    scheduleReconnect(5000);
  }

  function leaveWaiting() {
    if (mode !== "waiting") return;
    mode = "live";
    failStreak = 0;
    connectionDead = false;
  }

  function stayReplaced() {
    sessionReplaced = true;
    connectionDead = true;
    stopHeartbeat();
    clearReconnect();
    emit({
      type: "_status",
      text: "连接已替换（请关闭重复页面）",
      ok: false,
      dead: true,
    });
  }

  function connect() {
    if (sessionReplaced) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (mode === "live") {
      connectionDead = false;
      emit({ type: "_status", text: "连接中…", ok: true });
    }
    const socket = new WebSocket(wsUrl());
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      openedAt = Date.now();
      lastServerHeartbeat = Date.now();
      // Do not reset failStreak here — open→replace loops must accumulate.
      // welcome / ntf_room clear it once the session is truly healthy.
      const wasWaiting = mode === "waiting";
      const wasResync = resyncRequested;
      resyncRequested = false;
      leaveWaiting();
      emit({
        type: "_status",
        text: "已连接",
        ok: true,
        resumed: wasWaiting,
        resynced: wasResync,
      });
      startHeartbeat();
    };

    socket.onclose = (ev) => {
      // Stale socket (already replaced by a newer connect on this page).
      if (ws !== socket) return;
      stopHeartbeat();
      ws = null;
      if (sessionReplaced) return;
      // Server superseded this seat — stay down to avoid replace wars.
      if (ev && (ev.code === 4000 || ev.reason === "replaced")) {
        stayReplaced();
        return;
      }
      const closedByHost =
        (ev && (ev.code === 1001 || ev.reason === "room_closed")) || mode === "waiting";

      if (mode === "waiting" || closedByHost) {
        mode = "waiting";
        emit({
          type: "roomClosed",
          text: "等待房主开启新游戏",
          waiting: true,
        });
        scheduleReconnect(6000);
        return;
      }

      const livedMs = openedAt ? Date.now() - openedAt : 0;
      failStreak += livedMs > 0 && livedMs < 1500 ? 2 : 1;
      if (failStreak >= 3) {
        enterWaiting("房间已不可用，等待房主开启新游戏");
        return;
      }
      emit({
        type: "_status",
        text: "连接断开，正在重试…",
        ok: false,
        dead: false,
      });
      scheduleReconnect(livedMs < 1500 ? 4000 : 2000);
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      if (mode === "live") {
        emit({ type: "_status", text: "连接异常", ok: false });
      }
    };

    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "sessionReplaced") {
          try {
            socket.onclose = null;
            socket.close();
          } catch (_) {}
          if (ws === socket) ws = null;
          stayReplaced();
          return;
        }
        if (msg.type === "serverHeartbeat") {
          sawServerHeartbeat = true;
          lastServerHeartbeat = Date.now();
          if (connectionDead) {
            connectionDead = false;
            emit({ type: "_status", text: "已连接", ok: true });
          }
          return;
        }
        if (msg.type === "roomClosed") {
          enterWaiting(msg.text || "房主已结束房间");
          return;
        }
        // Any room traffic counts as liveness (and clears short-lived fail streak).
        if (msg.type === "ntf_room" || msg.type === "ntf_game" || msg.type === "welcome") {
          lastServerHeartbeat = Date.now();
          failStreak = 0;
        }
        emit(msg);
      } catch {
        emit({ type: "system", text: String(ev.data) });
      }
    };
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (mode === "waiting") return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function onMessage(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function retryNow(resync) {
    if (sessionReplaced) return;
    clearReconnect();
    if (resync) resyncRequested = true;
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch (_) {}
      ws = null;
    }
    connect();
  }

  function isWaiting() {
    return mode === "waiting";
  }

  window.HuddleWS = {
    connect,
    send,
    onMessage,
    retryNow,
    isWaiting,
    enterWaiting,
  };
})();
