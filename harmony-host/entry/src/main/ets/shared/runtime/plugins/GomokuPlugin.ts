import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";

interface Point { x: number; y: number; }

function buildBoard(size: number): number[][] {
  const b: number[][] = [];
  for (let i: number = 0; i < size; i++) {
    const row: number[] = [];
    for (let j: number = 0; j < size; j++) row.push(0);
    b.push(row);
  }
  return b;
}

export class GomokuPlugin implements GamePlugin {
  readonly id: string = "gomoku";
  private size: number = 15;
  private board: number[][] = buildBoard(15);
  private blackId: string | null = null;
  private whiteId: string | null = null;
  private blackName: string = "黑方";
  private whiteName: string = "白方";
  private currentStone: number = 1;
  private winnerId: string | null = null;
  private winnerName: string | null = null;
  private draw: boolean = false;
  private moveCount: number = 0;
  private started: boolean = false;
  private lastMove: Point | null = null;

  onStart(players: Player[], _hostId: string): PluginResult {
    if (players.length < 2) return err("五子棋需要 2 名玩家");
    this.reset();
    this.blackId = players[0].id; this.whiteId = players[1].id;
    this.blackName = players[0].name; this.whiteName = players[1].name;
    this.started = true;
    return ok({ system: `开局 · ${this.blackName} 执黑 vs ${this.whiteName} 执白 · 黑先` });
  }

  onAction(playerId: string, payload: ESObject): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.winnerId != null || this.draw) return err("对局已结束");
    const expected: string | null = this.currentStone === 1 ? this.blackId : this.whiteId;
    if (playerId !== expected) return err("还没轮到你");
    if (payload.x == null || payload.y == null) return err("缺少坐标");
    const x: number = (payload.x as number) | 0, y: number = (payload.y as number) | 0;
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return err("坐标越界");
    if (this.board[y][x] !== 0) return err("此处已有棋子");
    this.board[y][x] = this.currentStone;
    const mv: Point = { x: x, y: y };
    this.lastMove = mv;
    this.moveCount++;
    const moverName: string = this.currentStone === 1 ? this.blackName : this.whiteName;
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

  snapshot(): ESObject {
    const s: ESObject = {
      board: this.board, size: this.size,
      blackId: this.blackId, whiteId: this.whiteId,
      blackName: this.blackName, whiteName: this.whiteName,
      currentStone: this.currentStone,
      currentPlayerId: this.currentStone === 1 ? this.blackId : this.whiteId,
      winnerId: this.winnerId, winnerName: this.winnerName,
      draw: this.draw, moveCount: this.moveCount,
      lastMove: this.lastMove
    };
    return s;
  }

  isFinished(): boolean { return this.winnerId != null || this.draw; }
  reset(): void {
    this.board = buildBoard(15);
    this.blackId = null; this.whiteId = null; this.blackName = "黑方"; this.whiteName = "白方";
    this.currentStone = 1; this.winnerId = null; this.winnerName = null;
    this.draw = false; this.moveCount = 0; this.started = false; this.lastMove = null;
  }

  private checkWin(x: number, y: number, stone: number): boolean {
    const dirs: number[][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const d of dirs) {
      const dx: number = d[0], dy: number = d[1];
      const count: number = 1 + this.countDir(x, y, dx, dy, stone) + this.countDir(x, y, -dx, -dy, stone);
      if (count >= 5) return true;
    }
    return false;
  }
  private countDir(x: number, y: number, dx: number, dy: number, stone: number): number {
    let cx: number = x + dx, cy: number = y + dy, n: number = 0;
    while (cx >= 0 && cx < this.size && cy >= 0 && cy < this.size && this.board[cy][cx] === stone) {
      n++; cx += dx; cy += dy;
    }
    return n;
  }
}
