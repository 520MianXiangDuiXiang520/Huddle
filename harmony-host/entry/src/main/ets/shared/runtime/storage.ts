// Platform-agnostic key-value storage interface. The HarmonyOS host injects an
// implementation backed by @ohos.data.preferences; tests use MemoryStorage.

export interface KvStorage {
  getNumber(key: string, def: number): number;
  setNumber(key: string, value: number): void;
  getString(key: string, def: string): string;
  setString(key: string, value: string): void;
  getBool(key: string, def: boolean): boolean;
  setBool(key: string, value: boolean): void;
}

export class MemoryStorage implements KvStorage {
  private nums: Map<string, number> = new Map<string, number>();
  private strs: Map<string, string> = new Map<string, string>();
  private bools: Map<string, boolean> = new Map<string, boolean>();

  getNumber(k: string, d: number): number { return this.nums.has(k) ? this.nums.get(k) as number : d; }
  setNumber(k: string, v: number): void { this.nums.set(k, v); }
  getString(k: string, d: string): string { return this.strs.has(k) ? this.strs.get(k) as string : d; }
  setString(k: string, v: string): void { this.strs.set(k, v); }
  getBool(k: string, d: boolean): boolean { return this.bools.has(k) ? this.bools.get(k) as boolean : d; }
  setBool(k: string, v: boolean): void { this.bools.set(k, v); }
}
