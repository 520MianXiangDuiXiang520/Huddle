import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { connection } from '@kit.NetworkKit';
import pasteboard from '@ohos.pasteboard';
import router from '@ohos.router';
import { promptAction } from '@kit.ArkUI';
import EntryAbility from '../entryability/EntryAbility';

/**
 * Invite dialog: QR code + join URL + copy action. Mirrors Android's
 * dialog_invite layout. Shown via CustomDialogController so the WebView
 * layout is unaffected.
 */
@CustomDialog
struct InviteDialog {
  joinUrl: string = '';
  ipKnown: boolean = true;
  controller: CustomDialogController;
  build(): void {
    Column({ space: 12 }) {
      Text('邀请好友加入').fontSize(17).fontWeight(FontWeight.Bold)
      if (this.ipKnown) {
        QRCode(this.joinUrl).width(200).height(200).backgroundColor('#fff').padding(8)
      } else {
        Column({ space: 8 }) {
          Text('⚠').fontSize(40)
          Text('未找到局域网 IP').fontSize(13).fontColor('#d97706')
        }
        .width(200).height(200).justifyContent(FlexAlign.Center)
      }
      Text(this.ipKnown ? this.joinUrl : '无法获取局域网 IP，请确认已连接 Wi‑Fi 或已开启热点')
        .fontSize(13).fontColor('#333').maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Center).width('100%').padding({ left: 8, right: 8 })
      Text('请对方连接同一热点 / Wi‑Fi 后扫码，或在浏览器打开下方链接').fontSize(12).fontColor('#888')
      Row({ space: 12 }) {
        Button('复制链接')
          .fontSize(14).height(40).type(ButtonType.Capsule)
          .backgroundColor('#2f6fb0').fontColor('#fff').enabled(this.ipKnown)
          .onClick(() => {
            if (!this.ipKnown) return;
            try {
              const sys = pasteboard.getSystemPasteboard();
              sys.setDataSync(pasteboard.createPlainTextData(this.joinUrl));
              promptAction.showToast({ message: '链接已复制' });
            } catch (e) {
              promptAction.showToast({ message: '复制失败' });
            }
          })
        Button('关闭')
          .fontSize(14).height(40).type(ButtonType.Capsule)
          .backgroundColor('#e8e8ee').fontColor('#333')
          .onClick(() => { this.controller.close(); })
      }
    }
    .width('80%').padding(20).borderRadius(16).backgroundColor('#fff')
    .alignItems(HorizontalAlign.Center)
  }
}

/**
 * Host room shell. Mirrors Android RoomActivity: a top bar (back / status /
 * invite) over a WebView that loads the shared www lobby. The game "开始"
 * button lives in the web lobby (shown to the host there); this shell only
 * manages the room lifecycle and invite. Back asks for confirmation before
 * stopping the room.
 */
@Entry
@Component
struct RoomPage {
  private context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private webController: webview.WebviewController = new webview.WebviewController();
  @State roomUrl: string = '';
  @State joinUrl: string = '';
  @State statusText: string = '准备中…';
  @State ipKnown: boolean = true;
  private inviteController: CustomDialogController = new CustomDialogController({
    builder: InviteDialog({
      joinUrl: '',
      ipKnown: true,
    }),
    autoCancel: true,
    alignment: DialogAlignment.Center,
    customStyle: true,
  });

  aboutToAppear(): void {
    const ip: string = this.getLanIp();
    const port: number = 8765;
    this.ipKnown = ip !== '127.0.0.1';
    // The Host App WebView MUST load loopback so the server sees the peer as
    // 127.0.0.1 and pins hostId to this client (mirrors Android localUrl).
    // The LAN IP is only used for the invite link guests open in a browser.
    // Stable host device id (>=8 chars) so WebView identity survives localStorage
    // flakiness; hb=0 enables Harmony HTTP snapshot polling instead of WS heartbeats.
    this.roomUrl = `http://127.0.0.1:${port}/?d=huddle-host&hb=0`;
    this.joinUrl = this.ipKnown ? `http://${ip}:${port}/?hb=0` : '';
    this.statusText = this.ipKnown ? '房间已就绪 · 可以邀请朋友' : '无法获取局域网 IP，请确认已连接 Wi‑Fi 或已开启热点';
  }

  build(): void {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Button('返回')
          .fontSize(13).height(36)
          .backgroundColor('#e8e8ee').fontColor('#333')
          .onClick(() => { this.confirmLeave(); })
        Blank()
        Text(this.statusText)
          .fontSize(13)
          .fontColor(this.ipKnown ? '#666' : '#d97706')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Blank()
        Button('邀请')
          .fontSize(13).height(36)
          .type(ButtonType.Capsule)
          .onClick(() => { this.showInvite(); })
      }
      .width('100%')
      .height(48)
      .padding({ left: 12, right: 12 })
      .backgroundColor('#fff')

      Web({ src: this.roomUrl, controller: this.webController })
        .domStorageAccess(true)
        .javaScriptAccess(true)
        .width('100%')
        .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }

  onBackPress(): boolean {
    this.confirmLeave();
    return true;
  }

  private showInvite(): void {
    // Rebuild controller with current URL/IP state, then open.
    this.inviteController = new CustomDialogController({
      builder: InviteDialog({
        joinUrl: this.joinUrl,
        ipKnown: this.ipKnown,
      }),
      autoCancel: true,
      alignment: DialogAlignment.Center,
      customStyle: true,
    });
    this.inviteController.open();
  }

  private confirmLeave(): void {
    promptAction.showDialog({
      title: '结束房间？',
      message: '你是房主。返回将结束房间，其他玩家也会断开。确定要结束吗？',
      buttons: [
        { text: '结束房间', color: '#d9534f' },
        { text: '继续游戏', color: '#2f6fb0' }
      ]
    }).then((res: promptAction.ShowDialogSuccessResponse) => {
      if (res.index === 0) this.leaveRoom();
    }).catch(() => {});
  }

  private leaveRoom(): void {
    if (EntryAbility.runtime != null) {
      EntryAbility.runtime.stop();
      EntryAbility.runtime = null;
    }
    router.back();
  }

  private getLanIp(): string {
    try {
      const handle: connection.NetHandle = connection.getDefaultNetSync();
      if (handle.netId === 0) return '127.0.0.1';
      const props: connection.ConnectionProperties = connection.getConnectionPropertiesSync(handle);
      const addrs: connection.LinkAddress[] = props.linkAddresses;
      for (const la of addrs) {
        const a: string = la.address.address;
        if (a && a.includes('.') && !a.startsWith('127.')) return a;
      }
    } catch (e) {
      // fall through
    }
    return '127.0.0.1';
  }
}
