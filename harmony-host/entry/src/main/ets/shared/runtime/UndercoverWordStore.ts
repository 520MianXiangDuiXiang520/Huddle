import type { KvStorage } from "./storage";

export interface UndercoverWordPair { id: string; civilian: string; undercover: string; used: boolean; }

const SEED_PAIRS: string[][] = [
  ["咖啡", "奶茶"], ["月亮", "太阳"], ["公交", "地铁"], ["西瓜", "哈密瓜"],
  ["铅笔", "钢笔"], ["电梯", "扶梯"], ["篮球", "足球"], ["饺子", "包子"]
];

export class UndercoverWordStore {
  private s: KvStorage;
  constructor(s: KvStorage) { this.s = s; }

  ensureSeeded(): void {
    if (this.s.getBool("uc_seeded", false)) return;
    if (this.s.getString("uc_pairs", "") !== "") { this.s.setBool("uc_seeded", true); return; }
    const arr: UndercoverWordPair[] = SEED_PAIRS.map((p: string[]): UndercoverWordPair => {
      return { id: uuid(), civilian: p[0], undercover: p[1], used: false };
    });
    this.save(arr);
    this.s.setBool("uc_seeded", true);
  }

  list(): UndercoverWordPair[] {
    this.ensureSeeded();
    const raw: string = this.s.getString("uc_pairs", "[]");
    let arr: ESObject[] = [];
    try { arr = JSON.parse(raw) as ESObject[]; } catch (e) { arr = []; }
    const out: UndercoverWordPair[] = [];
    for (const o of arr) {
      const civilian: string = String((o as ESObject).civilian != null ? (o as ESObject).civilian : "").trim();
      const undercover: string = String((o as ESObject).undercover != null ? (o as ESObject).undercover : "").trim();
      if (!civilian || !undercover) continue;
      out.push({ id: String((o as ESObject).id != null ? (o as ESObject).id : uuid()), civilian: civilian, undercover: undercover, used: Boolean((o as ESObject).used) });
    }
    return out;
  }

  undercoverCount(): number { this.ensureSeeded(); return clamp(this.s.getNumber("uc_count", 1), 1, 3); }
  setUndercoverCount(v: number): void { this.s.setNumber("uc_count", clamp(v, 1, 3)); }

  minPlayers(): number {
    this.ensureSeeded();
    const min: number = clamp(this.s.getNumber("uc_min", 3), 3, 12);
    const max: number = clamp(this.s.getNumber("uc_max", 8), 3, 12);
    return Math.min(min, max);
  }
  maxPlayers(): number {
    this.ensureSeeded();
    const min: number = clamp(this.s.getNumber("uc_min", 3), 3, 12);
    const max: number = clamp(this.s.getNumber("uc_max", 8), 3, 12);
    return Math.max(min, max);
  }
  setMinPlayers(v: number): void { this.s.setNumber("uc_min", clamp(v, 3, this.maxPlayers())); }
  setMaxPlayers(v: number): void { this.s.setNumber("uc_max", clamp(v, this.minPlayers(), 12)); }
  playersLabel(): string { const a: number = this.minPlayers(), b: number = this.maxPlayers(); return a === b ? `${a} 人` : `${a}–${b} 人`; }

  pickUnused(): UndercoverWordPair | null {
    const unused: UndercoverWordPair[] = this.list().filter((p: UndercoverWordPair): boolean => !p.used);
    return unused.length > 0 ? unused[Math.floor(Math.random() * unused.length)] : null;
  }
  markUsed(id: string): void {
    this.save(this.list().map((p: UndercoverWordPair): UndercoverWordPair => p.id === id ? { id: p.id, civilian: p.civilian, undercover: p.undercover, used: true } : p));
  }
  reuse(id: string): void {
    this.save(this.list().map((p: UndercoverWordPair): UndercoverWordPair => p.id === id ? { id: p.id, civilian: p.civilian, undercover: p.undercover, used: false } : p));
  }
  reuseAll(): void {
    this.save(this.list().map((p: UndercoverWordPair): UndercoverWordPair => ({ id: p.id, civilian: p.civilian, undercover: p.undercover, used: false })));
  }
  add(civilian: string, undercover: string): UndercoverWordPair | null {
    const c: string = civilian.trim(), u: string = undercover.trim();
    if (!c || !u || c === u) return null;
    const pair: UndercoverWordPair = { id: uuid(), civilian: c, undercover: u, used: false };
    const all: UndercoverWordPair[] = this.list(); all.push(pair); this.save(all);
    return pair;
  }
  remove(id: string): void { this.save(this.list().filter((p: UndercoverWordPair): boolean => p.id !== id)); }

  private save(pairs: UndercoverWordPair[]): void {
    this.s.setString("uc_pairs", JSON.stringify(pairs));
    this.s.setBool("uc_seeded", true);
  }
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c: string): string => {
    const r: number = Math.random() * 16 | 0;
    const v: number = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
