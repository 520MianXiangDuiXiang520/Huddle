import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import pasteboard from '@ohos.pasteboard';
import { bundleManager } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';

const THEME_SYSTEM: number = 0;
const THEME_LIGHT: number = 1;
const THEME_DARK: number = 2;

const CHANGELOG: string =
  'v0.3.17\n' +
  '· 新增「斗地主」：3 人对战，叫分定地主，地主对抗两农民\n' +
  '· 完整牌型校验（单/对/三/三带/顺子/连对/飞机/四带二/炸弹/火箭）\n' +
  '· 叫分阶段 1/2/3 分，无人叫则重新发牌；出牌阶段轮流出牌或不要\n' +
  '· 手牌私有下发，断线可追帧\n\n' +
  'v0.3.16\n' +
  '· 新增「狼人杀」：6–12 人，房主可配置狼人/预言家/女巫/猎人/守卫数量\n' +
  '· 夜晚各角色私密操作，房主「天亮」结算；白天讨论后投票放逐\n' +
  '· 女巫解药/毒药、守卫连守限制、猎人开枪、断线追帧\n' +
  '· 角色配置保存在本机，开房时按配置发牌\n\n' +
  'v0.3.15\n' +
  '· 删除 OTA 在线资源更新功能，界面资源随 APK 内置\n' +
  '· 重构大厅备战逻辑：进入房间自动按顺序入备战席，超出人数进观战席\n' +
  '· 备战席与观战席改为两栏圆形头像展示，头像右下角显示准备角标\n' +
  '· 备战席玩家可「观战 / 准备」，观战席玩家可「入席」\n\n' +
  'v0.3.14.03\n· 更多页支持意见反馈（唤起邮件应用）\n\n' +
  'v0.3.14.01\n· 修复房主身份被转让给普通玩家的问题（仅本机 Host WebView 为房主）\n\n' +
  'v0.3.14\n' +
  '· 新增「你画我猜」：一人作画、文字猜词，猜对或跳过结束\n' +
  '· 自定义猜词词库，用过的词可重新加入\n' +
  '· 画布笔迹局域网同步，断线可追帧\n\n' +
  'v0.3.13.02\n· 可用游戏排在即将推出之前\n· 更多页可查看占用并清理缓存\n\n' +
  'v0.3.13.01\n' +
  '· 谁是卧底配置页样式与按钮触控优化\n' +
  '· 支持 3 人开局，房主可配置最少/最多人数\n' +
  '· 揭晓页加宽并适配宽屏\n\n' +
  'v0.3.13\n' +
  '· 新增「谁是卧底」：自定义词库、发牌与房主揭晓\n' +
  '· 首页可配置词库与卧底人数，词组跨局持久化\n' +
  '· 游戏状态支持按玩家私有下发；网页按游戏动态加载\n\n' +
  'v0.3.10\n· 设置与关于合并为「更多」\n· 关房后客人进入统一等待页\n· 十五路标准五子棋棋盘\n\n' +
  'v0.3.0\n· 首页选游戏、主题与网页资源\n· 五子棋旁观、座位与快照同步\n\n' +
  'v0.2.0\n· Runtime：房间 / 玩家 / 插件\n· 五子棋 Demo\n\n' +
  'v0.1.0\n· 局域网 HTTP + WebSocket PoC';

const PRIVACY: string =
  'Huddle 是单机 / 局域网派对应用：开房与对局不依赖公网账号或云端服务器。\n\n' +
  '聚会时，客人设备只与房主手机上的本地服务通信（同一热点 / Wi‑Fi），' +
  '游戏状态保存在房主设备，不会上传到任何云端。\n\n' +
  '我们收集什么\n' +
  '· 本机生成的设备标识，仅用于断线后恢复你在房间中的身份，不会用于追踪或广告。\n' +
  '· 主题、词库等设置保存在本机；你可在「更多」中查看占用并清理缓存。\n\n' +
  '我们不收集什么\n' +
  '· 不做广告追踪，不强制登录，不要求通讯录、精确定位等与开房无关的权限。\n' +
  '· 不对棋局、词库或聊天内容做云端同步。\n\n' +
  '你的控制权\n' +
  '· 结束房间即停止本机服务；清理存储可恢复内置网页并清空缓存；卸载 App 可清除本机数据。\n' +
  '· 如政策有更新，我们会随版本说明同步。';

const DONATE_BODY: string =
  '如果你觉得 Huddle 有帮助，欢迎请开发者喝杯咖啡。\n捐赠完全自愿，不影响任何功能。';
const DONATE_COPY_VALUE: string = '感谢支持 Huddle · 局域网派对';
const FEEDBACK_EMAIL: string = '15364968962@163.com';

@Component
export struct More {
  private context = getContext(this) as common.UIAbilityContext;
  @State theme: number = THEME_SYSTEM;
  @State versionText: string = '';
  @State storageText: string = '计算中…';

  aboutToAppear(): void {
    const store = preferences.getPreferencesSync(this.context, { name: 'huddle_prefs' });
    const t = store.getSync('theme', THEME_SYSTEM) as number;
    this.theme = typeof t === 'number' ? t : THEME_SYSTEM;
    this.refreshVersion();
    this.refreshStorage();
  }

  private refreshVersion(): void {
    try {
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      this.versionText = `Huddle ${info.versionName} (build ${info.versionCode})`;
    } catch (e) {
      this.versionText = 'Huddle (鸿蒙版)';
    }
  }

  private refreshStorage(): void {
    let bytes: number = 0;
    try {
      const www = `${this.context.filesDir}/www`;
      bytes = dirSize(www);
    } catch (e) {}
    this.storageText = `已占用 ${formatBytes(bytes)}`;
  }

  private setTheme(mode: number): void {
    this.theme = mode;
    const store = preferences.getPreferencesSync(this.context, { name: 'huddle_prefs' });
    store.putSync('theme', mode);
    store.flushSync();
    promptAction.showToast({ message: '主题已保存（重启生效）' });
  }

  private clearStorage(): void {
    try {
      const www = `${this.context.filesDir}/www`;
      rmrf(www);
      promptAction.showToast({ message: '已清理存储' });
      this.refreshStorage();
    } catch (e) {
      promptAction.showToast({ message: '清理失败' });
    }
  }

  private confirmClearStorage(): void {
    promptAction.showDialog({
      title: '清理存储？',
      message: '将清空缓存，并把网页资源恢复为 App 内置版本。主题偏好与各游戏词库不会删除。',
      buttons: [
        { text: '清理', color: '#d9534f' },
        { text: '关闭', color: '#888' }
      ]
    }).then((res: promptAction.ShowDialogSuccessResponse) => {
      if (res.index === 0) this.clearStorage();
    }).catch(() => {});
  }

  private openFeedback(): void {
    promptAction.showDialog({
      title: '意见反馈',
      message: `反馈邮箱：${FEEDBACK_EMAIL}\n\n请复制邮箱后用邮件应用发送反馈，或直接在邮件中描述你遇到的问题。`,
      buttons: [
        { text: '复制邮箱', color: '#2f6fb0' },
        { text: '关闭', color: '#888' }
      ]
    }).then((res: promptAction.ShowDialogSuccessResponse) => {
      if (res.index === 0) {
        try {
          const paste = pasteboard.getSystemPasteboard();
          paste.setDataSync(pasteboard.createPlainTextData(FEEDBACK_EMAIL));
          promptAction.showToast({ message: '已复制' });
        } catch (e) {
          promptAction.showToast({ message: '复制失败' });
        }
      }
    }).catch(() => {});
  }

  private showDonate(): void {
    promptAction.showDialog({
      title: '支持开发者',
      message: DONATE_BODY,
      buttons: [
        { text: '复制致谢信息', color: '#2f6fb0' },
        { text: '打开捐赠页', color: '#888' },
        { text: '关闭', color: '#888' }
      ]
    }).then((res: promptAction.ShowDialogSuccessResponse) => {
      if (res.index === 0) {
        try {
          const paste = pasteboard.getSystemPasteboard();
          paste.setDataSync(pasteboard.createPlainTextData(DONATE_COPY_VALUE));
          promptAction.showToast({ message: '已复制' });
        } catch (e) {
          promptAction.showToast({ message: '复制失败' });
        }
      } else if (res.index === 1) {
        promptAction.showToast({ message: '捐赠链接尚未配置' });
      }
    }).catch(() => {});
  }

  build(): void {
    Column({ space: 12 }) {
      Text('更多').fontSize(24).fontWeight(FontWeight.Bold).margin({ top: 24, bottom: 8 })

      // 主题
      this.section('主题')
      Row({ space: 12 }) {
        ForEach([THEME_SYSTEM, THEME_LIGHT, THEME_DARK], (m: number) => {
          Text(this.themeLabel(m))
            .fontSize(14)
            .padding({ left: 14, right: 14, top: 8, bottom: 8 })
            .borderRadius(20)
            .backgroundColor(this.theme === m ? '#2f6fb0' : '#eee')
            .fontColor(this.theme === m ? '#fff' : '#333')
            .onClick(() => this.setTheme(m))
        }, (m: number) => `${m}`)
      }
      .width('100%').padding({ left: 16, right: 16 })

      // 关于
      this.section('关于')
      this.row('版本', this.versionText)
      this.rowAction('意见反馈', () => this.openFeedback())
      this.rowAction('隐私政策', () => promptAction.showDialog({
        title: '隐私政策', message: PRIVACY, buttons: [{ text: '关闭', color: '#2f6fb0' }]
      }))
      this.rowAction('更新日志', () => promptAction.showDialog({
        title: '更新日志', message: CHANGELOG, buttons: [{ text: '关闭', color: '#2f6fb0' }]
      }))

      // 存储空间
      this.section('存储空间')
      this.row('已占用', this.storageText)
      this.rowAction('清理存储', () => this.confirmClearStorage())

      // 支持开发者
      this.section('支持开发者')
      this.rowAction('支持开发者', () => this.showDonate())
    }
    .width('100%').height('100%').backgroundColor('#f5f5f7')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder section(title: string) {
    Text(title).fontSize(13).fontColor('#888').margin({ left: 16, top: 8, bottom: 2 })
  }

  @Builder row(label: string, value: string) {
    Row() {
      Text(label).fontSize(15).layoutWeight(1)
      Text(value).fontSize(13).fontColor('#666')
    }
    .width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .backgroundColor('#fff')
  }

  @Builder rowAction(label: string, action: () => void) {
    Row() {
      Text(label).fontSize(15).layoutWeight(1)
      Text('›').fontSize(18).fontColor('#bbb')
    }
    .width('100%').padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .backgroundColor('#fff')
    .onClick(() => action())
  }

  private themeLabel(m: number): string {
    if (m === THEME_LIGHT) return '浅色';
    if (m === THEME_DARK) return '深色';
    return '跟随系统';
  }
}

function dirSize(path: string): number {
  let total: number = 0;
  let entries: string[] = [];
  try { entries = fileIo.listFileSync(path); } catch (e) { return 0; }
  for (const name of entries) {
    const child = `${path}/${name}`;
    try {
      const stat = fileIo.statSync(child);
      if (stat.isDirectory()) total += dirSize(child);
      else total += stat.size;
    } catch (e) {}
  }
  return total;
}

function rmrf(path: string): void {
  let entries: string[] = [];
  try { entries = fileIo.listFileSync(path); } catch (e) { return; }
  for (const name of entries) {
    const child = `${path}/${name}`;
    try {
      const stat = fileIo.statSync(child);
      if (stat.isDirectory()) rmrf(child);
      else fileIo.unlinkSync(child);
    } catch (e) {}
  }
  try { fileIo.rmdirSync(path); } catch (e) {}
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
