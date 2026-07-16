const api = window.playerApi;
const elements = {
  player: document.querySelector("#player"),
  setup: document.querySelector("#setup"),
  serverForm: document.querySelector("#server-form"),
  serverUrl: document.querySelector("#server-url"),
  pairing: document.querySelector("#pairing"),
  pairingCode: document.querySelector("#pairing-code"),
  setupStatus: document.querySelector("#setup-status"),
  empty: document.querySelector("#empty"),
  emptyMessage: document.querySelector("#empty-message"),
  settings: document.querySelector("#settings"),
  currentServer: document.querySelector("#current-server"),
  currentVersion: document.querySelector("#current-version"),
  currentAppVersion: document.querySelector("#current-app-version"),
  autoLaunch: document.querySelector("#auto-launch"),
  download: document.querySelector("#download"),
  downloadName: document.querySelector("#download-name"),
  downloadBar: document.querySelector("#download-bar"),
  downloadDetail: document.querySelector("#download-detail")
};

let state = {};
let manifest = null;
let currentIndex = 0;
let imageTimer = null;
let pairingTimer = null;
let syncTimer = null;
let syncing = false;
let settingsOpen = false;

function showOnly(name) {
  elements.setup.classList.toggle("hidden", name !== "setup");
  elements.empty.classList.toggle("hidden", name !== "empty");
}

function clearPlayback() {
  clearTimeout(imageTimer);
  elements.player.replaceChildren();
}

function openSettings() {
  settingsOpen = true;
  elements.settings.classList.remove("hidden");
  elements.currentServer.textContent = state.serverUrl || "未配置";
  elements.currentVersion.textContent = String(manifest?.version || 0);
  elements.currentAppVersion.textContent = state.appVersion || "0.1.0";
  api.getAutoLaunch().then((enabled) => { elements.autoLaunch.checked = enabled; });
}

function closeSettings() {
  settingsOpen = false;
  elements.settings.classList.add("hidden");
}

function playCurrent() {
  clearTimeout(imageTimer);
  if (!manifest?.items?.length) {
    clearPlayback();
    showOnly("empty");
    elements.emptyMessage.textContent = "等待后台发布节目";
    return;
  }
  showOnly("player");
  const item = manifest.items[currentIndex % manifest.items.length];
  const media = document.createElement(item.type === "video" ? "video" : "img");
  media.className = item.fit === "cover" ? "cover" : "contain";
  media.src = item.localUrl;
  if (item.type === "video") {
    media.autoplay = true;
    media.controls = false;
    media.addEventListener("ended", nextItem);
    media.addEventListener("error", () => setTimeout(nextItem, 1000));
    media.play().catch(() => setTimeout(nextItem, 1000));
  } else {
    imageTimer = setTimeout(nextItem, Math.max(1, Number(item.durationSeconds) || 8) * 1000);
  }
  elements.player.replaceChildren(media);
  api.sendHeartbeat(item.name).catch(() => {});
}

function nextItem() {
  if (!manifest?.items?.length) return;
  currentIndex = (currentIndex + 1) % manifest.items.length;
  playCurrent();
}

async function sync() {
  if (syncing || !state.paired) return;
  syncing = true;
  try {
    const result = await api.syncManifest();
    if (result?.manifest && (!manifest || result.changed || result.manifest.version !== manifest.version)) {
      manifest = result.manifest;
      currentIndex = 0;
      playCurrent();
    }
    await api.sendHeartbeat(manifest?.items?.[currentIndex]?.name || null).catch(() => {});
  } catch (error) {
    if (!manifest?.items?.length) {
      showOnly("empty");
      elements.emptyMessage.textContent = `暂时无法连接后台，正在重试：${error.message}`;
    }
  } finally {
    syncing = false;
    setTimeout(() => elements.download.classList.add("hidden"), 1200);
  }
}

function startSyncLoop() {
  clearInterval(syncTimer);
  syncTimer = setInterval(sync, 7000);
}

async function beginPairing() {
  clearTimeout(pairingTimer);
  elements.setupStatus.textContent = "正在连接后台...";
  try {
    const result = await api.createPairing();
    state.pairingCode = result.pairingCode;
    elements.pairingCode.textContent = result.pairingCode;
    elements.pairing.classList.remove("hidden");
    elements.setupStatus.textContent = "";
    pollPairing();
  } catch (error) {
    elements.setupStatus.textContent = `连接失败：${error.message}`;
  }
}

async function pollPairing() {
  try {
    const result = await api.pollPairing();
    if (result.paired) {
      state.paired = true;
      elements.pairing.classList.add("hidden");
      showOnly("empty");
      await sync();
      startSyncLoop();
      return;
    }
  } catch (error) {
    elements.setupStatus.textContent = `等待配对时连接中断：${error.message}`;
  }
  pairingTimer = setTimeout(pollPairing, 3000);
}

elements.serverForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api.saveServer(elements.serverUrl.value);
    state = { ...state, serverUrl: result.serverUrl, paired: false };
    elements.serverUrl.value = result.serverUrl;
    await beginPairing();
  } catch (error) {
    elements.setupStatus.textContent = error.message;
  }
});

document.querySelector("#close-settings").addEventListener("click", closeSettings);
document.querySelector("#reset-player").addEventListener("click", async () => {
  await api.reset();
  clearPlayback();
  closeSettings();
  state.paired = false;
  manifest = null;
  elements.serverUrl.value = state.serverUrl || "";
  elements.pairing.classList.add("hidden");
  showOnly("setup");
});
document.querySelector("#exit-fullscreen").addEventListener("click", () => api.setFullscreen(false));
document.querySelector("#quit-player").addEventListener("click", () => api.quit());
elements.autoLaunch.addEventListener("change", async () => {
  elements.autoLaunch.checked = await api.setAutoLaunch(elements.autoLaunch.checked);
});

api.onOpenSettings(() => settingsOpen ? closeSettings() : openSettings());
api.onDownloadProgress((progress) => {
  elements.download.classList.remove("hidden");
  elements.downloadName.textContent = progress.name;
  elements.downloadDetail.textContent = `素材 ${progress.itemIndex}/${progress.itemCount}${progress.percent === null ? "" : ` · ${progress.percent}%`}`;
  elements.downloadBar.style.width = `${progress.percent ?? 30}%`;
});

async function initialize() {
  state = await api.getState();
  document.querySelector("#brand-logo").src = state.logoUrl;
  document.querySelector("#empty-logo").src = state.logoUrl;
  document.querySelector("#version-label").textContent = `Windows 播放端 ${state.appVersion}`;
  elements.serverUrl.value = state.serverUrl || "";
  manifest = state.manifest;
  if (state.paired) {
    if (manifest?.items?.length) playCurrent(); else showOnly("empty");
    await sync();
    startSyncLoop();
  } else {
    showOnly("setup");
    if (state.pairingCode) {
      elements.pairingCode.textContent = state.pairingCode;
      elements.pairing.classList.remove("hidden");
      pollPairing();
    }
  }
}

initialize().catch((error) => {
  showOnly("setup");
  elements.setupStatus.textContent = `播放器启动失败：${error.message}`;
});
