import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";

export class GomokuPlugin implements GamePlugin {
  readonly id = "gomoku";
  private size = 15;
  private board: number[][] = Array.from({ length: 15 }, () => new Array(15).fill(0));
  private blackId: string | null = null;
  private whiteId: string | null = null;
  private blackName = "黑方";
  private whiteName = "白方";
  private currentStone = 1;
  private winnerId: string | null = null;
  private winnerName: string | null = null;
  private draw = false;
  private moveCount = 0;
  private started = false;
  private lastMove: [number, number] | null = null;

  onStart(players: Player[], _hostId: string): PluginResult {
    if (players.length < 2) return err("五子棋需要 2 名玩家");
    this.reset();
    this.blackId = players[0].id; this.whiteId = players[1].id;
    this.blackName = players[0].name; this.whiteName = players[1].name;
    this.started = true;
    return ok({ system: `开局 · ${this.blackName} 执黑 vs ${this.whiteName} 执白 · 黑先` });
  }

  onAction(playerId: string, payload: any): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.winnerId || this.draw) return err("对局已结束");
    const expected = this.currentStone === 1 ? this.blackId : this.whiteId;
    if (playerId !== expected) return err("还没轮到你");
    if (payload.x == null || payload.y == null) return err("缺少坐标");
    const x = payload.x | 0, y = payload.y | 0;
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return err("坐标越界");
    if (this.board[y][x] !== 0) return err("此处已有棋子");
    this.board[y][x] = this.currentStone;
    this.lastMove = [x, y];
    this.moveCount++;
    const moverName = this.currentStone === 1 ? this.blackName : this.whiteName;
    if (this.checkWin(x, y, this.currentStone)) {
      this.winnerId = playerId; this.winnerName = moverName;
      return ok({ finished: true, system: `🏆 ${moverName} 五子连珠，胜出！` });
    }
    if (this.moveCount >= this.size * this.size) {
      this.draw = true;
      return ok({ finished: true, system: `满盘和棋 · ${this.blackName} 与 ${this.whiteName} 战平` });
    }
    this.currentStone = this.currentStone === 1 ? 2 : 1;
    return ok({});
  }

  snapshot(): any {
    return {
      board: this.board, size: this.size,
      blackId: this.blackId, whiteId: this.whiteId,
      blackName: this.blackName, whiteName: this.whiteName,
      currentStone: this.currentStone,
      currentPlayerId: this.currentStone === 1 ? this.blackId : this.whiteId,
      winnerId: this.winnerId, winnerName: this.winnerName,
      draw: this.draw, moveCount: this.moveCount,
      lastMove: this.lastMove
    };
  }

  isFinished(): boolean { return this.winnerId != null || this.draw; }
  reset(): void {
    this.board = Array.from({ length: 15 }, () => new Array(15).fill(0));
    this.blackId = null; this.whiteId = null; this.blackName = "黑方"; this.whiteName = "白方";
    this.currentStone = 1; this.winnerId = null; this.winnerName = null;
    this.draw = false; this.moveCount = 0; this.started = false; this.lastMove = null;
  }

  private checkWin(x: number, y: number, stone: number): boolean {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dx, dy] of dirs) {
      const count = 1 + this.countDir(x, y, dx, dy, stone) + this.countDir(x, y, -dx, -dy, stone);
      if (count >= 5) return true;
    }
    return false;
  }
  private countDir(x: number, y: number, dx: number, dy: number, stone: number): number {
    let cx = x + dx, cy = y + dy, n = 0;
    while (cx >= 0 && cx < this.size && cy >= 0 && cy < this.size && this.board[cy][cx] === stone) {
      n++; cx += dx; cy += dy;
    }
    return n;
  }
}
