(() => {
  const SIZE = 15;
  /** 15路标准星位（含天元） */
  const STARS = new Set(["3,3", "3,11", "7,7", "11,3", "11,11"]);

  function createBoard(root, { onPlay }) {
    root.innerHTML = "";
    root.setAttribute("role", "grid");
    root.setAttribute("aria-label", "十五路五子棋棋盘");
    root.style.setProperty("--board-size", String(SIZE));

    const cells = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `第 ${y + 1} 行第 ${x + 1} 列`);

        const edges = [];
        if (y === 0) edges.push("edge-n");
        if (y === SIZE - 1) edges.push("edge-s");
        if (x === 0) edges.push("edge-w");
        if (x === SIZE - 1) edges.push("edge-e");
        if (edges.length) cell.classList.add(...edges);

        if (STARS.has(x + "," + y)) {
          cell.classList.add("star");
          const dot = document.createElement("span");
          dot.className = "star-dot";
          dot.setAttribute("aria-hidden", "true");
          cell.appendChild(dot);
        }

        cell.addEventListener("click", () => onPlay(x, y));
        root.appendChild(cell);
        cells.push(cell);
      }
    }

    let pending = null;

    function cellValue(board, x, y) {
      const row = board[y];
      if (row == null) return 0;
      const raw = Array.isArray(row) ? row[x] : row[String(x)];
      const v = Number(raw);
      return v === 1 || v === 2 ? v : 0;
    }

    function clearStones(cell) {
      cell.querySelectorAll(".stone").forEach((n) => n.remove());
    }

    function render(game, myId, opts = {}) {
      const board = (game && game.board) || [];
      const finished = !!(game && (game.winnerId || game.draw));
      const spectator = !!opts.spectator;
      const myTurn =
        !spectator &&
        !finished &&
        game &&
        game.currentPlayerId === myId &&
        !pending;
      root.classList.toggle("disabled", !myTurn);
      root.classList.toggle("spectator", spectator);

      const last = game && Array.isArray(game.lastMove) ? game.lastMove : null;
      const lastX = last ? Number(last[0]) : -1;
      const lastY = last ? Number(last[1]) : -1;

      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const idx = y * SIZE + x;
          const cell = cells[idx];
          clearStones(cell);
          let stoneType = cellValue(board, x, y);
          const isPending =
            pending && pending.x === x && pending.y === y && stoneType === 0;
          if (isPending) stoneType = pending.stone;
          if (stoneType !== 1 && stoneType !== 2) continue;

          const stone = document.createElement("span");
          stone.className =
            "stone " +
            (stoneType === 1 ? "black" : "white") +
            (isPending ? " pending" : "") +
            (!isPending && x === lastX && y === lastY ? " last" : "");
          cell.appendChild(stone);
        }
      }
    }

    function setPending(p) {
      pending = p;
    }

    function clearPending() {
      pending = null;
    }

    return { render, setPending, clearPending };
  }

  function describe(game, players, myId, spectator) {
    if (!game || game.empty) return "等待开局";
    const nameOf = (id) => {
      const p = (players || []).find((x) => x.id === id);
      return p ? p.name : "玩家";
    };
    if (game.draw) return "平局";
    if (game.winnerId) return `${nameOf(game.winnerId)} 获胜`;
    if (spectator) return `观战中 · ${nameOf(game.currentPlayerId)} 行棋`;
    if (game.currentPlayerId === myId) {
      return game.currentStone === 1 ? "你的回合 · 黑" : "你的回合 · 白";
    }
    return `等待 ${nameOf(game.currentPlayerId)}`;
  }

  function mount(root, { onAction }) {
    root.className = "board";
    root.setAttribute("role", "grid");
    const board = createBoard(root, {
      onPlay(x, y) {
        if (typeof onAction === "function") onAction({ x, y });
      },
    });
    return {
      render(game, ctx) {
        board.render(game, ctx && ctx.myId, {
          spectator: !!(ctx && ctx.spectator),
        });
      },
      setPending: board.setPending,
      clearPending: board.clearPending,
      describe,
      handlesVictory: true,
      syncPendingFromGame(game, pendingAction) {
        if (!pendingAction || !game || game.empty) return false;
        const row = game.board && game.board[pendingAction.y];
        const v = row ? Number(row[pendingAction.x]) : 0;
        return v === 1 || v === 2;
      },
    };
  }

  window.HuddleGomoku = { createBoard, describe };
  window.HuddleGames = window.HuddleGames || {};
  window.HuddleGames.gomoku = { mount, describe };
})();
