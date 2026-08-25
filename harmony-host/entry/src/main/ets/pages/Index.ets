import { common } from '@kit.AbilityKit';
import { router, promptAction } from '@kit.ArkUI';
import { preferences } from '@kit.ArkData';
import { GameCatalog } from '../runtime-bridge/catalog';
import { HostRuntime } from '../server/HostRuntime';
import EntryAbility from '../entryability/EntryAbility';
import { More } from './More';

@Entry
@Component
struct Index {
  private context = getContext(this) as common.UIAbilityContext;
  @State games: GameCatalog.GameDefView[] = [];
  @State selectedId: string = 'gomoku';
  @State currentTab: number = 0;

  aboutToAppear(): void {
    const cat = new GameCatalog(this.context);
    this.games = cat.all.map((g: GameCatalog.GameDefView): GameCatalog.GameDefView => {
      return {
        id: g.id, title: g.title, subtitle: g.subtitle,
        playersLabel: cat.resolvedPlayersLabel(g), available: g.available, hasConfig: g.hasConfig
      };
    });
    // Restore last picked game (mirrors Android AppPrefs.lastGameId).
    const store = preferences.getPreferencesSync(this.context, { name: 'huddle_app' });
    const saved = store.getSync('last_game_id', 'gomoku') as string;
    const ok = this.games.some((g: GameCatalog.GameDefView): boolean => g.id === saved && g.available);
    this.selectedId = ok ? saved : 'gomoku';
    HostRuntime.selectedGameId = this.selectedId;
  }

  build(): void {
    Column() {
      Tabs({ index: this.currentTab }) {
        TabContent() {
          this.homeContent()
        }
        .tabBar('首页')

        TabContent() {
          More()
        }
        .tabBar('更多')
      }
      .barPosition(BarPosition.End)
      .barHeight(56)
      .onChange((i: number) => { this.currentTab = i; })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f5f5f7')
  }

  @Builder homeContent() {
    Column({ space: 12 }) {
      Text('Huddle').fontSize(28).fontWeight(FontWeight.Bold).margin({ top: 24, bottom: 4 })
      Text('把朋友聚到同一个房间').fontSize(14).fontColor('#888').margin({ bottom: 8 })
      List({ space: 10 }) {
        ForEach(this.games, (g: GameCatalog.GameDefView) => {
          ListItem() {
            this.gameCard(g)
          }
        }, (g: GameCatalog.GameDefView) => g.id)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 16, right: 16 })
    }
    .width('100%')
    .height('100%')
  }

  @Builder gameCard(g: GameCatalog.GameDefView) {
    Row({ space: 12 }) {
      Column({ space: 4 }) {
        Text(g.title).fontSize(18).fontWeight(FontWeight.Bold)
        Text(g.subtitle).fontSize(12).fontColor('#888')
        Text(g.playersLabel).fontSize(12).fontColor('#666').margin({ top: 4 })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      if (g.hasConfig && g.available) {
        Button('配置')
          .fontSize(13)
          .height(36)
          .backgroundColor('#e8e8ee')
          .fontColor('#333')
          .onClick(() => this.openConfig(g.id))
      }
      if (!g.available) {
        Text('即将推出').fontSize(12).fontColor('#aaa')
      } else {
        Button('开房')
          .fontSize(14)
          .height(40)
          .type(ButtonType.Capsule)
          .onClick(() => this.confirmStart(g))
      }
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor('#fff')
    .border({ width: g.id === this.selectedId ? 2 : 1, color: g.id === this.selectedId ? '#2f6fb0' : '#e0e0e6' })
    .onClick(() => { if (g.available) { this.selectedId = g.id; HostRuntime.selectedGameId = g.id; } })
  }

  private openConfig(id: string): void {
    if (id === 'undercover') router.pushUrl({ url: 'pages/UndercoverConfig' });
    else if (id === 'draw_guess') router.pushUrl({ url: 'pages/DrawGuessConfig' });
    else if (id === 'werewolf') router.pushUrl({ url: 'pages/WerewolfConfig' });
  }

  private confirmStart(g: GameCatalog.GameDefView): void {
    if (!g.available) return;
    this.selectedId = g.id;
    HostRuntime.selectedGameId = g.id;
    const store = preferences.getPreferencesSync(this.context, { name: 'huddle_app' });
    store.putSync('last_game_id', g.id);
    store.flushSync();
    promptAction.showDialog({
      title: '开启房间？',
      message: `以「${g.title}」创建房间（${g.playersLabel}）。这台手机会成为房主服务器。`,
      buttons: [
        { text: '开启房间', color: '#2f6fb0' },
        { text: '再看看', color: '#888' }
      ]
    }).then((res: promptAction.ShowDialogSuccessResponse) => {
      if (res.index === 0) this.startRoom(g);
    }).catch(() => {});
  }

  private startRoom(g: GameCatalog.GameDefView): void {
    const rt = new HostRuntime(this.context);
    EntryAbility.runtime = rt;
    rt.start().then(() => router.pushUrl({ url: 'pages/RoomPage' }))
      .catch((e: Error) => {
        const msg: string = e?.message ?? `${e}`;
        promptAction.showToast({ message: `开房失败：${msg}` });
        console.error(`start failed: ${msg}`);
      });
  }
}
