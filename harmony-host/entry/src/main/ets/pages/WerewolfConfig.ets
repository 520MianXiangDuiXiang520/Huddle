import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { WerewolfStoreBridge, WerewolfRoleRow } from '../runtime-bridge/stores';

@Entry
@Component
struct WerewolfConfig {
  private context = getContext(this) as common.UIAbilityContext;
  private bridge: WerewolfStoreBridge = new WerewolfStoreBridge(this.context);
  private minOptions: number[] = [6, 7, 8, 9, 10, 11, 12];

  @State minP: number = 6;
  @State maxP: number = 12;
  @State roleCounts: number[] = [];
  @State hint: string = '';
  @State hintWarn: boolean = false;
  @State tick: number = 0;

  aboutToAppear(): void {
    this.minP = this.bridge.minPlayers();
    this.maxP = this.bridge.maxPlayers();
    this.roleCounts = this.bridge.roleRows.map((r) => r.get());
    this.refreshHint();
  }

  build(): void {
    Column({ space: 12 }) {
      this.header()
      Scroll() {
        Column({ space: 16 }) {
          this.section('人数范围')
          this.playerRow('最少', this.minOptions, this.minP, (v) => this.pickMin(v))
          this.playerRow('最多', this.maxOptions(), this.maxP, (v) => this.pickMax(v))
          this.section('角色配置')
          ForEach(this.bridge.roleRows, (row: WerewolfRoleRow, idx: number) => {
            this.roleCard(row, idx)
          }, (row: WerewolfRoleRow) => row.id)
          Text(this.hint)
            .fontSize(13)
            .fontColor(this.hintWarn ? '#d9534f' : '#888')
            .padding({ left: 16, right: 16 })
        }
        .width('100%')
        .padding({ top: 8, bottom: 24 })
      }
      .layoutWeight(1)
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f5f5f7')
  }

  private maxOptions(): number[] { return this.minOptions.filter((v) => v >= this.minP); }

  @Builder header() {
    Row({ space: 8 }) {
      Button('返回').fontSize(13).height(36).backgroundColor('#e8e8ee').fontColor('#333')
        .onClick(() => router.back())
      Blank()
      Text('狼人杀配置').fontSize(17).fontWeight(FontWeight.Bold)
      Blank()
      Text('   ').fontSize(13)
    }
    .width('100%').height(48).padding({ left: 12, right: 12 }).backgroundColor('#fff')
  }

  @Builder section(title: string) {
    Text(title).fontSize(13).fontColor('#999').margin({ left: 16, top: 4 })
  }

  @Builder playerRow(label: string, options: number[], selected: number, onPick: (v: number) => void) {
    Column({ space: 6 }) {
      Text(label).fontSize(14).fontColor('#333')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(options, (v: number) => {
          Text(`${v}`)
            .fontSize(15).fontWeight(FontWeight.Bold)
            .width(48).height(40).textAlign(TextAlign.Center)
            .borderRadius(10)
            .backgroundColor(v === selected ? '#2f6fb0' : '#fff')
            .fontColor(v === selected ? '#fff' : '#333')
            .border({ width: 1, color: '#e0e0e6' })
            .margin({ right: 8, bottom: 8 })
            .onClick(() => onPick(v))
        }, (v: number) => `${v}`)
      }
    }
    .width('100%').padding({ left: 16, right: 16 })
  }

  @Builder roleCard(row: WerewolfRoleRow, idx: number) {
    Row({ space: 12 }) {
      Column({ space: 4 }) {
        Text(row.title).fontSize(16).fontWeight(FontWeight.Bold)
        Text(row.blurb).fontSize(12).fontColor('#888')
      }
      .alignItems(HorizontalAlign.Start).layoutWeight(1)
      Row({ space: 10 }) {
        Button('-').fontSize(16).width(36).height(36)
          .backgroundColor(this.canDec(row) ? '#e8e8ee' : '#f3f3f5')
          .fontColor(this.canDec(row) ? '#333' : '#bbb')
          .enabled(this.canDec(row))
          .onClick(() => this.dec(row, idx))
        Text(`${this.roleCounts[idx]}`).fontSize(18).fontWeight(FontWeight.Bold).width(32).textAlign(TextAlign.Center)
        Button('+').fontSize(16).width(36).height(36)
          .backgroundColor(this.canInc(row) ? '#e8e8ee' : '#f3f3f5')
          .fontColor(this.canInc(row) ? '#333' : '#bbb')
          .enabled(this.canInc(row))
          .onClick(() => this.inc(row, idx))
      }
    }
    .width('100%').padding(14).borderRadius(14).backgroundColor('#fff')
    .border({ width: 1, color: '#e0e0e6' }).margin({ left: 16, right: 16 })
  }

  private canDec(row: WerewolfRoleRow): boolean { return this.roleCounts[this.idxOf(row)] > row.min; }
  private canInc(row: WerewolfRoleRow): boolean { return this.roleCounts[this.idxOf(row)] < row.max; }
  private idxOf(row: WerewolfRoleRow): number { return this.bridge.roleRows.indexOf(row); }

  private dec(row: WerewolfRoleRow, idx: number): void {
    const v = Math.max(row.min, this.roleCounts[idx] - 1);
    row.set(v); this.roleCounts[idx] = v; this.bump(); this.refreshHint();
  }
  private inc(row: WerewolfRoleRow, idx: number): void {
    const v = Math.min(row.max, this.roleCounts[idx] + 1);
    row.set(v); this.roleCounts[idx] = v; this.bump(); this.refreshHint();
  }

  private pickMin(v: number): void {
    this.bridge.setMinPlayers(v); this.minP = v;
    if (this.maxP < v) { this.bridge.setMaxPlayers(v); this.maxP = v; }
    this.bump(); this.refreshHint();
  }
  private pickMax(v: number): void {
    this.bridge.setMaxPlayers(v); this.maxP = v; this.bump(); this.refreshHint();
  }

  private refreshHint(): void {
    const special = this.bridge.specialTotal();
    const villagerMin = Math.max(0, this.minP - special);
    const villagerMax = Math.max(0, this.maxP - special);
    const warn = this.bridge.validate(this.minP);
    this.hint = `特殊角色共 ${special} 人 · 平民 ${villagerMin}–${villagerMax} 人 · 开房 ${this.bridge.playersLabel()}`
      + (warn ? `\n⚠ ${warn}` : '');
    this.hintWarn = warn != null;
  }

  private bump(): void { this.tick++; this.roleCounts = [...this.roleCounts]; }
}
