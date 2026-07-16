# 轻量自托管广告机系统

一个面向局域网小规模电视广告播放的 v1 实现：Node.js/SQLite 后台、React 中文管理台、Android TV Kotlin 播放端源码。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，默认账号：

- 用户名：`admin`
- 密码：`admin123`

生产环境使用 Docker：

```bash
docker compose up -d --build
```

然后访问 `http://群晖IP:8787`。

## Android TV

Android 端源码在 `android-tv-player/`。当前机器没有 Java/Gradle 时，可用 Android Studio 打开该目录编译 APK。

播放器首次启动后输入后台地址，例如：

```text
http://192.168.1.10:8787
```

电视会显示 6 位配对码，在后台“设备”页确认绑定后开始播放。

## 用 GitHub Actions 打包 APK

如果本机不想安装 Android Studio，把项目推到 GitHub 后打开：

`Actions` -> `Build Android TV APK` -> `Run workflow`

构建完成后，在该次运行页面的 `Artifacts` 下载 `ad-terminal-tv-debug-apk`，里面包含：

`app-debug.apk`

这个 debug APK 可用于小米电视本地安装测试。

## Windows 播放终端

Windows 播放器源码位于 `windows-player/`。它与 Android 电视端使用同一套后台接口，支持配对、全屏播放、素材缓存、断网续播、节目自动更新和开机自启动。

在 GitHub 仓库中打开：

`Actions` -> `Build Windows Player` -> `Run workflow`

构建完成后，在该次运行页面的 `Artifacts` 下载 `pengshi-windows-player`，解压后运行：

`Pengshi-Signage-Player-Setup-0.1.0.exe`

首次启动输入群晖后台地址，在管理后台“设备”页完成配对。播放器运行时按 `F10` 或 `Esc` 打开设置，可开启“开机自动启动”、更改后台地址、退出全屏或关闭播放器。

## 电视端控制说明

- 后台地址可以输入 `192.168.201.213:8787` 或 `http://192.168.201.213:8787`，新版 APK 会自动补全协议。
- 遥控器返回键、菜单键、设置键，或长按确认键会打开“播放器设置”，可重新配置后台地址、清空配对信息，或打开默认桌面设置。
- APK 已声明为可选桌面启动器。安装后按 Home，如果系统弹出桌面选择，选择“广告终端播放器”并设为始终，即可实现类似第三方桌面的效果。
- 当前 APK 最低支持 Android 5.1（API 22）。开机自启依赖电视系统是否允许第三方 App 接收开机广播；小米电视可能有系统限制。没有运行时授权弹窗是正常的。
