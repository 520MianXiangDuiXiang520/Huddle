import type { KvStorage } from "./storage";

export interface UndercoverWordPair { id: string; civilian: string; undercover: string; used: boolean; }

const SEED_PAIRS: [string, string][] = [
  ["咖啡", "奶茶"], ["月亮", "太阳"], ["公交", "地铁"], ["西瓜", "哈密瓜"],
  ["铅笔", "钢笔"], ["电梯", "扶梯"], ["篮球", "足球"], ["饺子", "包子"]
];

export class UndercoverWordStore {
  constructor(private s: KvStorage) {}

  ensureSeeded(): void {
    if (this.s.getBool("uc_seeded", false)) return;
    if (this.s.getString("uc_pairs", "") !== "") { this.s.setBool("uc_seeded", true); return; }
    const arr = SEED_PAIRS.map(([c, u]) => ({ id: uuid(), civilian: c, undercover: u, used: false }));
    this.save(arr);
    this.s.setBool("uc_seeded", true);
  }

  list(): UndercoverWordPair[] {
    this.ensureSeeded();
    const raw = this.s.getString("uc_pairs", "[]");
    let arr: any[] = [];
    try { arr = JSON.parse(raw); } catch { arr = []; }
    const out: UndercoverWordPair[] = [];
    for (const o of arr) {
      const civilian = String(o.civilian || "").trim();
      const undercover = String(o.undercover || "").trim();
      if (!civilian || !undercover) continue;
      out.push({ id: String(o.id || uuid()), civilian, undercover, used: !!o.used });
    }
    return out;
  }

  undercoverCount(): number { this.ensureSeeded(); return clamp(this.s.getNumber("uc_count", 1), 1, 3); }
  setUndercoverCount(v: number) { this.s.setNumber("uc_count", clamp(v, 1, 3)); }

  minPlayers(): number {
    this.ensureSeeded();
    const min = clamp(this.s.getNumber("uc_min", 3), 3, 12);
    const max = clamp(this.s.getNumber("uc_max", 8), 3, 12);
    return Math.min(min, max);
  }
  maxPlayers(): number {
    this.ensureSeeded();
    const min = clamp(this.s.getNumber("uc_min", 3), 3, 12);
    const max = clamp(this.s.getNumber("uc_max", 8), 3, 12);
    return Math.max(min, max);
  }
  setMinPlayers(v: number) { this.s.setNumber("uc_min", clamp(v, 3, this.maxPlayers())); }
  setMaxPlayers(v: number) { this.s.setNumber("uc_max", clamp(v, this.minPlayers(), 12)); }
  playersLabel(): string { const a = this.minPlayers(), b = this.maxPlayers(); return a === b ? `${a} 人` : `${a}–${b} 人`; }

  pickUnused(): UndercoverWordPair | null {
    const unused = this.list().filter((p) => !p.used);
    return unused.length ? unused[Math.floor(Math.random() * unused.length)] : null;
  }
  markUsed(id: string) { this.save(this.list().map((p) => p.id === id ? { ...p, used: true } : p)); }
  reuse(id: string) { this.save(this.list().map((p) => p.id === id ? { ...p, used: false } : p)); }
  reuseAll() { this.save(this.list().map((p) => ({ ...p, used: false }))); }
  add(civilian: string, undercover: string): UndercoverWordPair | null {
    const c = civilian.trim(), u = undercover.trim();
    if (!c || !u || c === u) return null;
    const pair = { id: uuid(), civilian: c, undercover: u, used: false };
    const all = this.list(); all.push(pair); this.save(all);
    return pair;
  }
  remove(id: string) { this.save(this.list().filter((p) => p.id !== id)); }

  private save(pairs: UndercoverWordPair[]): void {
    this.s.setString("uc_pairs", JSON.stringify(pairs));
    this.s.setBool("uc_seeded", true);
  }
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function uuid(): string {
  try { // @ts-ignore
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; const v = c === "x" ? r : (r & 0x3 | 0x8); return v.toString(16);
  });
}
