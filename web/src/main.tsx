import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FolderPlus, Image, Monitor, PlaySquare, Plus, Radio, Save, Send, Tag, Trash2, Upload, Video } from "lucide-react";
import "./styles.css";

type Asset = { id: number; folderId: number | null; displayName: string; type: "image" | "video"; size: number; url: string; sha256: string };
type Folder = { id: number; name: string };
type TagRow = { id: number; name: string; color: string };
type Device = { id: number; name: string; pairingCode?: string; boundAt?: string; online: boolean; lastHeartbeatAt?: string; currentItem?: string; currentVersion?: number; ipAddress?: string; appVersion?: string; tags: TagRow[] };
type PlaylistItem = { assetId: number; imageDuration?: number; imageFit: "contain" | "cover" };
type Playlist = { id: number; name: string; default_image_duration: number; is_draft: number; items: Array<{ assetId: number; imageDuration?: number; imageFit: "contain" | "cover"; asset: Asset }> };

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "请求失败");
  return res.json();
}

function formatSize(size: number) {
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [defaultItems, setDefaultItems] = useState<any[]>([]);

  async function loadAll() {
    const [media, folderRes, tagRes, deviceRes, playlistRes, defaultRes] = await Promise.all([
      api("/api/media"),
      api("/api/folders"),
      api("/api/tags"),
      api("/api/devices"),
      api("/api/playlists"),
      api("/api/default-playlist")
    ]);
    setAssets(media.assets);
    setFolders(folderRes.folders);
    setTags(tagRes.tags);
    setDevices(deviceRes.devices);
    setPlaylists(playlistRes.playlists);
    setDefaultItems(defaultRes.items);
  }

  useEffect(() => {
    api("/api/auth/me")
      .then(() => {
        setAuthed(true);
        loadAll();
      })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    const timer = setInterval(() => api("/api/devices").then((res) => setDevices(res.devices)).catch(() => undefined), 8000);
    return () => clearInterval(timer);
  }, [authed]);

  if (!authed) return <Login onLogin={() => { setAuthed(true); loadAll(); }} />;

  const nav = [
    ["overview", "总览", Radio],
    ["media", "媒体库", Image],
    ["devices", "设备", Monitor],
    ["playlists", "节目单", PlaySquare],
    ["default", "默认广告", Save]
  ] as const;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">AD</div>
          <div>
            <strong>广告终端</strong>
            <span>内网播放控制台</span>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>{nav.find(([id]) => id === tab)?.[1]}</h1>
            <p>局域网自托管，发布后电视端约 10 秒内更新。</p>
          </div>
          <button className="ghost" onClick={() => api("/api/auth/logout", { method: "POST" }).then(() => setAuthed(false))}>退出</button>
        </header>
        {error && <div className="error" onClick={() => setError("")}>{error}</div>}
        {tab === "overview" && <Overview assets={assets} devices={devices} playlists={playlists} />}
        {tab === "media" && <Media assets={assets} folders={folders} reload={loadAll} setError={setError} />}
        {tab === "devices" && <Devices devices={devices} tags={tags} reload={loadAll} setError={setError} />}
        {tab === "playlists" && <Playlists assets={assets} devices={devices} tags={tags} playlists={playlists} reload={loadAll} setError={setError} />}
        {tab === "default" && <DefaultPlaylist assets={assets} items={defaultItems} reload={loadAll} setError={setError} />}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  return (
    <div className="login">
      <form onSubmit={(e) => {
        e.preventDefault();
        api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }).then(onLogin).catch((err) => setError(err.message));
      }}>
        <div className="brand big"><div className="brandMark">AD</div><div><strong>广告终端</strong><span>管理台登录</span></div></div>
        <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="formError">{error}</p>}
        <button className="primary">登录</button>
      </form>
    </div>
  );
}

function Overview({ assets, devices, playlists }: any) {
  return <section className="grid4">
    <Stat label="素材" value={assets.length} />
    <Stat label="设备" value={devices.filter((d: Device) => d.boundAt).length} />
    <Stat label="在线" value={devices.filter((d: Device) => d.online).length} />
    <Stat label="节目单" value={playlists.length} />
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Media({ assets, folders, reload, setError }: any) {
  const [folderName, setFolderName] = useState("");
  return <section className="panel">
    <div className="sectionHead">
      <h2>媒体库</h2>
      <label className="uploadButton"><Upload size={17} /> 上传图片/视频
        <input type="file" accept="image/*,video/*" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return;
          const form = new FormData(); form.append("file", file);
          const res = await fetch("/api/media", { method: "POST", body: form, credentials: "include" });
          if (!res.ok) setError((await res.json()).error); else reload();
          e.currentTarget.value = "";
        }} />
      </label>
    </div>
    <div className="inlineForm">
      <input placeholder="新建文件夹" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
      <button onClick={() => api("/api/folders", { method: "POST", body: JSON.stringify({ name: folderName }) }).then(() => { setFolderName(""); reload(); }).catch((e) => setError(e.message))}><FolderPlus size={16} /> 创建</button>
    </div>
    <div className="assetGrid">
      {assets.map((asset: Asset) => <div className="asset" key={asset.id}>
        <div className="thumb">{asset.type === "image" ? <img src={asset.url} /> : <Video size={38} />}</div>
        <strong>{asset.displayName}</strong>
        <span>{asset.type === "image" ? "图片" : "视频"} · {formatSize(asset.size)}</span>
        <select value={asset.folderId || ""} onChange={(e) => api(`/api/media/${asset.id}`, { method: "PATCH", body: JSON.stringify({ folderId: e.target.value ? Number(e.target.value) : null }) }).then(reload)}>
          <option value="">未分类</option>
          {folders.map((f: Folder) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="danger" onClick={() => confirm("删除这个素材？") && api(`/api/media/${asset.id}`, { method: "DELETE" }).then(reload)}><Trash2 size={15} /> 删除</button>
      </div>)}
    </div>
  </section>;
}

function Devices({ devices, tags, reload, setError }: any) {
  const [tagName, setTagName] = useState("");
  return <section className="panel">
    <div className="sectionHead"><h2>设备与标签</h2></div>
    <div className="inlineForm">
      <input placeholder="新建设备标签，如 大厅 / 前台" value={tagName} onChange={(e) => setTagName(e.target.value)} />
      <button onClick={() => api("/api/tags", { method: "POST", body: JSON.stringify({ name: tagName, color: "#236b55" }) }).then(() => { setTagName(""); reload(); }).catch((e) => setError(e.message))}><Tag size={16} /> 创建标签</button>
    </div>
    <div className="table">
      {devices.map((device: Device) => <DeviceRow key={device.id} device={device} tags={tags} reload={reload} />)}
    </div>
  </section>;
}

function DeviceRow({ device, tags, reload }: any) {
  const [name, setName] = useState(device.name);
  const selected = new Set(device.tags.map((t: TagRow) => t.id));
  return <div className="row">
    <div><strong>{device.boundAt ? name : `待配对 ${device.pairingCode}`}</strong><span>{device.online ? "在线" : "离线"} · {device.ipAddress || "无 IP"} · v{device.currentVersion || "-"}</span></div>
    <input value={name} onChange={(e) => setName(e.target.value)} />
    <div className="chips">{tags.map((tag: TagRow) => <label key={tag.id} className="chip"><input type="checkbox" defaultChecked={selected.has(tag.id)} value={tag.id} />{tag.name}</label>)}</div>
    {!device.boundAt && <button onClick={() => api(`/api/pairings/${device.pairingCode}/approve`, { method: "POST", body: JSON.stringify({ name }) }).then(reload)}>确认绑定</button>}
    {device.boundAt && <button onClick={(e) => {
      const container = (e.currentTarget.parentElement as HTMLElement);
      const tagIds = [...container.querySelectorAll("input[type=checkbox]:checked")].map((el: any) => Number(el.value));
      api(`/api/devices/${device.id}`, { method: "PATCH", body: JSON.stringify({ name, tagIds }) }).then(reload);
    }}><Save size={15} /> 保存</button>}
  </div>;
}

function Playlists({ assets, devices, tags, playlists, reload, setError }: any) {
  const [editing, setEditing] = useState<Playlist | null>(playlists[0] || null);
  const [name, setName] = useState(editing?.name || "");
  const [duration, setDuration] = useState(editing?.default_image_duration || 8);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [targetTags, setTargetTags] = useState<number[]>([]);
  const [targetDevices, setTargetDevices] = useState<number[]>([]);

  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setDuration(editing.default_image_duration);
    setItems(editing.items.map((i) => ({ assetId: i.assetId, imageDuration: i.imageDuration, imageFit: i.imageFit || "contain" })));
  }, [editing?.id]);

  const assetMap = useMemo(() => new Map(assets.map((a: Asset) => [a.id, a])), [assets]);
  const save = async () => {
    let target = editing;
    if (!target) {
      target = (await api("/api/playlists", { method: "POST", body: JSON.stringify({ name, defaultImageDuration: duration }) })).playlist;
      setEditing(target);
    }
    await api(`/api/playlists/${target.id}`, { method: "PUT", body: JSON.stringify({ name, defaultImageDuration: duration, items }) });
    await reload();
    return target;
  };
  return <section className="twoCol">
    <div className="panel">
      <div className="sectionHead"><h2>节目单</h2><button onClick={() => { setEditing(null); setName("新节目单"); setItems([]); }}><Plus size={16} /> 新建</button></div>
      {playlists.map((p: Playlist) => <button key={p.id} className={`listButton ${editing?.id === p.id ? "selected" : ""}`} onClick={() => setEditing(p)}>{p.name}<span>{p.items.length} 项</span></button>)}
    </div>
    <div className="panel">
      <div className="editorHeader">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="节目单名称" />
        <label>默认图片秒数<input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>
      </div>
      <div className="assetPicker">{assets.map((asset: Asset) => <button key={asset.id} onClick={() => setItems([...items, { assetId: asset.id, imageFit: "contain" }])}>{asset.type === "image" ? <Image size={16} /> : <Video size={16} />}{asset.displayName}</button>)}</div>
      <div className="playlistItems">{items.map((item, index) => {
        const asset = assetMap.get(item.assetId) as Asset;
        return <div className="itemRow" key={`${item.assetId}-${index}`}>
          <span>{index + 1}</span><strong>{asset?.displayName}</strong>
          {asset?.type === "image" && <input type="number" placeholder={`${duration}s`} value={item.imageDuration || ""} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, imageDuration: Number(e.target.value) || undefined } : it))} />}
          {asset?.type === "image" && <select value={item.imageFit} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, imageFit: e.target.value as any } : it))}><option value="contain">完整显示</option><option value="cover">填满裁剪</option></select>}
          <button className="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
        </div>;
      })}</div>
      <div className="publishBox">
        <div className="chips">{tags.map((tag: TagRow) => <label className="chip" key={tag.id}><input type="checkbox" onChange={(e) => setTargetTags(e.target.checked ? [...targetTags, tag.id] : targetTags.filter((id) => id !== tag.id))} />{tag.name}</label>)}</div>
        <div className="chips">{devices.filter((d: Device) => d.boundAt).map((d: Device) => <label className="chip" key={d.id}><input type="checkbox" onChange={(e) => setTargetDevices(e.target.checked ? [...targetDevices, d.id] : targetDevices.filter((id) => id !== d.id))} />{d.name}</label>)}</div>
        <button className="primary" onClick={() => save().then((target) => api(`/api/playlists/${target.id}/publish`, { method: "POST", body: JSON.stringify({ tagIds: targetTags, deviceIds: targetDevices }) })).then(reload).catch((e) => setError(e.message))}><Send size={16} /> 保存并发布</button>
        <button onClick={() => save().catch((e) => setError(e.message))}><Save size={16} /> 保存草稿</button>
      </div>
    </div>
  </section>;
}

function DefaultPlaylist({ assets, items, reload, setError }: any) {
  const [draft, setDraft] = useState<PlaylistItem[]>(items.map((i: any) => ({ assetId: i.assetId, imageDuration: i.imageDuration, imageFit: i.imageFit })));
  const assetMap = useMemo(() => new Map(assets.map((a: Asset) => [a.id, a])), [assets]);
  return <section className="panel">
    <div className="sectionHead"><h2>默认广告</h2><button className="primary" onClick={() => api("/api/default-playlist", { method: "PUT", body: JSON.stringify({ items: draft }) }).then(reload).catch((e) => setError(e.message))}><Save size={16} /> 保存默认广告</button></div>
    <div className="assetPicker">{assets.map((asset: Asset) => <button key={asset.id} onClick={() => setDraft([...draft, { assetId: asset.id, imageFit: "contain" }])}>{asset.type === "image" ? <Image size={16} /> : <Video size={16} />}{asset.displayName}</button>)}</div>
    <div className="playlistItems">{draft.map((item, index) => <div className="itemRow" key={`${item.assetId}-${index}`}><span>{index + 1}</span><strong>{(assetMap.get(item.assetId) as Asset)?.displayName}</strong><button className="ghost" onClick={() => setDraft(draft.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>)}</div>
  </section>;
}

createRoot(document.getElementById("root")!).render(<App />);
