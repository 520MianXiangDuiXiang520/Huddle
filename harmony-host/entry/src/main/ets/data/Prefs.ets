import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import type { KvStorage } from '../shared/runtime/index';

/**
 * Preferences-backed KvStorage for HarmonyOS NEXT. Namespaced per store via
 * the constructor `name` argument (e.g. 'huddle_runtime', 'huddle_undercover').
 * Numbers/bools are stored as-is; strings as-is.
 */
export class PrefsStorage implements KvStorage {
  private store: preferences.Preferences;

  constructor(context: common.UIAbilityContext, name: string) {
    this.store = preferences.getPreferencesSync(context, { name });
  }

  getNumber(key: string, def: number): number {
    const v = this.store.getSync(key, def) as number;
    return typeof v === 'number' ? v : def;
  }
  setNumber(key: string, value: number): void {
    this.store.putSync(key, value);
    this.store.flushSync();
  }
  getString(key: string, def: string): string {
    const v = this.store.getSync(key, def) as string;
    return typeof v === 'string' ? v : def;
  }
  setString(key: string, value: string): void {
    this.store.putSync(key, value);
    this.store.flushSync();
  }
  getBool(key: string, def: boolean): boolean {
    const v = this.store.getSync(key, def) as boolean;
    return typeof v === 'boolean' ? v : def;
  }
  setBool(key: string, value: boolean): void {
    this.store.putSync(key, value);
    this.store.flushSync();
  }
}
