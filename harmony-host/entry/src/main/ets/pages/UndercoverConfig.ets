import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { UndercoverStoreBridge, UndercoverPairView } from '../runtime-bridge/stores';

@Entry
@Component
struct UndercoverConfig {
  private context = getContext(this) as common.UIAbilityContext;
  private bridge: UndercoverStoreBridge = new UndercoverStoreBridge(this.context);
  private minOptions: number[] = [3, 4, 5, 6];
  private maxOptionsAll: number[] = [6, 8, 10, 12];

  @State minP: number = 3;
  @State maxP: number = 8;
  @State ucCount: number = 1;
  @State pairs: UndercoverPairView[] = [];
  @State civilianInput: string = '';
  @State undercoverInput: string = '';
  @State hint: string = '';
  @State tick: number = 0;

  aboutToAppear(): void {
    this.bridge; // ensure constructed
    this.minP = this.bridge.minPlayers();
    this.maxP = this.bridge.maxPlayers();
    this.ucCount = this.bridge.undercoverCount();
    this.reload();
  }

  build(): void {
    Column({ space: 12 }) {
      this.header()
      Scroll() {
        Column({ space: 14 }) {
          this.section('卧底数量')
          Row({ space: 8 }) {
            ForEach([1, 2, 3], (v: number) => {
              Text(`${v}`)
                .fontSize(15).fontWeight(FontWeight.Bold).width(48).height(40).textAlign(TextAlign.Center)
                .borderRadius(10)
                .backgroundColor(v === this.ucCount ? '#2f6fb0' : '#fff')
                .fontColor(v === this.ucCount ? '#fff' : '#333')
                .border({ width: 1, color: '#e0e0e6' })
                .onClick(() => this.pickUc(v))
            }, (v: number) => `${v}`)
          }.width('100%').padding({ left: 16, right: 16 })

          this.section('人数范围')
          this.playerRow('最少', this.minOptions, this.minP, (v) => this.pickMin(v))
          this.playerRow('最多', this.maxOptions(), this.maxP, (v) => this.pickMax(v))

          this.section('词库')
          Row({ space: 8 }) {
            TextInput({ placeholder: '平民词', text: this.civilianInput })
              .width('40%').height(40).fontSize(14)
              .onChange((v) => this.civilianInput = v)
            TextInput({ placeholder: '卧底词', text: this.undercoverInput })
              .width('40%').height(40).fontSize(14)
              .onChange((v) => this.undercoverInput = v)
            Button('添加').fontSize(13).height(40).type(ButtonType.Capsule).onClick(() => this.add())
          }.width('100%').padding({ left: 16, right: 16 })

          Row() {
            Text(this.hint).fontSize(13).fontColor('#888').layoutWeight(1)
            Button('全部重用').fontSize(12).height(32).backgroundColor('#e8e8ee').fontColor('#333')
              .onClick(() => { this.bridge.reuseAll(); this.reload(); })
          }.width('100%').padding({ left: 16, right: 16 })

          ForEach(this.pairs, (p: UndercoverPairView) => {
            this.pairCard(p)
          }, (p: UndercoverPairView) => p.id)
        }
        .width('100%').padding({ top: 8, bottom: 24 })
      }
      .layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor('#f5f5f7')
  }

  private maxOptions(): number[] { return this.maxOptionsAll.filter((v) => v >= this.minP); }

  @Builder header() {
    Row({ space: 8 }) {
      Button('返回').fontSize(13).height(36).backgroundColor('#e8e8ee').fontColor('#333')
        .onClick(() => router.back())
      Blank()
      Text('谁是卧底配置').fontSize(17).fontWeight(FontWeight.Bold)
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
            .fontSize(15).fontWeight(FontWeight.Bold).width(48).height(40).textAlign(TextAlign.Center)
            .borderRadius(10)
            .backgroundColor(v === selected ? '#2f6fb0' : '#fff')
            .fontColor(v === selected ? '#fff' : '#333')
            .border({ width: 1, color: '#e0e0e6' })
            .margin({ right: 8, bottom: 8 })
            .onClick(() => onPick(v))
        }, (v: number) => `${v}`)
      }
    }.width('100%').padding({ left: 16, right: 16 })
  }

  @Builder pairCard(p: UndercoverPairView) {
    Row({ space: 10 }) {
      Column({ space: 2 }) {
        Text(`${p.civilian} / ${p.undercover}`).fontSize(15).fontWeight(FontWeight.Medium)
        if (p.used) Text('已用').fontSize(11).fontColor('#d9534f')
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (p.used) Button('重用').fontSize(12).height(30).backgroundColor('#e8e8ee').fontColor('#333')
        .onClick(() => { this.bridge.reuse(p.id); this.reload(); })
      Button('删除').fontSize(12).height(30).backgroundColor('#fdecec').fontColor('#d9534f')
        .onClick(() => { this.bridge.remove(p.id); this.reload(); })
    }
    .width('100%').padding(12).borderRadius(12).backgroundColor('#fff')
    .border({ width: 1, color: '#e0e0e6' }).margin({ left: 16, right: 16 })
  }

  private add(): void {
    if (!this.bridge.add(this.civilianInput, this.undercoverInput)) {
      promptAction.showToast({ message: '请输入不同的两个词' }); return;
    }
    this.civilianInput = ''; this.undercoverInput = ''; this.reload();
  }

  private pickUc(v: number): void { this.bridge.setUndercoverCount(v); this.ucCount = v; this.reload(); }
  private pickMin(v: number): void {
    this.bridge.setMinPlayers(v); this.minP = v;
    if (this.maxP < v) { this.bridge.setMaxPlayers(v); this.maxP = v; }
    this.reload();
  }
  private pickMax(v: number): void { this.bridge.setMaxPlayers(v); this.maxP = v; this.reload(); }

  private reload(): void {
    this.pairs = this.bridge.list();
    const unused = this.pairs.filter((p) => !p.used).length;
    this.hint = `可用 ${unused}/${this.pairs.length} · 开房 ${this.bridge.playersLabel()} · 卧底 ${this.ucCount}`;
    this.tick++;
  }
}
