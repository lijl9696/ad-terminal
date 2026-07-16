const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const APP_VERSION = "0.1.0";
let mainWindow;
let isQuitting = false;
let syncing = false;
let powerBlockerId;

function dataPaths() {
  const root = app.getPath("userData");
  return {
    root,
    config: path.join(root, "player.json"),
    cache: path.join(root, "media-cache")
  };
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(dataPaths().config, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(dataPaths().root, { recursive: true });
  fs.writeFileSync(dataPaths().config, JSON.stringify(config, null, 2));
}

function normalizeServerUrl(raw) {
  let value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("请输入后台地址");
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  if (!url.port) url.port = "8787";
  return url.toString().replace(/\/$/, "");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `服务器返回 ${response.status}`);
  return body;
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return hash.digest("hex");
}

function manifestCacheIsComplete(manifest) {
  if (!manifest || !Array.isArray(manifest.items)) return false;
  return manifest.items.every((item) => {
    const filePath = path.join(dataPaths().cache, item.sha256);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  });
}

function localizeManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.items)) return null;
  return {
    ...manifest,
    items: manifest.items.map((item) => ({
      ...item,
      localUrl: pathToFileURL(path.join(dataPaths().cache, item.sha256)).href
    }))
  };
}

async function downloadItem(serverUrl, item, itemIndex, itemCount) {
  const paths = dataPaths();
  fs.mkdirSync(paths.cache, { recursive: true });
  const destination = path.join(paths.cache, item.sha256);
  if (fs.existsSync(destination) && sha256(destination) === item.sha256) return;

  const temporary = `${destination}.download`;
  fs.rmSync(temporary, { force: true });
  const mediaUrl = /^https?:\/\//i.test(item.url) ? item.url : `${serverUrl}${item.url}`;
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`下载 ${item.name} 失败`);

  const total = Number(response.headers.get("content-length") || 0);
  let received = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      mainWindow?.webContents.send("download:progress", {
        name: item.name,
        itemIndex: itemIndex + 1,
        itemCount,
        percent: total ? Math.round((received / total) * 100) : null
      });
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(temporary));
  if (sha256(temporary) !== item.sha256) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`${item.name} 文件校验失败`);
  }
  fs.renameSync(temporary, destination);
}

async function syncManifest() {
  if (syncing) return { busy: true };
  const config = readConfig();
  if (!config.serverUrl || !config.deviceToken) return { manifest: localizeManifest(config.manifest) };
  syncing = true;
  try {
    const manifest = await requestJson(`${config.serverUrl}/api/player/manifest`, {
      headers: { Authorization: `Bearer ${config.deviceToken}` }
    });
    if (!config.manifest || manifest.version !== config.manifest.version || !manifestCacheIsComplete(config.manifest)) {
      for (let index = 0; index < manifest.items.length; index += 1) {
        await downloadItem(config.serverUrl, manifest.items[index], index, manifest.items.length);
      }
      const keep = new Set(manifest.items.map((item) => item.sha256));
      fs.mkdirSync(dataPaths().cache, { recursive: true });
      for (const name of fs.readdirSync(dataPaths().cache)) {
        if (!keep.has(name) && !name.endsWith(".download")) fs.rmSync(path.join(dataPaths().cache, name), { force: true });
      }
      config.manifest = manifest;
      writeConfig(config);
      return { changed: true, manifest: localizeManifest(manifest) };
    }
    return { changed: false, manifest: localizeManifest(config.manifest) };
  } finally {
    syncing = false;
  }
}

function logoUrl() {
  const logo = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "pengshi-logo.png")
    : path.join(__dirname, "..", "..", "public", "pengshi-logo.png");
  return pathToFileURL(logo).href;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreen: true,
    icon: app.isPackaged ? path.join(process.resourcesPath, "assets", "pengshi-logo.png") : path.join(__dirname, "..", "..", "public", "pengshi-logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && (input.key === "F10" || input.key === "Escape")) {
      mainWindow.webContents.send("settings:open");
    }
  });
  mainWindow.webContents.on("render-process-gone", () => {
    if (!isQuitting) setTimeout(() => mainWindow?.reload(), 1000);
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      setTimeout(() => {
        mainWindow.show();
        mainWindow.setFullScreen(true);
      }, 500);
    }
  });
}

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) return app.quit();
  powerBlockerId = powerSaveBlocker.start("prevent-display-sleep");
  createWindow();
});

app.on("second-instance", () => {
  mainWindow?.show();
  mainWindow?.focus();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (powerBlockerId !== undefined && powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
});

ipcMain.handle("state:get", () => {
  const config = readConfig();
  return {
    serverUrl: config.serverUrl || "",
    paired: Boolean(config.deviceToken),
    pairingCode: config.pairingCode || "",
    manifest: localizeManifest(config.manifest),
    appVersion: APP_VERSION,
    logoUrl: logoUrl()
  };
});

ipcMain.handle("server:save", (_event, raw) => {
  const serverUrl = normalizeServerUrl(raw);
  writeConfig({ serverUrl });
  return { serverUrl };
});

ipcMain.handle("pairing:create", async () => {
  const config = readConfig();
  if (!config.serverUrl) throw new Error("请先设置后台地址");
  const result = await requestJson(`${config.serverUrl}/api/player/pairing`, {
    method: "POST",
    body: JSON.stringify({ appVersion: `Windows ${APP_VERSION}` })
  });
  config.pairingCode = result.pairingCode;
  config.pendingToken = result.pendingToken;
  writeConfig(config);
  return { pairingCode: result.pairingCode };
});

ipcMain.handle("pairing:poll", async () => {
  const config = readConfig();
  if (!config.serverUrl || !config.pairingCode || !config.pendingToken) return { paired: false };
  const query = encodeURIComponent(config.pendingToken);
  const result = await requestJson(`${config.serverUrl}/api/player/pairing/${config.pairingCode}?pendingToken=${query}`);
  if (result.paired) {
    config.deviceToken = result.deviceToken;
    config.deviceName = result.deviceName;
    delete config.pendingToken;
    writeConfig(config);
  }
  return result;
});

ipcMain.handle("manifest:sync", syncManifest);

ipcMain.handle("heartbeat:send", async (_event, currentItem) => {
  const config = readConfig();
  if (!config.serverUrl || !config.deviceToken) return { ok: false };
  return requestJson(`${config.serverUrl}/api/player/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.deviceToken}` },
    body: JSON.stringify({
      currentItem: currentItem || null,
      currentVersion: config.manifest?.version || 0,
      appVersion: `Windows ${APP_VERSION}`
    })
  });
});

ipcMain.handle("configuration:reset", () => {
  const config = readConfig();
  writeConfig({ serverUrl: config.serverUrl || "" });
  return { ok: true };
});

ipcMain.handle("autolaunch:get", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("autolaunch:set", (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle("window:fullscreen", (_event, enabled) => mainWindow?.setFullScreen(Boolean(enabled)));
ipcMain.handle("app:quit", () => {
  isQuitting = true;
  app.quit();
});
