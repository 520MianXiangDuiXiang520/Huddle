(() => {
  function describe(game, players, myId, spectator) {
    if (!game || game.empty) return "等待开局 · 入座后由房主发牌";
    if (game.phase === "revealed") return "身份已揭晓";
    if (spectator) return "观战中 · 词语已发放";
    if (game.myWord) return "已拿到词语 · 线下讨论后由房主揭晓";
    return "词语发放中";
  }

  function mount(root, { onAction }) {
    root.className = "uc-root";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "谁是卧底");
    root.innerHTML = `
      <div class="uc-shell">
        <section class="uc-hero" id="ucHero">
          <p class="uc-eyebrow" id="ucEyebrow">谁是卧底</p>
          <p class="uc-label" id="ucLabel">你的词语</p>
          <p class="uc-word" id="ucWord">—</p>
          <p class="uc-hint" id="ucHint"></p>
          <button type="button" class="btn primary uc-reveal" id="ucReveal" hidden>揭晓身份</button>
        </section>
        <section class="uc-result" id="ucResult" hidden>
          <header class="uc-result-head">
            <p class="uc-eyebrow">揭晓结果</p>
            <p class="uc-result-role" id="ucResultRole"></p>
          </header>
          <div class="uc-wordpair" id="ucWordPair"></div>
          <div class="uc-grid" id="ucGrid" role="list"></div>
        </section>
      </div>
    `;

    const hero = root.querySelector("#ucHero");
    const result = root.querySelector("#ucResult");
    const eyebrow = root.querySelector("#ucEyebrow");
    const label = root.querySelector("#ucLabel");
    const wordEl = root.querySelector("#ucWord");
    const hint = root.querySelector("#ucHint");
    const revealBtn = root.querySelector("#ucReveal");
    const resultRole = root.querySelector("#ucResultRole");
    const wordPair = root.querySelector("#ucWordPair");
    const grid = root.querySelector("#ucGrid");

    revealBtn.addEventListener("click", () => {
      if (typeof onAction === "function") onAction({ op: "reveal" });
    });

    function showHero() {
      hero.hidden = false;
      result.hidden = true;
    }

    function showResult() {
      hero.hidden = true;
      result.hidden = false;
    }

    function render(game, ctx) {
      const spectator = !!(ctx && ctx.spectator);
      const isHost = !!(ctx && ctx.isHost);
      const empty = !game || game.empty;

      if (empty) {
        showHero();
        eyebrow.textContent = "谁是卧底";
        label.textContent = "等待开局";
        wordEl.textContent = "—";
        hint.textContent = "全员入座并准备后，由房主开始发牌。";
        revealBtn.hidden = true;
        return;
      }

      const revealed = game.phase === "revealed";
      const count = Number(game.undercoverCount) || 1;

      if (revealed) {
        showResult();
        const myRole = game.myRole;
        if (myRole === "undercover") {
          resultRole.textContent = `你是卧底 · 本局共 ${count} 名卧底`;
        } else if (myRole === "civilian") {
          resultRole.textContent = `你是平民 · 本局共 ${count} 名卧底`;
        } else {
          resultRole.textContent = `观战回顾 · 本局共 ${count} 名卧底`;
        }

        wordPair.innerHTML = `
          <article class="uc-pair-card">
            <p class="uc-pair-label">平民词</p>
            <p class="uc-pair-word">${escapeHtml(game.civilianWord || "—")}</p>
          </article>
          <article class="uc-pair-card uc-pair-undercover">
            <p class="uc-pair-label">卧底词</p>
            <p class="uc-pair-word">${escapeHtml(game.undercoverWord || "—")}</p>
          </article>
        `;

        grid.innerHTML = "";
        (game.players || []).forEach((p) => {
          const isUc = p.role === "undercover";
          const card = document.createElement("article");
          card.className = "uc-player-card" + (isUc ? " is-undercover" : "");
          card.setAttribute("role", "listitem");
          card.innerHTML = `
            <p class="uc-player-name">${escapeHtml(p.name || "玩家")}</p>
            <p class="uc-player-role">${isUc ? "卧底" : "平民"}</p>
            <p class="uc-player-word">${escapeHtml(p.word || "")}</p>
          `;
          grid.appendChild(card);
        });
        return;
      }

      showHero();
      eyebrow.textContent = "词语已发放";
      revealBtn.hidden = !isHost;

      if (spectator && !isHost) {
        label.textContent = "观战中";
        wordEl.textContent = "···";
        hint.textContent = `本局 ${count} 名卧底 · 等待房主揭晓`;
        return;
      }

      if (spectator && isHost) {
        label.textContent = "观战中（房主）";
        wordEl.textContent = "···";
        hint.textContent = `本局 ${count} 名卧底 · 你可随时揭晓身份`;
        return;
      }

      label.textContent = "你的词语";
      wordEl.textContent = game.myWord || "—";
      hint.textContent = `本局 ${count} 名卧底 · 请勿把屏幕给别人看 · 线下讨论后由房主揭晓`;
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
  window.HuddleGames.undercover = { mount, describe };
})();
