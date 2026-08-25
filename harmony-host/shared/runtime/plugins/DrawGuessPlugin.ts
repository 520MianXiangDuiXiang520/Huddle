import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";
import type { DrawGuessWordStore } from "../DrawGuessWordStore";

export class DrawGuessPlugin implements GamePlugin {
  readonly id = "draw_guess";
  constructor(private store: DrawGuessWordStore) {}

  private started = false;
  private finished = false;
  private phase: "drawing" | "ended" = "drawing";
  private secretWord = "";
  private drawerId: string | null = null;
  private winnerId: string | null = null;
  private skipped = false;
  private names = new Map<string, string>();
  private strokes: any[] = [];
  private guesses: any[] = [];

  onStart(players: Player[], _hostId: string): PluginResult {
    this.reset();
    if (players.length < 3) return err("你画我猜至少需要 3 人入座");
    if (players.length > 8) return err("你画我猜最多 8 人");
    const picked = this.store.pickUnused();
    if (!picked) return err("词库没有可用词语，请先在配置里添加或重新加入");
    this.secretWord = picked.word;
    this.drawerId = players[Math.floor(Math.random() * players.length)].id;
    for (const p of players) this.names.set(p.id, p.name);
    this.store.markUsed(picked.id);
    this.phase = "drawing"; this.finished = false; this.started = true;
    return ok({ system: `开局 · ${this.names.get(this.drawerId) ?? "玩家"} 来画 · 其他人猜词` });
  }

  onAction(playerId: string, payload: any): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.finished || this.phase === "ended") return err("本局已结束");
    if (!this.names.has(playerId)) return err("只有入座玩家可以操作");
    switch (payload.op) {
      case "stroke": return this.handleStroke(playerId, payload);
      case "clear": return this.handleClear(playerId);
      case "undo": return this.handleUndo(playerId);
      case "guess": return this.handleGuess(playerId, payload);
      case "skip": return this.handleSkip(playerId);
      default: return err("未知操作");
    }
  }

  private handleStroke(playerId: string, payload: any): PluginResult {
    if (playerId !== this.drawerId) return err("只有画家可以画");
    const ptsIn = payload.points;
    if (!Array.isArray(ptsIn) || ptsIn.length === 0) return err("笔迹无效");
    if (ptsIn.length > 64) return err("单段笔迹过长");
    const points = [];
    for (const p of ptsIn) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    }
    if (points.length === 0) return err("笔迹无效");
    if (this.strokes.length >= 400) return err("笔迹过多，请清屏");
    const color = sanitizeColor(payload.color || "#1a1a1a");
    const width = Math.max(0.004, Math.min(0.06, Number(payload.width ?? 0.012)));
    this.strokes.push({ color, width, points });
    return ok({});
  }
  private handleClear(playerId: string): PluginResult {
    if (playerId !== this.drawerId) return err("只有画家可以清屏");
    this.strokes = []; return ok({ system: "画布已清空" });
  }
  private handleUndo(playerId: string): PluginResult {
    if (playerId !== this.drawerId) return err("只有画家可以撤销");
    if (this.strokes.length === 0) return err("没有可撤销的笔迹");
    this.strokes.pop(); return ok({});
  }
  private handleGuess(playerId: string, payload: any): PluginResult {
    if (playerId === this.drawerId) return err("画家不能猜词");
    const text = String(payload.text || "").trim();
    if (!text) return err("请输入猜测");
    if (text.length > 32) return err("猜测过长");
    const correct = normalize(text) === normalize(this.secretWord);
    this.guesses.push({ playerId, name: this.names.get(playerId) ?? "玩家", text, correct });
    if (this.guesses.length > 80) this.guesses.shift();
    if (!correct) return ok({});
    this.winnerId = playerId; this.skipped = false; this.phase = "ended"; this.finished = true;
    return ok({ finished: true, system: `${this.names.get(playerId)} 猜对了 · 答案是「${this.secretWord}」` });
  }
  private handleSkip(playerId: string): PluginResult {
    if (playerId !== this.drawerId) return err("只有画家可以跳过");
    this.winnerId = null; this.skipped = true; this.phase = "ended"; this.finished = true;
    return ok({ finished: true, system: `画家跳过 · 答案是「${this.secretWord}」` });
  }

  snapshot(): any { return this.build(null); }
  snapshotFor(playerId: string): any { return this.build(playerId); }

  private build(viewerId: string | null): any {
    const ended = this.phase === "ended";
    const snap: any = {
      phase: this.phase, drawerId: this.drawerId,
      drawerName: this.drawerId ? (this.names.get(this.drawerId) ?? "") : "",
      strokes: this.strokes, guesses: this.guesses, finished: this.finished, skipped: this.skipped
    };
    if (ended) {
      snap.word = this.secretWord;
      snap.winnerId = this.winnerId;
      snap.winnerName = this.winnerId ? (this.names.get(this.winnerId) ?? "") : null;
    }
    if (!ended && viewerId && viewerId === this.drawerId) snap.secretWord = this.secretWord;
    return snap;
  }

  isFinished(): boolean { return this.finished; }
  reset(): void {
    this.started = false; this.finished = false; this.phase = "drawing";
    this.secretWord = ""; this.drawerId = null; this.winnerId = null; this.skipped = false;
    this.names.clear(); this.strokes = []; this.guesses = [];
  }
}

function normalize(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ""); }
function sanitizeColor(raw: string): string {
  const c = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
  return "#1a1a1a";
}
