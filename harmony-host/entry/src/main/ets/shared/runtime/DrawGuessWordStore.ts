import type { KvStorage } from "./storage";

export interface DrawGuessWord { id: string; word: string; used: boolean; }

const SEED_WORDS: string[] = [
  "苹果", "香蕉", "西瓜", "葡萄", "草莓", "猫咪", "小狗", "兔子", "大象", "企鹅",
  "月亮", "太阳", "彩虹", "雨伞", "雪人", "铅笔", "书包", "眼镜", "手表", "钥匙",
  "足球", "篮球", "滑板", "风筝", "积木", "火车", "飞机", "自行车", "轮船", "火箭",
  "蛋糕", "披萨", "饺子", "冰淇淋", "汉堡", "吉他", "钢琴", "喇叭", "耳机", "相机",
  "城堡", "桥梁", "灯塔", "火山", "沙漠"
];

export class DrawGuessWordStore {
  private s: KvStorage;
  constructor(s: KvStorage) { this.s = s; }

  ensureSeeded(): void {
    if (this.s.getBool("dg_seeded", false)) return;
    if (this.s.getString("dg_words", "") !== "") { this.s.setBool("dg_seeded", true); return; }
    const arr: DrawGuessWord[] = SEED_WORDS.map((w: string): DrawGuessWord => ({ id: uuid(), word: w, used: false }));
    this.save(arr); this.s.setBool("dg_seeded", true);
  }

  list(): DrawGuessWord[] {
    this.ensureSeeded();
    const raw: string = this.s.getString("dg_words", "[]");
    let arr: ESObject[] = []; try { arr = JSON.parse(raw) as ESObject[]; } catch (e) { arr = []; }
    const out: DrawGuessWord[] = [];
    for (const o of arr) {
      const w: string = String((o as ESObject).word != null ? (o as ESObject).word : "").trim();
      if (!w) continue;
      out.push({ id: String((o as ESObject).id != null ? (o as ESObject).id : uuid()), word: w, used: Boolean((o as ESObject).used) });
    }
    return out;
  }

  pickUnused(): DrawGuessWord | null {
    const unused: DrawGuessWord[] = this.list().filter((w: DrawGuessWord): boolean => !w.used);
    return unused.length > 0 ? unused[Math.floor(Math.random() * unused.length)] : null;
  }
  markUsed(id: string): void {
    this.save(this.list().map((w: DrawGuessWord): DrawGuessWord => w.id === id ? { id: w.id, word: w.word, used: true } : w));
  }
  reuse(id: string): void {
    this.save(this.list().map((w: DrawGuessWord): DrawGuessWord => w.id === id ? { id: w.id, word: w.word, used: false } : w));
  }
  reuseAll(): void {
    this.save(this.list().map((w: DrawGuessWord): DrawGuessWord => ({ id: w.id, word: w.word, used: false })));
  }
  add(word: string): DrawGuessWord | null {
    const w: string = word.trim(); if (!w) return null;
    const e: DrawGuessWord = { id: uuid(), word: w, used: false };
    const all: DrawGuessWord[] = this.list(); all.push(e); this.save(all); return e;
  }
  remove(id: string): void { this.save(this.list().filter((w: DrawGuessWord): boolean => w.id !== id)); }

  private save(words: DrawGuessWord[]): void {
    this.s.setString("dg_words", JSON.stringify(words));
    this.s.setBool("dg_seeded", true);
  }
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c: string): string => {
    const r: number = Math.random() * 16 | 0;
    const v: number = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
