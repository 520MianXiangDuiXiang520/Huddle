(() => {
  const ROLE_TITLES = {
    werewolf: "狼人",
    seer: "预言家",
    witch: "女巫",
    hunter: "猎人",
    guard: "守卫",
    villager: "平民"
  };

  const ROLE_BLURB = {
    werewolf: "夜晚与同伴一起选择击杀目标",
    seer: "每晚查验一名玩家的阵营",
    witch: "拥有一瓶解药和一瓶毒药",
    hunter: "出局时可开枪带走一名玩家",
    guard: "每晚守护一名玩家免于被刀",
    villager: "没有夜晚技能，白天靠发言与投票找出狼人"
  };

  function describe(game, players, myId, spectator) {
    if (!game || game.empty) return "等待开局 · 入座后由房主开始";
    if (game.phase === "ended") {
      return game.winner === "werewolf" ? "狼人胜利" : "好人胜利";
    }
    if (game.phase === "night") return `第 ${game.round} 夜 · 夜间操作中`;
    if (game.phase === "day_announce") return `第 ${game.round} 天 · 公布昨夜情况`;
    if (game.phase === "day_vote") return `第 ${game.round} 天 · 投票放逐`;
    if (game.phase === "hunter_shot") return "猎人开枪";
    return "对局中";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mount(root, { onAction }) {
    root.className = "ww-root";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "狼人杀");
    root.innerHTML = `
      <div class="ww-shell">
        <section class="ww-hero" id="wwHero"></section>
        <section class="ww-section" id="wwRoleSection" hidden></section>
        <section class="ww-section" id="wwActionSection" hidden></section>
        <section class="ww-section" id="wwChecksSection" hidden></section>
        <section class="ww-section" id="wwReadySection" hidden></section>
        <section class="ww-result" id="wwResult" hidden></section>
      </div>
    `;

    const hero = root.querySelector("#wwHero");
    const roleSection = root.querySelector("#wwRoleSection");
    const actionSection = root.querySelector("#wwActionSection");
    const checksSection = root.querySelector("#wwChecksSection");
    const readySection = root.querySelector("#wwReadySection");
    const result = root.querySelector("#wwResult");

    let selectedTarget = null;
    let currentMyId = null;

    function send(payload) {
      if (typeof onAction === "function") onAction(payload);
    }

    function render(game, ctx) {
      const empty = !game || game.empty;
      const isHost = !!(ctx && ctx.isHost);
      const spectator = !!(ctx && ctx.spectator) && !isHost;
      currentMyId = ctx && ctx.myId ? ctx.myId : null;
      const myRole = game && !empty ? game.myRole : null;
      const myAlive = game && !empty ? game.myAlive : true;

      if (empty) {
        renderHero("狼人杀", "等待开局", "全员入座并准备后，由房主开始。");
        hide(roleSection); hide(actionSection); hide(checksSection); hide(readySection); hide(result);
        return;
      }

      if (game.phase === "ended") {
        renderEnded(game, isHost);
        return;
      }

      renderHeroState(game, isHost, spectator, myAlive);
      renderRoleCard(game, myRole, spectator);
      renderChecks(game, myRole);
      renderReady(game, isHost);
      renderActions(game, ctx, myRole, myAlive, isHost, spectator);
    }

    function renderHero(eyebrow, phase, hint) {
      hero.innerHTML = `
        <p class="ww-eyebrow">${escapeHtml(eyebrow)}</p>
        <p class="ww-phase">${escapeHtml(phase)}</p>
        <p class="ww-hint">${escapeHtml(hint)}</p>
      `;
    }

    function renderHeroState(game, isHost, spectator, myAlive) {
      let phaseText = describe(game, null, null, spectator);
      let hint = "";
      if (!myAlive && game.phase !== "ended") {
        hint = "你已出局，可继续观战但无法操作。";
      } else if (game.phase === "night") {
        hint = "请完成你的夜间操作；全部就绪后房主「天亮」。";
      } else if (game.phase === "day_announce") {
        const deaths = (game.deathsThisRound || []).map((id) => nameOf(game, id));
        hint = deaths.length ? `昨夜出局：${deaths.join("、")}` : "昨夜平安";
        hint += " · 讨论后房主「发起投票」。";
      } else if (game.phase === "day_vote") {
        hint = "选择放逐对象后提交投票，房主「结算投票」。";
      } else if (game.phase === "hunter_shot") {
        hint = "等待猎人开枪。";
      }
      renderHero("狼人杀", phaseText, hint);
    }

    function renderRoleCard(game, myRole, spectator) {
      if (!myRole || spectator) {
        if (spectator) {
          roleSection.innerHTML = `
            <p class="ww-section-title">你的身份</p>
            <div class="ww-role-card">
              <p class="ww-role-label">观战中</p>
              <p class="ww-role-blurb">你未入座，仅可观看房主推进流程。</p>
            </div>
          `;
          show(roleSection);
        } else {
          hide(roleSection);
        }
        return;
      }
      const isEvil = myRole === "werewolf";
      let extra = "";
      if (myRole === "werewolf" && game.fellowWerewolves) {
        const names = game.fellowWerewolves.map((id) => nameOf(game, id)).join("、");
        extra = `<p class="ww-fellows">同伴：${names || "（你是唯一的狼人）"}</p>`;
      }
      roleSection.innerHTML = `
        <p class="ww-section-title">你的身份</p>
        <article class="ww-role-card">
          <p class="ww-role-label">第 ${game.round} 局 · ${escapeHtml(ROLE_TITLES[myRole] || myRole)}</p>
          <p class="ww-role-name ${isEvil ? "is-evil" : "is-good"}">${escapeHtml(ROLE_TITLES[myRole] || myRole)}</p>
          <p class="ww-role-blurb">${escapeHtml(ROLE_BLURB[myRole] || "")}</p>
          ${extra}
        </article>
      `;
      show(roleSection);
    }

    function renderChecks(game, myRole) {
      if (myRole !== "seer" || !game.seerChecks || !game.seerChecks.length) {
        hide(checksSection);
        return;
      }
      const items = game.seerChecks.map((c) => {
        const cls = c.result === "evil" ? "is-evil" : "is-good";
        const label = c.result === "evil" ? "狼人" : "好人";
        return `<div class="ww-check"><span>${escapeHtml(c.name)}</span><span class="ww-check-result ${cls}">${label}</span></div>`;
      }).join("");
      checksSection.innerHTML = `
        <p class="ww-section-title">查验记录</p>
        <div class="ww-checks">${items}</div>
      `;
      show(checksSection);
    }

    function renderReady(game, isHost) {
      if (game.phase !== "night") { hide(readySection); return; }
      const nr = game.nightReady || {};
      const chips = [
        ["werewolf", "狼人"],
        ["seer", "预言家"],
        ["witch", "女巫"],
        ["guard", "守卫"]
      ].map(([k, label]) => {
        const ready = !!nr[k];
        return `<span class="ww-ready-chip ${ready ? "is-ready" : ""}">${label} ${ready ? "✓" : "…"}</span>`;
      }).join("");
      readySection.innerHTML = `
        <p class="ww-section-title">夜间就绪${isHost ? " · 房主可「天亮」" : ""}</p>
        <div class="ww-ready">${chips}</div>
      `;
      show(readySection);
    }

    function renderActions(game, ctx, myRole, myAlive, isHost, spectator) {
      selectedTarget = null;
      if (game.phase === "ended") { hide(actionSection); return; }

      if (game.phase === "night") {
        renderNightActions(game, myRole, myAlive, isHost, spectator);
      } else if (game.phase === "day_announce") {
        renderDayAnnounceActions(game, isHost, spectator);
      } else if (game.phase === "day_vote") {
        renderVoteActions(game, myAlive, isHost, spectator);
      } else if (game.phase === "hunter_shot") {
        renderHunterActions(game, ctx, isHost, spectator);
      }
    }

    function nameOf(game, id) {
      const p = (game.players || []).find((x) => x.id === id);
      return p ? p.name : "玩家";
    }

    function playerGrid(game, opts) {
      const items = (game.players || []).map((p) => {
        const dead = !p.alive;
        const disabled = dead || (opts.disable && opts.disable(p));
        const cls = ["ww-player", dead ? "is-dead" : "", disabled && !dead ? "" : ""].join(" ").trim();
        let meta = dead ? `出局·${reasonLabel(p.deathReason)}` : (opts.meta ? opts.meta(p) : "存活");
        return `<button type="button" class="${cls}" data-pid="${escapeHtml(p.id)}" ${disabled ? "disabled" : ""}>
          <span class="ww-player-name">${escapeHtml(p.name)}</span>
          <span class="ww-player-meta">${escapeHtml(meta)}</span>
        </button>`;
      }).join("");
      return `<div class="ww-grid">${items}</div>`;
    }

    function reasonLabel(r) {
      switch (r) {
        case "wolves": return "被刀";
        case "poison": return "中毒";
        case "vote": return "放逐";
        case "hunter": return "开枪";
        default: return "出局";
      }
    }

    function bindGrid(section, onPick) {
      section.querySelectorAll(".ww-player[data-pid]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          section.querySelectorAll(".ww-player").forEach((b) => b.classList.remove("is-target"));
          btn.classList.add("is-target");
          onPick(btn.getAttribute("data-pid"));
        });
      });
    }

    function actionButtons(pairs) {
      return `<div class="ww-actions">${pairs.map(([text, cls, val]) =>
        `<button type="button" class="btn ${cls}" data-act="${escapeHtml(String(val))}">${escapeHtml(text)}</button>`
      ).join("")}</div>`;
    }

    function bindActions(section, onAct) {
      section.querySelectorAll(".ww-actions .btn[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => onAct(btn.getAttribute("data-act")));
      });
    }

    function renderNightActions(game, myRole, myAlive, isHost, spectator) {
      if (!myAlive || spectator) {
        if (isHost) {
          actionSection.innerHTML = `
            <p class="ww-section-title">房主操作</p>
            ${actionButtons([["天亮", "primary", "dawn"]])}
            <p class="ww-hint">观战中（房主）· 等所有角色就绪后「天亮」结算夜晚。</p>
          `;
          show(actionSection);
          bindActions(actionSection, (a) => { if (a === "dawn") send({ op: "dawn" }); });
        } else {
          hide(actionSection);
        }
        return;
      }

      let body = "";
      let grid = "";
      switch (myRole) {
        case "werewolf": {
          if (game.wolfActed) {
            body = `<p class="ww-hint">已选择目标：${escapeHtml(nameOf(game, game.wolfTarget))} · 等其他狼人/房主天亮。</p>`;
          } else {
            body = `<p class="ww-section-title">选择今晚击杀目标</p>`;
            grid = playerGrid(game, {
              disable: (p) => p.id === ctxMyId() || game.fellowWerewolves && game.fellowWerewolves.includes(p.id)
            });
          }
          break;
        }
        case "seer": {
          if (game.seerActed) {
            body = `<p class="ww-hint">已查验，结果见「查验记录」。</p>`;
          } else {
            body = `<p class="ww-section-title">选择今晚查验目标</p>`;
            grid = playerGrid(game, { disable: (p) => p.id === ctxMyId() });
          }
          break;
        }
        case "guard": {
          if (game.guardActed) {
            body = `<p class="ww-hint">已守护，等待天亮。</p>`;
          } else {
            const last = game.guardLastTarget ? `（昨晚守了 ${escapeHtml(nameOf(game, game.guardLastTarget))}，不可重复）` : "";
            body = `<p class="ww-section-title">选择今晚守护目标${last}</p>`;
            grid = playerGrid(game, { disable: (p) => p.id === game.guardLastTarget });
          }
          break;
        }
        case "witch": {
          if (game.witchActed) {
            body = `<p class="ww-hint">已操作，等待天亮。</p>`;
          } else {
            body = renderWitchControls(game);
          }
          break;
        }
        case "villager": {
          body = `<p class="ww-hint">平民夜晚无需操作，等待天亮。</p>`;
          break;
        }
        default:
          body = `<p class="ww-hint">等待天亮。</p>`;
      }

      let hostBtn = "";
      if (isHost) {
        hostBtn = `<div class="ww-actions"><button type="button" class="btn primary" data-act="dawn">天亮</button></div>`;
      }

      actionSection.innerHTML = body + grid + hostBtn;
      show(actionSection);

      if (grid) {
        bindGrid(actionSection, (pid) => {
          if (myRole === "werewolf") send({ op: "night_action", target: pid });
          else if (myRole === "seer") send({ op: "night_action", target: pid });
          else if (myRole === "guard") send({ op: "night_action", target: pid });
        });
      }
      bindActions(actionSection, (a) => { if (a === "dawn") send({ op: "dawn" }); });

      // Witch buttons
      bindWitchButtons(game);
    }

    function renderWitchControls(game) {
      const victim = game.wolfVictimId;
      const canHeal = !game.healUsed && victim;
      const canPoison = !game.poisonUsed;
      let victimLine = victim
        ? `今晚被刀：${escapeHtml(nameOf(game, victim))}`
        : "今晚无人被刀";
      let healBtn = canHeal
        ? `<button type="button" class="btn primary" data-witch="heal">使用解药救${victim ? escapeHtml(nameOf(game, victim)) : ""}</button>`
        : `<button type="button" class="btn ghost" disabled>解药已用</button>`;
      let poisonIntro = "";
      let poisonGrid = "";
      if (canPoison) {
        poisonIntro = `<p class="ww-section-title" style="margin-top:12px">或使用毒药（二选一）</p>`;
        poisonGrid = playerGrid(game, { disable: (p) => p.id === ctxMyId() });
      }
      let passBtn = `<button type="button" class="btn ghost" data-witch="pass">今晚不操作</button>`;
      return `<p class="ww-section-title">女巫</p>
        <p class="ww-hint">${victimLine}</p>
        <div class="ww-actions">${healBtn}${passBtn}</div>
        ${poisonIntro}${poisonGrid}`;
    }

    function bindWitchButtons(game) {
      actionSection.querySelectorAll('[data-witch="heal"]').forEach((b) =>
        b.addEventListener("click", () => send({ op: "night_action", choice: "heal" }))
      );
      actionSection.querySelectorAll('[data-witch="pass"]').forEach((b) =>
        b.addEventListener("click", () => send({ op: "night_action", choice: "pass" }))
      );
      const poisonBtn = actionSection.querySelector('[data-witch="poison-confirm"]');
      if (poisonBtn) {
        poisonBtn.addEventListener("click", () => {
          if (!selectedTarget) { return; }
          send({ op: "night_action", choice: "poison", poisonTarget: selectedTarget });
        });
      }
      // Poison grid selection
      const pg = actionSection.querySelector(".ww-grid");
      if (pg) {
        bindGrid(actionSection, (pid) => { selectedTarget = pid; });
        // Add confirm button after selecting
        pg.querySelectorAll(".ww-player[data-pid]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const existing = actionSection.querySelector('[data-witch="poison-confirm"]');
            if (!existing) {
              const wrap = document.createElement("div");
              wrap.className = "ww-actions";
              wrap.style.marginTop = "8px";
              wrap.innerHTML = `<button type="button" class="btn primary" data-witch="poison-confirm">确认毒杀</button>`;
              pg.after(wrap);
              wrap.querySelector('[data-witch="poison-confirm"]').addEventListener("click", () => {
                if (!selectedTarget) return;
                send({ op: "night_action", choice: "poison", poisonTarget: selectedTarget });
              });
            }
          });
        });
      }
    }

    function renderDayAnnounceActions(game, isHost, spectator) {
      if (!isHost) {
        actionSection.innerHTML = `<p class="ww-hint">讨论阶段 · 等房主「发起投票」。</p>`;
        show(actionSection);
        return;
      }
      actionSection.innerHTML = `
        <p class="ww-section-title">房主操作</p>
        ${actionButtons([["发起投票", "primary", "start_vote"]])}
      `;
      show(actionSection);
      bindActions(actionSection, (a) => { if (a === "start_vote") send({ op: "start_vote" }); });
    }

    function renderVoteActions(game, myAlive, isHost, spectator) {
      if (!myAlive) {
        if (isHost) {
          actionSection.innerHTML = `
            <p class="ww-section-title">房主操作</p>
            ${actionButtons([["结算投票", "primary", "resolve_vote"]])}
          `;
          show(actionSection);
          bindActions(actionSection, (a) => { if (a === "resolve_vote") send({ op: "resolve_vote" }); });
        } else {
          hide(actionSection);
        }
        return;
      }

      const myVote = game.myVote;
      let votedLine = myVote ? `<p class="ww-hint">你已投：${escapeHtml(nameOf(game, myVote))} · 可改投或取消。</p>` : `<p class="ww-hint">选择放逐对象后点「确认投票」。</p>`;
      let grid = playerGrid(game, { disable: (p) => p.id === ctxMyId() });
      let voteBtns = actionButtons([
        ["确认投票", "primary", "vote"],
        ["取消投票", "ghost", "skip_vote"]
      ]);
      let hostBtn = isHost ? `<div class="ww-actions"><button type="button" class="btn primary" data-act="resolve_vote">结算投票</button></div>` : "";

      actionSection.innerHTML = votedLine + grid + voteBtns + hostBtn;
      show(actionSection);
      bindGrid(actionSection, (pid) => { selectedTarget = pid; });
      bindActions(actionSection, (a) => {
        if (a === "vote") {
          if (!selectedTarget) { return; }
          send({ op: "vote", target: selectedTarget });
        } else if (a === "skip_vote") {
          send({ op: "skip_vote" });
        } else if (a === "resolve_vote") {
          send({ op: "resolve_vote" });
        }
      });
    }

    function renderHunterActions(game, ctx, isHost, spectator) {
      const hunterId = game.pendingHunterId;
      const isHunter = ctx && ctx.myId === hunterId;
      if (!isHunter) {
        actionSection.innerHTML = `<p class="ww-hint">等待猎人开枪。</p>`;
        show(actionSection);
        return;
      }
      let grid = playerGrid(game, { disable: (p) => !p.alive || p.id === hunterId });
      let btns = actionButtons([
        ["开枪带走", "primary", "shoot"],
        ["不开枪", "ghost", "skip_shot"]
      ]);
      actionSection.innerHTML = `<p class="ww-section-title">你是猎人，选择开枪目标</p>` + grid + btns;
      show(actionSection);
      bindGrid(actionSection, (pid) => { selectedTarget = pid; });
      bindActions(actionSection, (a) => {
        if (a === "shoot") {
          if (!selectedTarget) return;
          send({ op: "shoot", target: selectedTarget });
        } else if (a === "skip_shot") {
          send({ op: "skip_shot" });
        }
      });
    }

    function renderEnded(game, isHost) {
      hide(roleSection); hide(actionSection); hide(checksSection); hide(readySection);
      const winner = game.winner || "villager";
      const title = winner === "werewolf" ? "狼人胜利" : "好人胜利";
      const cls = winner === "werewolf" ? "is-werewolf" : "is-villager";
      const roles = (game.players || []).map((p) =>
        `<div class="ww-check"><span>${escapeHtml(p.name)}</span><span class="ww-check-result ${p.role === "werewolf" ? "is-evil" : "is-good"}">${escapeHtml(ROLE_TITLES[p.role] || p.role || "—")}</span></div>`
      ).join("");
      let hostHint = isHost ? `<p class="ww-hint">房主可「再来一局」重开。</p>` : `<p class="ww-hint">等待房主再开一局。</p>`;
      result.innerHTML = `
        <p class="ww-result-title ${cls}">${escapeHtml(title)}</p>
        <div class="ww-checks">${roles}</div>
        ${hostHint}
      `;
      show(result);
    }

    function ctxMyId() {
      return currentMyId;
    }

    function show(el) { if (el) el.hidden = false; }
    function hide(el) { if (el) el.hidden = true; }

    return {
      render,
      describe,
      clearPending() { selectedTarget = null; },
      setPending() {},
      handlesVictory: false,
      syncPendingFromGame() { return true; },
    };
  }

  window.HuddleGames = window.HuddleGames || {};
  window.HuddleGames.werewolf = { mount, describe };
})();
