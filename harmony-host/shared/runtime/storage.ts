// Platform-agnostic key-value storage interface. The HarmonyOS host injects
// an implementation backed by @ohos.data.preferences; tests can use an in-memory
// implementation. Each store namespaces its keys to avoid collisions.

export interface KvStorage {
  getNumber(key: string, def: number): number;
  setNumber(key: string, value: number): void;
  getString(key: string, def: string): string;
  setString(key: string, value: string): void;
  getBool(key: string, def: boolean): boolean;
  setBool(key: string, value: boolean): void;
}

export class MemoryStorage implements KvStorage {
  private nums = new Map<string, number>();
  private strs = new Map<string, string>();
  private bools = new Map<string, boolean>();
  getNumber(k: string, d: number) { return this.nums.has(k) ? this.nums.get(k)! : d; }
  setNumber(k: string, v: number) { this.nums.set(k, v); }
  getString(k: string, d: string) { return this.strs.has(k) ? this.strs.get(k)! : d; }
  setString(k: string, v: string) { this.strs.set(k, v); }
  getBool(k: string, d: boolean) { return this.bools.has(k) ? this.bools.get(k)! : d; }
  setBool(k: string, v: boolean) { this.bools.set(k, v); }
}
