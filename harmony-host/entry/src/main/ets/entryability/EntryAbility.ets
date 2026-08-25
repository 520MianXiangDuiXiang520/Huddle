import { UIAbility, AbilityConstant, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { HostRuntime } from '../server/HostRuntime';

export default class EntryAbility extends UIAbility {
  static runtime: HostRuntime | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // HostRuntime is constructed when the user starts a room from Index.
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) console.error(`Failed to load content. ${JSON.stringify(err)}`);
    });
  }

  onDestroy(): void {
    EntryAbility.runtime?.stop();
    EntryAbility.runtime = null;
  }
}
