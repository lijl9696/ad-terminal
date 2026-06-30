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
