import { common } from '@kit.AbilityKit';
import { router, promptAction } from '@kit.ArkUI';
import { DrawGuessStoreBridge, DrawGuessWordView } from '../runtime-bridge/stores';

@Entry
@Component
struct DrawGuessConfig {
  private context = getContext(this) as common.UIAbilityContext;
  private bridge: DrawGuessStoreBridge = new DrawGuessStoreBridge(this.context);

  @State words: DrawGuessWordView[] = [];
  @State wordInput: string = '';
  @State hint: string = '';
  @State tick: number = 0;

  aboutToAppear(): void { this.reload(); }

  build(): void {
    Column({ space: 12 }) {
      this.header()
      Scroll() {
        Column({ space: 14 }) {
          this.section('词库')
          Row({ space: 8 }) {
            TextInput({ placeholder: '新词', text: this.wordInput })
              .layoutWeight(1).height(40).fontSize(14)
              .onChange((v) => this.wordInput = v)
            Button('添加').fontSize(13).height(40).type(ButtonType.Capsule).onClick(() => this.add())
          }.width('100%').padding({ left: 16, right: 16 })

          Row() {
            Text(this.hint).fontSize(13).fontColor('#888').layoutWeight(1)
            Button('全部重用').fontSize(12).height(32).backgroundColor('#e8e8ee').fontColor('#333')
              .onClick(() => { this.bridge.reuseAll(); promptAction.showToast({ message: '已全部重新加入' }); this.reload(); })
          }.width('100%').padding({ left: 16, right: 16 })

          ForEach(this.words, (w: DrawGuessWordView) => {
            this.wordCard(w)
          }, (w: DrawGuessWordView) => w.id)
        }
        .width('100%').padding({ top: 8, bottom: 24 })
      }
      .layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor('#f5f5f7')
  }

  @Builder header() {
    Row({ space: 8 }) {
      Button('返回').fontSize(13).height(36).backgroundColor('#e8e8ee').fontColor('#333')
        .onClick(() => router.back())
      Blank()
      Text('你画我猜词库').fontSize(17).fontWeight(FontWeight.Bold)
      Blank()
      Text('   ').fontSize(13)
    }
    .width('100%').height(48).padding({ left: 12, right: 12 }).backgroundColor('#fff')
  }

  @Builder section(title: string) {
    Text(title).fontSize(13).fontColor('#999').margin({ left: 16, top: 4 })
  }

  @Builder wordCard(w: DrawGuessWordView) {
    Row({ space: 10 }) {
      Column({ space: 2 }) {
        Text(w.word).fontSize(15).fontWeight(FontWeight.Medium)
        if (w.used) Text('已用').fontSize(11).fontColor('#d9534f')
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      if (w.used) Button('重用').fontSize(12).height(30).backgroundColor('#e8e8ee').fontColor('#333')
        .onClick(() => { this.bridge.reuse(w.id); this.reload(); })
      Button('删除').fontSize(12).height(30).backgroundColor('#fdecec').fontColor('#d9534f')
        .onClick(() => { this.bridge.remove(w.id); this.reload(); })
    }
    .width('100%').padding(12).borderRadius(12).backgroundColor('#fff')
    .border({ width: 1, color: '#e0e0e6' }).margin({ left: 16, right: 16 })
  }

  private add(): void {
    if (!this.bridge.add(this.wordInput)) {
      promptAction.showToast({ message: '请填写词语' }); return;
    }
    this.wordInput = ''; this.reload();
  }

  private reload(): void {
    this.words = this.bridge.list();
    const unused = this.words.filter((w) => !w.used).length;
    this.hint = `可用词语 ${unused} / 共 ${this.words.length}`;
    this.tick++;
  }
}
