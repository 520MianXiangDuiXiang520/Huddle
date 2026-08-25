import { common } from '@kit.AbilityKit';
import { GameCatalog as CoreCatalog } from '../shared/runtime/index';
import type { GameDef } from '../shared/runtime/index';
import { PrefsStorage } from '../data/Prefs';

/**
 * ArkUI-friendly view model wrapper around the shared GameCatalog. ArkUI
 * @Component state cannot hold the core class directly, so we expose plain
 * view objects (GameDefView) for the list.
 */
export namespace GameCatalog {
  export interface GameDefView {
    id: string;
    title: string;
    subtitle: string;
    playersLabel: string;
    available: boolean;
    hasConfig: boolean;
  }
}

export class GameCatalog {
  private core: CoreCatalog;
  readonly all: GameCatalog.GameDefView[];

  constructor(context: common.UIAbilityContext) {
    const storage = new PrefsStorage(context, 'huddle_runtime');
    this.core = new CoreCatalog(storage);
    this.all = this.core.all.map((g: GameDef) => this.toView(g));
  }

  resolvedPlayersLabel(g: GameCatalog.GameDefView): string { return g.playersLabel; }

  private toView(g: GameDef): GameCatalog.GameDefView {
    return {
      id: g.id,
      title: g.title,
      subtitle: g.subtitle,
      playersLabel: this.core.resolvedPlayersLabel(g),
      available: g.available,
      hasConfig: g.hasConfig
    };
  }
}
