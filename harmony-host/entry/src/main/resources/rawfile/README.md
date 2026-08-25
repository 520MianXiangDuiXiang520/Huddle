# rawfile/www

此目录由 `harmony-host/scripts/copy-www.sh` 从 `android-host/app/src/main/assets/www` 同步生成，**不要手动编辑**。

Huddle 的网页资源保持单一来源（Android `assets/www`），鸿蒙端打包前执行同步脚本即可。`HostRuntime.materializeWww()` 会在运行时把 rawfile 中的 www 拷贝到沙盒目录供 HTTP 服务读取。

同步清单（`HostRuntime.ets` 中的 `manifest`）需与 Android www 实际文件保持一致；新增网页文件时同步更新两处。

```bash
bash harmony-host/scripts/copy-www.sh
```
