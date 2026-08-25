(() => {
  const RANK_STR = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
  const SUITS = ["♠","♥","♦","♣"];

  function rankOf(c) { if (c === 52) return 13; if (c === 53) return 14; return Math.floor(c / 4); }

  function cardLabel(c) {
    if (c === 52) return "小王";
    if (c === 53) return "大王";
    return SUITS[c % 4] + RANK_STR[Math.floor(c / 4)];
  }

  function cardColor(c) {
    if (c === 52 || c === 53) return "is-joker";
    return (c % 4 === 1 || c % 4 === 2) ? "is-red" : "";
  }

  function describe(game, players, myId, spectator) {
    if (!game || game.empty) return "等待开局 · 3 人入座后由房主开始";
    if (game.phase === "ended") return game.winnerSide === "landlord" ? "地主胜利" : "农民胜利";
    if (game.phase === "bid") return "叫分阶段";
    return "出牌中";
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function mount(root, { onAction }) {
    root.className = "ddz-root";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "斗地主");
    root.innerHTML = `
      <div class="ddz-shell">
        <section class="ddz-hero" id="ddzHero"></section>
        <section class="ddz-opp-row" id="ddzOpp"></section>
        <section class="ddz-last" id="ddzLast" hidden></section>
        <section class="ddz-hand-wrap" id="ddzHandWrap" hidden></section>
        <section class="ddz-actions" id="ddzActions" hidden></section>
        <section class="ddz-result" id="ddzResult" hidden></section>
      </div>
    `;
    const hero = root.querySelector("#ddzHero");
    const opp = root.querySelector("#ddzOpp");
    const lastEl = root.querySelector("#ddzLast");
    const handWrap = root.querySelector("#ddzHandWrap");
    const actions = root.querySelector("#ddzActions");
    const result = root.querySelector("#ddzResult");
    let selected = new Set();
    let currentMyId = null;

    function send(p) { if (typeof onAction === "function") onAction(p); }

    function render(game, ctx) {
      const empty = !game || game.empty;
      currentMyId = ctx && ctx.myId ? ctx.myId : null;
      if (empty) {
        hero.innerHTML = `<p class="ddz-eyebrow">斗地主</p><p class="ddz-phase">等待开局</p><p class="ddz-hint">3 人入座并准备后，由房主开始。</p>`;
        hide(opp); hide(lastEl); hide(handWrap); hide(actions); hide(result);
        return;
      }
      if (game.phase === "ended") { renderEnded(game); return; }
      renderHero(game);
      renderOpp(game);
      renderLast(game);
      renderHand(game);
      renderActions(game, ctx);
      hide(result);
    }

    function renderHero(game) {
      let phase = game.phase === "bid" ? "叫分阶段" : "出牌阶段";
      let hint = "";
      const me = (game.players || []).find((p) => p.id === currentMyId);
      if (game.phase === "bid") {
        hint = game.currentTurnId === currentMyId ? "轮到你叫分" : "等待其他人叫分";
      } else {
        hint = game.currentTurnId === currentMyId ? "轮到你出牌" : "等待其他人出牌";
      }
      hero.innerHTML = `<p class="ddz-eyebrow">斗地主</p><p class="ddz-phase">${escapeHtml(phase)}</p><p class="ddz-hint">${escapeHtml(hint)}</p>`;
    }

    function renderOpp(game) {
      const items = (game.players || []).map((p) => {
        const isTurn = p.id === game.currentTurnId;
        const landlord = p.isLandlord ? `<span class="ddz-opp-landlord">地主</span> ` : "";
        const bid = game.bids && game.bids[p.id] != null ? `叫 ${game.bids[p.id]} 分` : "";
        return `<div class="ddz-opp ${isTurn ? "is-turn" : ""}">
          <span class="ddz-opp-name">${landlord}${escapeHtml(p.name)}</span>
          <span class="ddz-opp-meta">手牌 ${p.cardCount} 张${bid ? " · " + bid : ""}</span>
        </div>`;
      }).join("");
      opp.innerHTML = items;
      show(opp);
    }

    function renderLast(game) {
      const lp = game.lastPlay;
      if (!lp || !lp.cards) { hide(lastEl); return; }
      const name = (game.players || []).find((p) => p.id === lp.playerId);
      const cards = lp.cards.map((c) => `<span class="ddz-card ${cardColor(c)}">${escapeHtml(cardLabel(c))}</span>`).join("");
      lastEl.innerHTML = `<p class="ddz-last-title">上家出牌 · ${escapeHtml(name ? name.name : "玩家")}</p><div class="ddz-last-cards">${cards}</div>`;
      show(lastEl);
    }

    function renderHand(game) {
      const hand = game.myHand || [];
      const sorted = [...hand].sort((a,b) => rankOf(a) - rankOf(b) || a - b);
      const cards = sorted.map((c) => {
        const sel = selected.has(c) ? "selected" : "";
        return `<button type="button" class="ddz-card ${cardColor(c)} ${sel}" data-card="${c}">${escapeHtml(cardLabel(c))}</button>`;
      }).join("");
      handWrap.innerHTML = `<p class="ddz-hand-title">你的手牌（${hand.length} 张）</p><div class="ddz-hand">${cards}</div>`;
      show(handWrap);
      handWrap.querySelectorAll(".ddz-card[data-card]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const c = Number(btn.getAttribute("data-card"));
          if (selected.has(c)) selected.delete(c); else selected.add(c);
          btn.classList.toggle("selected");
        });
      });
    }

    function renderActions(game, ctx) {
      const isMyTurn = game.currentTurnId === currentMyId;
      if (game.phase === "bid") {
        if (!isMyTurn) { hide(actions); return; }
        const cur = game.bidValue || 0;
        const opts = [1,2,3].filter((v) => v > cur).map((v) =>
          `<button type="button" class="btn primary" data-bid="${v}">${v} 分</button>`
        ).join("");
        actions.innerHTML = `<div class="ddz-bid-row">${opts}<button type="button" class="btn ghost" data-bid="0">不叫</button></div>`;
        show(actions);
        actions.querySelectorAll("[data-bid]").forEach((b) => {
          b.addEventListener("click", () => {
            send({ op: "bid", value: Number(b.getAttribute("data-bid")) });
            selected.clear();
          });
        });
        return;
      }
      // play
      if (!isMyTurn) { hide(actions); return; }
      const canPass = game.lastPlay != null;
      actions.innerHTML = `
        <button type="button" class="btn primary" data-act="play">出牌</button>
        <button type="button" class="btn ghost" data-act="pass" ${canPass ? "" : "disabled"}>不要</button>
      `;
      show(actions);
      actions.querySelector('[data-act="play"]').addEventListener("click", () => {
        if (selected.size === 0) return;
        send({ op: "play", cards: Array.from(selected) });
        selected.clear();
      });
      actions.querySelector('[data-act="pass"]').addEventListener("click", () => {
        send({ op: "pass" });
        selected.clear();
      });
    }

    function renderEnded(game) {
      hide(opp); hide(lastEl); hide(handWrap); hide(actions);
      const side = game.winnerSide === "landlord" ? "地主胜利" : "农民胜利";
      const cls = game.winnerSide === "landlord" ? "is-landlord" : "is-peasant";
      const winner = (game.players || []).find((p) => p.id === game.winnerId);
      result.innerHTML = `<p class="ddz-result-title ${cls}">${escapeHtml(side)}</p><p class="ddz-hint">${escapeHtml(winner ? winner.name : "")} 出完牌</p>`;
      show(result);
    }

    function show(el) { if (el) el.hidden = false; }
    function hide(el) { if (el) el.hidden = true; }

    return {
      render, describe,
      clearPending() {},
      setPending() {},
      handlesVictory: false,
      syncPendingFromGame() { return true; },
    };
  }

  window.HuddleGames = window.HuddleGames || {};
  window.HuddleGames.doudizhu = { mount, describe };
})();
