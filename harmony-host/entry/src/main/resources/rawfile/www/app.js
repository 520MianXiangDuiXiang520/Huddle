(() => {
  const WEB_BUILD = "0.3.17-doudizhu";
  const boot = document.getElementById("boot");
  const gate = document.getElementById("gate");
  const gateText = document.getElementById("gateText");
  const gateRetry = document.getElementById("gateRetry");
  const app = document.getElementById("app");
  const standbyEl = document.getElementById("standby");
  const spectatorsEl = document.getElementById("spectators");
  const dockEl = document.getElementById("dock");
  const banner = document.getElementById("banner");
  const toastEl = document.getElementById("toast");
  const pendingMask = document.getElementById("pending");
  const gameRoot = document.getElementById("gameRoot");
  const boardViewport = document.getElementById("boardViewport");
  const boardStage = document.querySelector(".board-stage");
  const webverEl = document.getElementById("webver");
  const connDot = document.getElementById("connDot");
  const connText = document.getElementById("connText");
  const victoryEl = document.getElementById("victory");
  const victoryTitle = document.getElementById("victoryTitle");
  const victorySub = document.getElementById("victorySub");
  const zoomInBtn = document.getElementById("zoomIn");
  const zoomOutBtn = document.getElementById("zoomOut");
  const zoomResetBtn = document.getElementById("zoomReset");
  if (webverEl) webverEl.textContent = WEB_BUILD;

  let myId = null;
  let room = null;
  let game = null;
  let seatCount = 2;
  let booted = false;
  let gated = false;
  let toastTimer = null;
  let pendingAction = null;
  let pendingTimer = null;
  let actionResyncTimer = null;
  let awaitingActionResyncSnapshot = false;
  let actionSeq = 0;
  let zoom = 1;
  let lastShownWinner = null;
  let catalogGameId = null;
  let mountedGameId = null;
  let gameView = null;
  let mountPromise = null;
  const loadedAssets = new Set();

  function me() {
    if (!room || !room.players) return null;
    if (myId) {
      const byId = room.players.find((p) => p.id === myId);
      if (byId) return byId;
    }
    return room.players.find((p) => p.isMe) || null;
  }

  function isSpectator() {
    const self = me();
    return !self || self.role !== "player";
  }

  function isPlayer(p) {
    return !!(p && p.role === "player");
  }

  function isVisitor(p) {
    return !!(p && p.role !== "player");
  }

  function maxSeats() {
    return Number((room && room.maxPlayers) || seatCount) || 2;
  }

  function showToast(text) {
    toastEl.hidden = false;
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2400);
  }

  function setBusy(on) {
    pendingMask.hidden = !on;
  }

  function clearPendingState() {
    pendingAction = null;
    if (gameView && typeof gameView.clearPending === "function") {
      gameView.clearPending();
    }
    setBusy(false);
    clearTimeout(pendingTimer);
    clearTimeout(actionResyncTimer);
    awaitingActionResyncSnapshot = false;
  }

  function loadGameAssets(gameId) {
    if (!gameId) return Promise.reject(new Error("missing gameId"));
    if (loadedAssets.has(gameId)) return Promise.resolve();
    if (window.HuddleGames && window.HuddleGames[gameId]) {
      loadedAssets.add(gameId);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const href = `/games/${gameId}/${gameId}.css`;
      if (!document.querySelector(`link[data-huddle-game="${gameId}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.huddleGame = gameId;
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.src = `/games/${gameId}/${gameId}.js`;
      script.dataset.huddleGame = gameId;
      script.onload = () => {
        loadedAssets.add(gameId);
        resolve();
      };
      script.onerror = () => reject(new Error("load failed: " + gameId));
      document.body.appendChild(script);
    });
  }

  function sendGameAction(payload, opts = {}) {
    if (!room || room.phase !== "playing") return;
    const self = me();
    const hostCanAct = !!(self && self.isHost);
    if (isSpectator() && !hostCanAct) {
      showToast("观战中，无法操作");
      return;
    }
    if (pendingAction) return;

    const clientActionId = "a" + ++actionSeq + "_" + Date.now();
    pendingAction = { clientActionId, payload, ...opts };
    if (opts.pending && gameView && typeof gameView.setPending === "function") {
      gameView.setPending(opts.pending);
    }
    setBusy(true);
    renderGameView();

    const ok = window.HuddleWS.send({
      type: "action",
      clientActionId,
      payload,
    });
    if (!ok) {
      clearPendingState();
      renderGameView();
      showToast("未连接，请稍后");
      return;
    }

    clearTimeout(pendingTimer);
    clearTimeout(actionResyncTimer);
    actionResyncTimer = setTimeout(() => {
      if (!pendingAction || pendingAction.clientActionId !== clientActionId) return;
      // Harmony (hb=0) recovers via HTTP /sync — don't tear down the WS.
      if (new URLSearchParams(location.search).get("hb") === "0") return;
      // A healthy server acks well before this. If an implementation accepts
      // the action but stops delivering frames on this socket, replace that
      // socket and reconcile from the authoritative room/game snapshot.
      awaitingActionResyncSnapshot = true;
      window.HuddleWS.retryNow(true);
    }, 600);
    pendingTimer = setTimeout(() => {
      if (!pendingAction || pendingAction.clientActionId !== clientActionId) return;
      clearPendingState();
      renderGameView();
      showToast("响应较慢，请再点一次");
    }, 2500);
  }

  function ensureGameMounted(gameId) {
    if (!gameId || !gameRoot) return Promise.resolve();
    if (mountedGameId === gameId && gameView) return Promise.resolve();
    if (mountPromise) return mountPromise;

    mountPromise = loadGameAssets(gameId)
      .then(() => {
        const mod = window.HuddleGames && window.HuddleGames[gameId];
        if (!mod || typeof mod.mount !== "function") {
          throw new Error("game module missing: " + gameId);
        }
        gameRoot.innerHTML = "";
        gameView = mod.mount(gameRoot, {
          onAction(payload) {
            if (gameId === "gomoku" && payload && "x" in payload) {
              tryGomokuPlay(payload.x, payload.y);
              return;
            }
            sendGameAction(payload);
          },
        });
        mountedGameId = gameId;
      })
      .catch((err) => {
        console.error(err);
        showToast("游戏界面加载失败");
      })
      .finally(() => {
        mountPromise = null;
      });
    return mountPromise;
  }

  function tryGomokuPlay(x, y) {
    if (!room || room.phase !== "playing") return;
    if (isSpectator()) {
      showToast("观战中，无法落子");
      return;
    }
    if (pendingAction) return;
    if (!game || game.currentPlayerId !== myId) {
      showToast("还没轮到你");
      return;
    }
    const row = game.board && game.board[y];
    const v = row ? Number(row[x]) : 0;
    if (v === 1 || v === 2) return;

    const stone = Number(game.currentStone) === 2 ? 2 : 1;
    sendGameAction(
      { x, y },
      { pending: { x, y, stone }, x, y, stone }
    );
  }

  function renderGameView() {
    if (!gameView) return;
    const self = me();
    gameView.render(game || { empty: true }, {
      myId,
      spectator: isSpectator(),
      isHost: !!(self && self.isHost),
      players: (room && room.players) || [],
    });
  }

  // 8 hues for identicon foreground, indexed by player.color (0..7).
  const AVATAR_HUES = [
    "#0c7a5d", "#2f6fb0", "#b5662e", "#8a3fb0",
    "#b03a4a", "#3a7a3a", "#7a5a1a", "#4a5a7a",
  ];

  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // GitHub-style 5x5 symmetric identicon as an inline SVG string.
  function identicon(seed, colorIndex) {
    const h = hash32(seed);
    const fg = AVATAR_HUES[(colorIndex | 0) % AVATAR_HUES.length];
    const bits = [];
    for (let i = 0; i < 15; i++) bits.push((h >> i) & 1);
    let rects = "";
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const sx = x < 3 ? x : 4 - x;
        const on = bits[y * 3 + sx];
        if (on) {
          rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fg}"/>`;
        }
      }
    }
    return (
      '<svg viewBox="0 0 5 5" xmlns="http://www.w3.org/2000/svg" ' +
      'shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">' +
      rects + "</svg>"
    );
  }

  function playerMeta(p, phase, isTurn) {
    if (!p) return "";
    if (!p.connected) return "离线";
    if (phase === "playing") {
      if (catalogGameId === "undercover") return "已入座";
      if (catalogGameId === "draw_guess") {
        if (game && !game.empty && p && p.id === game.drawerId) return "作画中";
        return "猜词中";
      }
      if (catalogGameId === "werewolf") {
        if (game && !game.empty) {
          const gp = (game.players || []).find((x) => x.id === p.id);
          if (gp) return gp.alive ? "存活" : "出局";
        }
        return "存活";
      }
      if (catalogGameId === "doudizhu") {
        if (game && !game.empty) {
          const gp = (game.players || []).find((x) => x.id === p.id);
          if (gp) return gp.isLandlord ? "地主" : "农民";
        }
        return "已入座";
      }
      return isTurn ? "行动中" : "等待中";
    }
    if (phase === "ended") return "本局结束";
    if (p.ready) return p.isHost ? "已准备 · 房主" : "已准备";
    return p.isHost ? "未准备 · 房主" : "未准备";
  }

  function buildChip(p, phase, opts) {
    const turnId = game && !game.empty ? game.currentPlayerId : null;
    const isTurn = !!(p && turnId && p.id === turnId && phase === "playing");
    const el = document.createElement("div");
    el.className =
      "pchip" +
      (p && p.id === myId ? " mine" : "") +
      (p && !p.connected ? " offline" : "") +
      (isTurn ? " turn" : "") +
      (opts && opts.placeholder ? " placeholder" : "");

    const avatar = document.createElement("span");
    avatar.className = "pchip-avatar";
    if (p) {
      avatar.innerHTML = identicon(p.id, p.color);
    } else {
      avatar.textContent = "";
    }
    el.appendChild(avatar);

    if (p && p.ready && phase === "lobby") {
      const badge = document.createElement("span");
      badge.className = "pchip-badge";
      badge.setAttribute("aria-label", "已准备");
      badge.textContent = "✓";
      el.appendChild(badge);
    }

    const name = document.createElement("span");
    name.className = "pchip-name";
    name.textContent = p ? p.name : "空位";
    el.appendChild(name);

    if (p) {
      const meta = document.createElement("span");
      meta.className = "pchip-meta";
      meta.textContent = playerMeta(p, phase, isTurn);
      el.appendChild(meta);
      el.setAttribute(
        "aria-label",
        `${p.name}，${playerMeta(p, phase, isTurn)}` +
          (p.isHost ? "，房主" : "")
      );
    } else {
      el.setAttribute("aria-label", "空位");
    }
    return el;
  }

  function renderLobby() {
    const players = (room && room.players) || [];
    const phase = room ? room.phase : "lobby";
    const seats = maxSeats();
    const bySeat = new Map();
    players.forEach((p) => {
      if (p.role !== "player") return;
      if (p.seat === null || p.seat === undefined) return;
      const s = Number(p.seat);
      if (Number.isFinite(s) && s >= 0) bySeat.set(s, p);
    });

    if (standbyEl) {
      standbyEl.innerHTML = "";
      for (let s = 0; s < seats; s++) {
        const p = bySeat.get(s);
        // Show empty placeholders only in lobby; during play, list seated only.
        if (p) {
          standbyEl.appendChild(buildChip(p, phase));
        } else if (phase === "lobby") {
          standbyEl.appendChild(buildChip(null, phase, { placeholder: true }));
        }
      }
    }

    if (spectatorsEl) {
      spectatorsEl.innerHTML = "";
      const visitors = players.filter(isVisitor);
      if (visitors.length) {
        visitors.forEach((p) => spectatorsEl.appendChild(buildChip(p, phase)));
      } else {
        const empty = document.createElement("p");
        empty.className = "seats-empty";
        empty.textContent = "暂无观战者";
        spectatorsEl.appendChild(empty);
      }
    }
  }

  function addBtn(text, cls, onClick, opts = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + (cls || "");
    b.textContent = text;
    if (opts.disabled) b.disabled = true;
    if (opts.title) b.title = opts.title;
    b.addEventListener("click", onClick);
    dockEl.appendChild(b);
  }

  function renderDock() {
    const self = me();
    const phase = room ? room.phase : "lobby";
    dockEl.innerHTML = "";
    if (!self) {
      dockEl.hidden = true;
      return;
    }

    if (phase === "lobby") {
      if (isPlayer(self)) {
        addBtn("观战", "ghost", () => window.HuddleWS.send({ type: "leaveGame" }));
        addBtn(
          self.ready ? "取消准备" : "准备",
          self.ready ? "ghost" : "primary",
          () => window.HuddleWS.send({ type: "ready", ready: !self.ready })
        );
      } else {
        const seated = ((room && room.players) || []).filter(isPlayer);
        const full = seated.length >= maxSeats();
        addBtn(
          full ? "入席（已满）" : "入席",
          "primary",
          () => window.HuddleWS.send({ type: "joinGame" }),
          { disabled: full, title: full ? "备战席人数已满，可先观战等待空位" : "" }
        );
      }
      if (self.isHost) {
        const seated = ((room && room.players) || []).filter(isPlayer);
        const minP = (room && room.minPlayers) || 2;
        const readyCount = seated.filter((p) => p.ready && p.connected).length;
        const canStart =
          seated.length >= minP &&
          seated.every((p) => p.ready && p.connected);
        addBtn(
          canStart ? "开始" : `开始（${readyCount}/${Math.max(minP, seated.length)}）`,
          "primary",
          () => window.HuddleWS.send({ type: "start" }),
          { disabled: !canStart }
        );
      }
    } else if (phase === "ended") {
      if (self.isHost) {
        addBtn("再来一局", "primary", () => {
          window.HuddleWS.send({ type: "rematch" });
          game = null;
          lastShownWinner = null;
          hideVictory();
          render();
        });
      } else {
        addBtn("等待房主再开一局", "ghost", () => {}, { disabled: true });
      }
    }

    dockEl.hidden = dockEl.childElementCount === 0;
  }

  function statusLine(spectator) {
    if (!room) return "正在连接房间";
    const phase = room.phase;
    if (phase === "lobby") {
      const seated = (room.players || []).filter(isPlayer).length;
      const minP = room.minPlayers || 2;
      if (seated < minP) return `还差 ${minP - seated} 人入备战席`;
      const waiting = (room.players || []).filter(isPlayer).filter((p) => !p.ready).length;
      if (waiting > 0) return `等待 ${waiting} 人准备`;
      return "已齐人，可由房主开始";
    }
    if (gameView && typeof gameView.describe === "function") {
      return gameView.describe(game, room.players, myId, spectator);
    }
    const mod = catalogGameId && window.HuddleGames && window.HuddleGames[catalogGameId];
    if (mod && typeof mod.describe === "function") {
      return mod.describe(game, room.players, myId, spectator);
    }
    return phase === "playing" ? "对局中" : "本局结束";
  }

  function clearSession() {
    myId = null;
    room = null;
    game = { empty: true };
    clearPendingState();
    hideVictory();
    lastShownWinner = null;
    if (standbyEl) standbyEl.innerHTML = "";
    if (spectatorsEl) spectatorsEl.innerHTML = "";
    if (dockEl) {
      dockEl.innerHTML = "";
      dockEl.hidden = true;
    }
    if (banner) {
      banner.textContent = "";
      banner.classList.remove("dead");
    }
    renderGameView();
  }

  function showGate(text) {
    gated = true;
    clearSession();
    boot.hidden = true;
    boot.style.display = "none";
    app.hidden = true;
    if (gateText) {
      gateText.textContent =
        text || "上一局已关闭。房主再次开房后，这里会自动重新加入。";
    }
    if (gate) gate.hidden = false;
  }

  function hideGate() {
    if (!gated) return;
    gated = false;
    if (gate) gate.hidden = true;
    app.hidden = false;
    app.style.display = "";
  }

  function render() {
    if (!booted || gated) return;
    renderLobby();
    renderDock();
    const spectator = isSpectator();
    if (!banner.classList.contains("dead")) {
      banner.textContent = statusLine(spectator);
    }
    renderGameView();
    updateVictory();
  }

  function finishBoot() {
    if (gated) return;
    if (booted) return;
    booted = true;
    boot.hidden = true;
    boot.style.display = "none";
    app.hidden = false;
    app.style.display = "";
    render();
  }

  if (gateRetry) {
    gateRetry.addEventListener("click", () => {
      if (gateText) gateText.textContent = "正在尝试重新连接…";
      window.HuddleWS.retryNow();
    });
  }

  function applyCatalogGameId(id) {
    if (!id || id === "null") return;
    catalogGameId = id;
    ensureGameMounted(id).then(() => render());
  }

  window.HuddleWS.onMessage((msg) => {
    if (msg.type === "roomClosed") {
      showGate(msg.text || "房主已结束房间。等待房主开启新游戏。");
      return;
    }
    if (msg.type === "_status") {
      if (msg.resynced) {
        // Keep the pending mask until the reconnect's ntf_game snapshot proves
        // the authoritative state has arrived.
        return;
      }
      if (gated) {
        if (msg.ok && gateText) {
          gateText.textContent = "已连上服务器，正在进入房间…";
        }
        return;
      }
      if (!msg.ok) {
        banner.textContent = msg.text || "连接中";
        banner.classList.add("dead");
        if (connDot) connDot.classList.add("dead");
        if (connText) connText.textContent = msg.dead ? "已中断" : "重连中";
      } else {
        banner.classList.remove("dead");
        if (connDot) connDot.classList.remove("dead");
        if (connText) connText.textContent = "已连接";
        render();
      }
      return;
    }
    if (msg.type === "welcome") {
      myId = msg.playerId;
      if (msg.maxPlayers) seatCount = msg.maxPlayers;
      if (msg.gameId) applyCatalogGameId(msg.gameId);
      return;
    }
    if (msg.type === "ntf_room") {
      hideGate();
      room = msg;
      if (msg.me) myId = msg.me;
      if (msg.maxPlayers) seatCount = msg.maxPlayers;
      if (msg.gameId) applyCatalogGameId(msg.gameId);
      if (msg.phase === "lobby" && (!game || game.empty)) {
        game = { empty: true };
      }
      finishBoot();
      render();
      return;
    }
    if (msg.type === "ntf_game") {
      if (gated) return;
      if (msg.gameId) applyCatalogGameId(msg.gameId);
      game = msg.empty ? { empty: true } : msg;
      if (awaitingActionResyncSnapshot) {
        clearPendingState();
      }
      if (
        pendingAction &&
        !msg.empty &&
        gameView &&
        typeof gameView.syncPendingFromGame === "function" &&
        gameView.syncPendingFromGame(msg, pendingAction)
      ) {
        clearPendingState();
      }
      finishBoot();
      render();
      return;
    }
    if (msg.type === "ntf_system") {
      if (!gated) showToast(msg.text || "");
      return;
    }
    if (msg.type === "actionAck") {
      if (gated) return;
      if (!pendingAction || pendingAction.clientActionId !== msg.clientActionId) return;
      if (!msg.ok) {
        clearPendingState();
        renderGameView();
        if (msg.text) showToast(msg.text);
      } else if (catalogGameId === "undercover") {
        clearPendingState();
      }
      return;
    }
    if (msg.type === "error") {
      if (!gated) showToast(msg.text || "错误");
    }
  });

  function applyZoom() {
    if (zoom < 0.6) zoom = 0.6;
    if (zoom > 3) zoom = 3;
    if (boardStage) boardStage.style.transform = `scale(${zoom})`;
  }
  function setZoom(v) {
    zoom = v;
    applyZoom();
  }

  if (zoomInBtn) zoomInBtn.addEventListener("click", () => setZoom(zoom + 0.2));
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => setZoom(zoom - 0.2));
  if (zoomResetBtn) zoomResetBtn.addEventListener("click", () => setZoom(1));

  if (boardViewport) {
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    function dist(t1, t2) {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    }
    boardViewport.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = dist(e.touches[0], e.touches[1]);
        pinchStartZoom = zoom;
      }
    }, { passive: true });
    boardViewport.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        setZoom(pinchStartZoom * (dist(e.touches[0], e.touches[1]) / pinchStartDist));
      }
    }, { passive: true });
    boardViewport.addEventListener("touchend", () => {
      pinchStartDist = 0;
    }, { passive: true });
    boardViewport.addEventListener("wheel", (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
      }
    }, { passive: false });
  }

  function updateVictory() {
    if (!gameView || !gameView.handlesVictory) {
      lastShownWinner = null;
      hideVictory();
      return;
    }
    if (!game || game.empty) {
      lastShownWinner = null;
      hideVictory();
      return;
    }
    if (game.draw) {
      // Already shown (or user dismissed) — /sync must not re-open the overlay.
      if (lastShownWinner === "draw") return;
      lastShownWinner = "draw";
      showVictory("和棋", "满盘战平");
      return;
    }
    if (game.winnerId) {
      if (lastShownWinner === game.winnerId) return;
      lastShownWinner = game.winnerId;
      const winnerName = game.winnerName || nameOf(game.winnerId);
      const stone = game.winnerId === game.blackId ? "黑" : "白";
      const mine = game.winnerId === myId;
      showVictory(mine ? "你赢了" : `${winnerName} 获胜`, `执${stone} · 五子连珠`);
    } else {
      lastShownWinner = null;
      hideVictory();
    }
  }

  function showVictory(title, sub) {
    if (!victoryEl) return;
    victoryTitle.textContent = title;
    victorySub.textContent = sub || "";
    victoryEl.hidden = false;
  }

  function hideVictory() {
    if (!victoryEl) return;
    victoryEl.hidden = true;
    // Keep lastShownWinner so HTTP /sync (every 400ms) does not pop the same
    // result again after the user dismisses. Cleared when the game resets.
  }

  if (victoryEl) victoryEl.addEventListener("click", hideVictory);

  function nameOf(id) {
    const p = ((room && room.players) || []).find((x) => x.id === id);
    return p ? p.name : "玩家";
  }

  setTimeout(finishBoot, 4000);
  window.HuddleWS.connect();
})();
