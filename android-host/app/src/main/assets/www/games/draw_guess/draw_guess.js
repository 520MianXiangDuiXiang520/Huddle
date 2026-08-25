(() => {
  const COLORS = ["#1a1a1a", "#c0392b", "#2980b9", "#27ae60", "#f39c12"];
  const DEFAULT_WIDTH = 0.014;
  const FLUSH_MS = 48;
  const MAX_BATCH = 48;

  function describe(game, players, myId, spectator) {
    if (!game || game.empty) return "等待开局 · 入座后由房主开始";
    if (game.phase === "ended") {
      if (game.skipped) return "已跳过 · 答案已揭晓";
      if (game.winnerName) return `${game.winnerName} 猜对了`;
      return "本局结束";
    }
    if (spectator) return "观战中 · 你画我猜";
    if (myId && game.drawerId === myId) {
      return game.secretWord ? `你来画 · ${game.secretWord}` : "你来画";
    }
    const name = game.drawerName || "画家";
    return `${name} 作画中 · 输入你的猜测`;
  }

  function mount(root, { onAction }) {
    root.className = "dg-root";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "你画我猜");
    root.innerHTML = `
      <div class="dg-shell">
        <section class="dg-status" aria-live="polite">
          <p class="dg-eyebrow" id="dgEyebrow">你画我猜</p>
          <p class="dg-title" id="dgTitle">等待开局</p>
          <p class="dg-hint" id="dgHint">全员入座并准备后，由房主开始。</p>
        </section>
        <div class="dg-board-wrap" id="dgBoardWrap">
          <canvas class="dg-canvas" id="dgCanvas" aria-label="画布"></canvas>
        </div>
        <div class="dg-tools" id="dgTools" hidden>
          <div class="dg-colors" id="dgColors" role="group" aria-label="画笔颜色"></div>
          <button type="button" class="dg-btn" id="dgUndo">撤销</button>
          <button type="button" class="dg-btn" id="dgClear">清屏</button>
          <button type="button" class="dg-btn danger" id="dgSkip">跳过</button>
        </div>
        <form class="dg-guess-bar" id="dgGuessBar" hidden>
          <input
            class="dg-guess-input"
            id="dgGuessInput"
            type="text"
            maxlength="32"
            autocomplete="off"
            enterkeyhint="send"
            aria-label="猜测词语"
            placeholder="输入你的猜测"
          />
          <button type="submit" class="dg-guess-send" id="dgGuessSend">猜</button>
        </form>
        <div class="dg-feed" id="dgFeed" aria-live="polite" aria-label="猜测记录"></div>
        <section class="dg-result" id="dgResult" hidden>
          <p class="dg-result-label">答案</p>
          <p class="dg-result-word" id="dgResultWord">—</p>
          <p class="dg-result-detail" id="dgResultDetail"></p>
        </section>
      </div>
    `;

    const titleEl = root.querySelector("#dgTitle");
    const hintEl = root.querySelector("#dgHint");
    const eyebrowEl = root.querySelector("#dgEyebrow");
    const canvas = root.querySelector("#dgCanvas");
    const wrap = root.querySelector("#dgBoardWrap");
    const tools = root.querySelector("#dgTools");
    const colorsEl = root.querySelector("#dgColors");
    const undoBtn = root.querySelector("#dgUndo");
    const clearBtn = root.querySelector("#dgClear");
    const skipBtn = root.querySelector("#dgSkip");
    const guessBar = root.querySelector("#dgGuessBar");
    const guessInput = root.querySelector("#dgGuessInput");
    const feedEl = root.querySelector("#dgFeed");
    const resultEl = root.querySelector("#dgResult");
    const resultWord = root.querySelector("#dgResultWord");
    const resultDetail = root.querySelector("#dgResultDetail");
    const ctx2d = canvas.getContext("2d");

    let color = COLORS[0];
    let serverStrokes = [];
    let pendingSent = [];
    let livePoints = [];
    let drawing = false;
    let canDraw = false;
    let flushTimer = null;
    let lastGame = null;
    let lastCtx = null;
    let dpr = 1;

    COLORS.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dg-color" + (c === color ? " is-active" : "");
      btn.style.setProperty("--c", c);
      btn.setAttribute("aria-label", "颜色 " + c);
      btn.addEventListener("click", () => {
        color = c;
        colorsEl.querySelectorAll(".dg-color").forEach((el) => {
          el.classList.toggle("is-active", el === btn);
        });
      });
      colorsEl.appendChild(btn);
    });

    function resizeCanvas() {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    }

    function normFromEvent(ev) {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      return {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
    }

    function strokeWidthPx(normW, width) {
      return Math.max(1.5, (normW || DEFAULT_WIDTH) * width);
    }

    function drawStroke(stroke, cssW, cssH) {
      const pts = stroke.points || [];
      if (!pts.length) return;
      ctx2d.strokeStyle = stroke.color || "#1a1a1a";
      ctx2d.lineWidth = strokeWidthPx(stroke.width, cssW);
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      ctx2d.beginPath();
      ctx2d.moveTo(pts[0].x * cssW, pts[0].y * cssH);
      for (let i = 1; i < pts.length; i++) {
        ctx2d.lineTo(pts[i].x * cssW, pts[i].y * cssH);
      }
      if (pts.length === 1) {
        ctx2d.lineTo(pts[0].x * cssW + 0.01, pts[0].y * cssH);
      }
      ctx2d.stroke();
    }

    function paint() {
      const cssW = canvas.clientWidth || 1;
      const cssH = canvas.clientHeight || 1;
      ctx2d.clearRect(0, 0, cssW, cssH);
      serverStrokes.forEach((s) => drawStroke(s, cssW, cssH));
      pendingSent.forEach((s) => drawStroke(s, cssW, cssH));
      if (livePoints.length) {
        drawStroke({ color, width: DEFAULT_WIDTH, points: livePoints }, cssW, cssH);
      }
    }

    function sendStrokePayload(points) {
      if (!points.length) return;
      const stroke = {
        color,
        width: DEFAULT_WIDTH,
        points: points.map((p) => ({ x: p.x, y: p.y })),
      };
      pendingSent.push(stroke);
      const ok =
        window.HuddleWS &&
        window.HuddleWS.send({
          type: "action",
          clientActionId: "dg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          payload: { op: "stroke", color: stroke.color, width: stroke.width, points: stroke.points },
        });
      if (!ok) {
        pendingSent.pop();
      }
      paint();
    }

    function flushLive(forceAll) {
      if (!livePoints.length) return;
      if (!forceAll && livePoints.length < 2) return;
      const take = livePoints.splice(0, Math.min(livePoints.length, MAX_BATCH));
      if (livePoints.length && take.length) {
        // Continuity: keep last point as start of next segment
        livePoints.unshift(take[take.length - 1]);
      }
      sendStrokePayload(take);
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushLive(false);
      }, FLUSH_MS);
    }

    function endStroke() {
      if (!drawing) return;
      drawing = false;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushLive(true);
      livePoints = [];
      paint();
    }

    function onPointerDown(ev) {
      if (!canDraw) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      drawing = true;
      canvas.setPointerCapture(ev.pointerId);
      livePoints = [normFromEvent(ev)];
      paint();
      ev.preventDefault();
    }

    function onPointerMove(ev) {
      if (!drawing || !canDraw) return;
      const p = normFromEvent(ev);
      const last = livePoints[livePoints.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.002 && Math.abs(last.y - p.y) < 0.002) return;
      livePoints.push(p);
      if (livePoints.length >= MAX_BATCH) {
        flushLive(false);
      } else {
        scheduleFlush();
      }
      paint();
      ev.preventDefault();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("pointerleave", (ev) => {
      if (drawing) endStroke(ev);
    });

    undoBtn.addEventListener("click", () => {
      if (typeof onAction === "function") onAction({ op: "undo" });
    });
    clearBtn.addEventListener("click", () => {
      if (typeof onAction === "function") onAction({ op: "clear" });
    });
    skipBtn.addEventListener("click", () => {
      if (typeof onAction === "function") onAction({ op: "skip" });
    });

    guessBar.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const text = (guessInput.value || "").trim();
      if (!text) return;
      if (typeof onAction === "function") onAction({ op: "guess", text });
      guessInput.value = "";
    });

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resizeCanvas()) : null;
    if (ro) ro.observe(wrap);
    else window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    function renderFeed(guesses) {
      feedEl.innerHTML = "";
      if (!guesses || !guesses.length) {
        const p = document.createElement("p");
        p.className = "dg-feed-empty";
        p.textContent = "还没有人猜 · 答案不会显示在这里";
        feedEl.appendChild(p);
        return;
      }
      guesses.forEach((g) => {
        const row = document.createElement("p");
        row.className = "dg-guess-item" + (g.correct ? " is-correct" : "");
        row.innerHTML =
          `<span class="dg-guess-name">${escapeHtml(g.name || "玩家")}</span>` +
          `<span class="dg-guess-text">${escapeHtml(g.correct ? "猜对了！" : g.text || "")}</span>`;
        feedEl.appendChild(row);
      });
      feedEl.scrollTop = feedEl.scrollHeight;
    }

    function render(game, ctx) {
      lastGame = game;
      lastCtx = ctx || {};
      const spectator = !!(ctx && ctx.spectator);
      const myId = ctx && ctx.myId;
      const empty = !game || game.empty;

      if (empty) {
        canDraw = false;
        serverStrokes = [];
        pendingSent = [];
        livePoints = [];
        tools.hidden = true;
        guessBar.hidden = true;
        resultEl.hidden = true;
        canvas.classList.add("is-readonly");
        eyebrowEl.textContent = "你画我猜";
        titleEl.textContent = "等待开局";
        hintEl.textContent = "全员入座并准备后，由房主开始。";
        renderFeed([]);
        paint();
        return;
      }

      const ended = game.phase === "ended";
      const isDrawer = !!(myId && game.drawerId === myId);
      const nextStrokes = Array.isArray(game.strokes) ? game.strokes : [];
      if (nextStrokes.length < serverStrokes.length) {
        // clear / undo / rematch shrinks history — drop local echoes
        pendingSent = [];
      } else if (nextStrokes.length >= serverStrokes.length + pendingSent.length) {
        pendingSent = [];
      } else if (nextStrokes.length > serverStrokes.length) {
        const confirmed = nextStrokes.length - serverStrokes.length;
        pendingSent.splice(0, Math.min(confirmed, pendingSent.length));
      }
      serverStrokes = nextStrokes;

      canDraw = !ended && isDrawer && !spectator;
      canvas.classList.toggle("is-readonly", !canDraw);
      tools.hidden = !canDraw;
      guessBar.hidden = ended || spectator || isDrawer;
      resultEl.hidden = !ended;

      if (ended) {
        eyebrowEl.textContent = "本局结束";
        titleEl.textContent = game.skipped ? "画家跳过了" : game.winnerName ? `${game.winnerName} 猜对了` : "结束";
        hintEl.textContent = "房主可以再来一局";
        resultWord.textContent = game.word || "—";
        resultDetail.textContent = game.skipped
          ? "没有人猜中"
          : game.winnerName
            ? `由 ${game.winnerName} 猜中`
            : "";
      } else if (isDrawer && !spectator) {
        eyebrowEl.textContent = "你是画家";
        titleEl.textContent = game.secretWord || "—";
        hintEl.textContent = "请勿把词语给别人看 · 画完等大家来猜，也可跳过";
      } else if (spectator) {
        eyebrowEl.textContent = "观战中";
        titleEl.textContent = `${game.drawerName || "画家"} 正在作画`;
        hintEl.textContent = "入座后才能猜词";
      } else {
        eyebrowEl.textContent = "猜词";
        titleEl.textContent = `${game.drawerName || "画家"} 正在作画`;
        hintEl.textContent = "看图输入词语 · 猜对即结束";
      }

      renderFeed(game.guesses || []);
      paint();
    }

    return {
      render,
      describe,
      clearPending() {},
      setPending() {},
      handlesVictory: false,
      syncPendingFromGame() {
        return false;
      },
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.HuddleGames = window.HuddleGames || {};
  window.HuddleGames.draw_guess = { mount, describe };
})();
