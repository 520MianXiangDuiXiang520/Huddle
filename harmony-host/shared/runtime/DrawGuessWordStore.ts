import type { KvStorage } from "./storage";

export interface DrawGuessWord { id: string; word: string; used: boolean; }

const SEED_WORDS = [
  "苹果", "香蕉", "西瓜", "葡萄", "草莓", "猫咪", "小狗", "兔子", "大象", "企鹅",
  "月亮", "太阳", "彩虹", "雨伞", "雪人", "铅笔", "书包", "眼镜", "手表", "钥匙",
  "足球", "篮球", "滑板", "风筝", "积木", "火车", "飞机", "自行车", "轮船", "火箭",
  "蛋糕", "披萨", "饺子", "冰淇淋", "汉堡", "吉他", "钢琴", "喇叭", "耳机", "相机",
  "城堡", "桥梁", "灯塔", "火山", "沙漠"
];

export class DrawGuessWordStore {
  constructor(private s: KvStorage) {}

  ensureSeeded(): void {
    if (this.s.getBool("dg_seeded", false)) return;
    if (this.s.getString("dg_words", "") !== "") { this.s.setBool("dg_seeded", true); return; }
    const arr = SEED_WORDS.map((w) => ({ id: uuid(), word: w, used: false }));
    this.save(arr); this.s.setBool("dg_seeded", true);
  }

  list(): DrawGuessWord[] {
    this.ensureSeeded();
    const raw = this.s.getString("dg_words", "[]");
    let arr: any[] = []; try { arr = JSON.parse(raw); } catch { arr = []; }
    const out: DrawGuessWord[] = [];
    for (const o of arr) { const w = String(o.word || "").trim(); if (!w) continue; out.push({ id: String(o.id || uuid()), word: w, used: !!o.used }); }
    return out;
  }

  pickUnused(): DrawGuessWord | null {
    const unused = this.list().filter((w) => !w.used);
    return unused.length ? unused[Math.floor(Math.random() * unused.length)] : null;
  }
  markUsed(id: string) { this.save(this.list().map((w) => w.id === id ? { ...w, used: true } : w)); }
  reuse(id: string) { this.save(this.list().map((w) => w.id === id ? { ...w, used: false } : w)); }
  reuseAll() { this.save(this.list().map((w) => ({ ...w, used: false }))); }
  add(word: string): DrawGuessWord | null {
    const w = word.trim(); if (!w) return null;
    const e = { id: uuid(), word: w, used: false }; const all = this.list(); all.push(e); this.save(all); return e;
  }
  remove(id: string) { this.save(this.list().filter((w) => w.id !== id)); }

  private save(words: DrawGuessWord[]): void {
    this.s.setString("dg_words", JSON.stringify(words));
    this.s.setBool("dg_seeded", true);
  }
}

function uuid(): string {
  try { // @ts-ignore
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; const v = c === "x" ? r : (r & 0x3 | 0x8); return v.toString(16);
  });
}
