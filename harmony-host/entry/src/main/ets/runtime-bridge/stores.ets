import { common } from '@kit.AbilityKit';
import { PrefsStorage } from '../data/Prefs';
import {
  UndercoverWordStore as CoreUndercover,
  DrawGuessWordStore as CoreDrawGuess,
  WerewolfRoleStore as CoreWerewolf,
  WEREWOLF_ROLE_IDS,
  WEREWOLF_ROLE_TITLES,
  WEREWOLF_ROLE_BLURB
} from '../shared/runtime/index';
import type { UndercoverWordPair, DrawGuessWord } from '../shared/runtime/index';

export interface UndercoverPairView { id: string; civilian: string; undercover: string; used: boolean; }
export interface DrawGuessWordView { id: string; word: string; used: boolean; }
export interface WerewolfRoleRow {
  id: string; title: string; blurb: string; min: number; max: number;
  get: () => number; set: (v: number) => void;
}
interface RoleLimit { lo: number; hi: number; }

function roleTitle(id: string): string {
  if (id === 'werewolf') return WEREWOLF_ROLE_TITLES.werewolf;
  if (id === 'seer') return WEREWOLF_ROLE_TITLES.seer;
  if (id === 'witch') return WEREWOLF_ROLE_TITLES.witch;
  if (id === 'hunter') return WEREWOLF_ROLE_TITLES.hunter;
  if (id === 'guard') return WEREWOLF_ROLE_TITLES.guard;
  return WEREWOLF_ROLE_TITLES.villager;
}
function roleBlurb(id: string): string {
  if (id === 'werewolf') return WEREWOLF_ROLE_BLURB.werewolf;
  if (id === 'seer') return WEREWOLF_ROLE_BLURB.seer;
  if (id === 'witch') return WEREWOLF_ROLE_BLURB.witch;
  if (id === 'hunter') return WEREWOLF_ROLE_BLURB.hunter;
  if (id === 'guard') return WEREWOLF_ROLE_BLURB.guard;
  return WEREWOLF_ROLE_BLURB.villager;
}

export class UndercoverStoreBridge {
  private core: CoreUndercover;
  constructor(context: common.UIAbilityContext) {
    this.core = new CoreUndercover(new PrefsStorage(context, 'huddle_undercover'));
  }
  list(): UndercoverPairView[] {
    return this.core.list().map((p: UndercoverWordPair): UndercoverPairView => ({ id: p.id, civilian: p.civilian, undercover: p.undercover, used: p.used }));
  }
  add(c: string, u: string): boolean { return this.core.add(c, u) != null; }
  remove(id: string): void { this.core.remove(id); }
  reuse(id: string): void { this.core.reuse(id); }
  reuseAll(): void { this.core.reuseAll(); }
  undercoverCount(): number { return this.core.undercoverCount(); }
  setUndercoverCount(v: number): void { this.core.setUndercoverCount(v); }
  minPlayers(): number { return this.core.minPlayers(); }
  maxPlayers(): number { return this.core.maxPlayers(); }
  setMinPlayers(v: number): void { this.core.setMinPlayers(v); }
  setMaxPlayers(v: number): void { this.core.setMaxPlayers(v); }
  playersLabel(): string { return this.core.playersLabel(); }
}

export class DrawGuessStoreBridge {
  private core: CoreDrawGuess;
  constructor(context: common.UIAbilityContext) {
    this.core = new CoreDrawGuess(new PrefsStorage(context, 'huddle_draw_guess'));
  }
  list(): DrawGuessWordView[] {
    return this.core.list().map((w: DrawGuessWord): DrawGuessWordView => ({ id: w.id, word: w.word, used: w.used }));
  }
  add(word: string): boolean { return this.core.add(word) != null; }
  remove(id: string): void { this.core.remove(id); }
  reuse(id: string): void { this.core.reuse(id); }
  reuseAll(): void { this.core.reuseAll(); }
}

export class WerewolfStoreBridge {
  private core: CoreWerewolf;
  readonly roleRows: WerewolfRoleRow[];

  constructor(context: common.UIAbilityContext) {
    this.core = new CoreWerewolf(new PrefsStorage(context, 'huddle_werewolf'));
    const limits: Map<string, RoleLimit> = new Map<string, RoleLimit>();
    limits.set('werewolf', { lo: 1, hi: 4 });
    limits.set('seer', { lo: 0, hi: 2 });
    limits.set('witch', { lo: 0, hi: 2 });
    limits.set('hunter', { lo: 0, hi: 2 });
    limits.set('guard', { lo: 0, hi: 2 });
    const rows: WerewolfRoleRow[] = [];
    for (const id of WEREWOLF_ROLE_IDS) {
      if (id === 'villager') continue;
      const lim: RoleLimit = limits.get(id) != null ? limits.get(id) as RoleLimit : { lo: 0, hi: 2 };
      const row: WerewolfRoleRow = {
        id: id, title: roleTitle(id), blurb: roleBlurb(id),
        min: lim.lo, max: lim.hi,
        get: (): number => { return this.countOf(id); },
        set: (v: number): void => { this.setCountOf(id, v); }
      };
      rows.push(row);
    }
    this.roleRows = rows;
  }
  private countOf(id: string): number {
    if (id === 'werewolf') return this.core.werewolfCount();
    if (id === 'seer') return this.core.seerCount();
    if (id === 'witch') return this.core.witchCount();
    if (id === 'hunter') return this.core.hunterCount();
    if (id === 'guard') return this.core.guardCount();
    return 0;
  }
  private setCountOf(id: string, v: number): void {
    if (id === 'werewolf') this.core.setWerewolfCount(v);
    else if (id === 'seer') this.core.setSeerCount(v);
    else if (id === 'witch') this.core.setWitchCount(v);
    else if (id === 'hunter') this.core.setHunterCount(v);
    else if (id === 'guard') this.core.setGuardCount(v);
  }
  minPlayers(): number { return this.core.minPlayers(); }
  maxPlayers(): number { return this.core.maxPlayers(); }
  setMinPlayers(v: number): void { this.core.setMinPlayers(v); }
  setMaxPlayers(v: number): void { this.core.setMaxPlayers(v); }
  playersLabel(): string { return this.core.playersLabel(); }
  specialTotal(): number { return this.core.specialTotal(); }
  validate(n: number): string | null { return this.core.validate(n); }
}
