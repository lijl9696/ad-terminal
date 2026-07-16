import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Image, Monitor, PlaySquare, Plus, Radio, Save, Search, Send, Tag, Trash2, Upload, Video, X } from "lucide-react";
import "./styles.css";

type Label = { id: number; name: string; color: string };
type Asset = { id: number; displayName: string; type: "image" | "video"; size: number; url: string; sha256: string; tags: Label[] };
type Device = { id: number; name: string; pairingCode?: string; boundAt?: string; online: boolean; ipAddress?: string; currentItem?: string; currentVersion?: number; tags: Label[] };
type PlaylistItem = { assetId: number; imageDuration?: number; imageFit: "contain" | "cover" };
type Playlist = { id: number; name: string; default_image_duration: number; is_draft: number; items: Array<PlaylistItem & { asset: Asset }> };

async function api(path: string, options: RequestInit = {}) {
  const headers = options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch(path, { credentials: "include", headers, ...options });
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
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mediaLabels, setMediaLabels] = useState<Label[]>([]);
  const [deviceTags, setDeviceTags] = useState<Label[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [defaultItems, setDefaultItems] = useState<any[]>([]);

  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  };

  async function loadAll() {
    const [media, mediaTagRes, deviceTagRes, deviceRes, playlistRes, defaultRes] = await Promise.all([
      api("/api/media"),
      api("/api/media-tags"),
      api("/api/tags"),
      api("/api/devices"),
      api("/api/playlists"),
      api("/api/default-playlist")
    ]);
    setAssets(media.assets);
    setMediaLabels(mediaTagRes.tags);
    setDeviceTags(deviceTagRes.tags);
    setDevices(deviceRes.devices);
    setPlaylists(playlistRes.playlists);
    setDefaultItems(defaultRes.items);
  }

  useEffect(() => {
    api("/api/auth/me").then(() => { setAuthed(true); loadAll(); }).catch(() => setAuthed(false));
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
        <div className="brand"><img className="brandLogo" src="/pengshi-logo.png" alt="彭世修脚" /><div><strong>彭世集团</strong><span>播放终端控制系统</span></div></div>
        <nav>{nav.map(([id, label, Icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={18} />{label}</button>)}</nav>
      </aside>
      <main>
        <header className="topbar">
          <div><h1>{nav.find(([id]) => id === tab)?.[1]}</h1><p>素材、设备、节目单发布都在这里完成。</p></div>
          <button className="ghost" onClick={() => api("/api/auth/logout", { method: "POST" }).then(() => setAuthed(false))}>退出</button>
        </header>
        {toast && <div className="toast"><Check size={16} />{toast}</div>}
        {error && <div className="error" onClick={() => setError("")}>{error}</div>}
        {tab === "overview" && <Overview assets={assets} devices={devices} playlists={playlists} />}
        {tab === "media" && <Media assets={assets} labels={mediaLabels} reload={loadAll} notify={notify} setError={setError} />}
        {tab === "devices" && <Devices devices={devices} tags={deviceTags} reload={loadAll} notify={notify} setError={setError} />}
        {tab === "playlists" && <Playlists assets={assets} labels={mediaLabels} devices={devices} tags={deviceTags} playlists={playlists} reload={loadAll} notify={notify} setError={setError} />}
        {tab === "default" && <DefaultPlaylist assets={assets} items={defaultItems} reload={loadAll} notify={notify} setError={setError} />}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  return <div className="login"><form onSubmit={(e) => {
    e.preventDefault();
    api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }).then(onLogin).catch((err) => setError(err.message));
  }}>
    <div className="brand big"><img className="brandLogo large" src="/pengshi-logo.png" alt="彭世修脚" /><div><strong>彭世集团</strong><span>播放终端控制系统</span></div></div>
    <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
    <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p className="formError">{error}</p>}
    <button className="primary">登录</button>
  </form></div>;
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

function Media({ assets, labels, reload, notify, setError }: any) {
  const [labelName, setLabelName] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const visible = assets.filter((asset: Asset) => {
    const typeOk = typeFilter === "all" || asset.type === typeFilter;
    const labelOk = labelFilter === "all" || asset.tags.some((tag) => tag.id === Number(labelFilter));
    const queryOk = !query || asset.displayName.toLowerCase().includes(query.toLowerCase());
    return typeOk && labelOk && queryOk;
  });

  const uploadFile = (file: File) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    setProgress(0);
    xhr.upload.onprogress = (event) => event.lengthComputable && setProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) { notify("上传完成"); reload(); }
      else setError(JSON.parse(xhr.responseText || "{}").error || "上传失败");
    };
    xhr.onerror = () => { setUploading(false); setError("上传失败"); };
    xhr.open("POST", "/api/media");
    xhr.withCredentials = true;
    xhr.send(form);
  };

  return <section className="workspace">
    <div className="commandBar">
      <div><h2>媒体库</h2><p className="hint">给素材打标签，节目单里可按类型和标签快速选素材。</p></div>
      <label className="uploadHero"><Upload size={18} /> 选择文件上传<input hidden type="file" accept="image/*,video/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.currentTarget.value = ""; }} /></label>
    </div>
    {uploading && <div className="progress"><span style={{ width: `${progress}%` }} /><strong>上传中 {progress}%</strong></div>}
    <div className="toolbar">
      <div className="searchBox"><Search size={16} /><input placeholder="搜索素材名" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <Segment value={typeFilter} onChange={setTypeFilter} options={[["all", "全部"], ["image", "图片"], ["video", "视频"]]} />
      <select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}><option value="all">全部标签</option>{labels.map((l: Label) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
    </div>
    <div className="labelManager">
      <Tag size={16} /><strong>素材标签</strong>
      <input placeholder="新建标签，例如 门店活动" value={labelName} onChange={(e) => setLabelName(e.target.value)} />
      <button onClick={() => api("/api/media-tags", { method: "POST", body: JSON.stringify({ name: labelName, color: "#236b55" }) }).then(() => { setLabelName(""); notify("标签已创建"); reload(); }).catch((e) => setError(e.message))}><Plus size={15} />新增</button>
      <div className="chips">{labels.map((label: Label) => <span className="chip" key={label.id}>{label.name}</span>)}</div>
    </div>
    <div className="assetGrid roomy">
      {visible.map((asset: Asset) => <AssetCard key={asset.id} asset={asset} labels={labels} reload={reload} notify={notify} setError={setError} />)}
      {visible.length === 0 && <p className="empty">没有匹配的素材。</p>}
    </div>
  </section>;
}

function AssetCard({ asset, labels, reload, notify, setError }: any) {
  const [name, setName] = useState(asset.displayName);
  const [tagIds, setTagIds] = useState<number[]>(asset.tags.map((t: Label) => t.id));
  const dirty = name !== asset.displayName || tagIds.slice().sort().join(",") !== asset.tags.map((t: Label) => t.id).sort().join(",");
  return <div className="asset">
    <div className="thumb">{asset.type === "image" ? <img src={asset.url} /> : <Video size={36} />}</div>
    <input className="assetName" value={name} onChange={(e) => setName(e.target.value)} />
    <span>{asset.type === "image" ? "图片" : "视频"} · {formatSize(asset.size)}</span>
    <div className="chips">{labels.map((label: Label) => <label key={label.id} className="chip"><input type="checkbox" checked={tagIds.includes(label.id)} onChange={(e) => setTagIds(e.target.checked ? [...tagIds, label.id] : tagIds.filter((id) => id !== label.id))} />{label.name}</label>)}</div>
    <div className="assetActions">
      <button disabled={!dirty} onClick={() => api(`/api/media/${asset.id}`, { method: "PATCH", body: JSON.stringify({ displayName: name, tagIds }) }).then(() => { notify("素材已保存"); reload(); }).catch((e) => setError(e.message))}><Save size={15} />保存</button>
      <button className="iconDanger" title="删除素材" onClick={() => confirm(`删除素材「${asset.displayName}」？`) && api(`/api/media/${asset.id}`, { method: "DELETE" }).then(() => { notify("素材已删除"); reload(); })}><Trash2 size={16} /></button>
    </div>
  </div>;
}

function Devices({ devices, tags, reload, notify, setError }: any) {
  const [tagName, setTagName] = useState("");
  const pending = devices.filter((device: Device) => !device.boundAt);
  const bound = devices.filter((device: Device) => device.boundAt);
  return <section className="panel">
    <div className="sectionHead"><div><h2>设备与标签</h2><p className="hint">电视端生成配对码后先确认绑定，再用设备标签发布节目单。</p></div></div>
    <div className="inlineForm"><input placeholder="新建设备标签，如 大厅 / 前台" value={tagName} onChange={(e) => setTagName(e.target.value)} /><button onClick={() => api("/api/tags", { method: "POST", body: JSON.stringify({ name: tagName, color: "#236b55" }) }).then(() => { setTagName(""); notify("设备标签已创建"); reload(); }).catch((e) => setError(e.message))}><Tag size={16} />创建标签</button></div>
    <div className="deviceSections"><DeviceSection title="待绑定设备" empty="暂无待绑定设备。" devices={pending} tags={tags} reload={reload} notify={notify} /><DeviceSection title="已绑定设备" empty="还没有已绑定设备。" devices={bound} tags={tags} reload={reload} notify={notify} /></div>
  </section>;
}

function DeviceSection({ title, empty, devices, tags, reload, notify }: any) {
  return <div><h3>{title}</h3>{devices.length === 0 && <p className="empty">{empty}</p>}<div className="table">{devices.map((device: Device) => <DeviceRow key={device.id} device={device} tags={tags} reload={reload} notify={notify} />)}</div></div>;
}

function DeviceRow({ device, tags, reload, notify }: any) {
  const [name, setName] = useState(device.name);
  const [selectedTags, setSelectedTags] = useState<number[]>(device.tags.map((t: Label) => t.id));
  const original = device.tags.map((t: Label) => t.id);
  const dirty = name !== device.name || selectedTags.slice().sort().join(",") !== original.sort().join(",");
  return <div className={`row ${device.boundAt ? "" : "pendingRow"}`}>
    <div><strong>{device.boundAt ? device.name : `配对码 ${device.pairingCode}`}</strong><span>{device.boundAt ? `${device.online ? "在线" : "离线"} · ${device.ipAddress || "无 IP"} · 当前播放 ${device.currentItem || "-"}` : "等待管理员确认绑定"}</span></div>
    <input value={name} onChange={(e) => setName(e.target.value)} />
    <div className="chips">{tags.map((tag: Label) => <label key={tag.id} className="chip"><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={(e) => setSelectedTags(e.target.checked ? [...selectedTags, tag.id] : selectedTags.filter((id) => id !== tag.id))} />{tag.name}</label>)}</div>
    {!device.boundAt ? <button onClick={() => api(`/api/pairings/${device.pairingCode}/approve`, { method: "POST", body: JSON.stringify({ name, tagIds: selectedTags }) }).then(() => { notify("设备已绑定"); reload(); })}>确认绑定</button> : <button disabled={!dirty} onClick={() => api(`/api/devices/${device.id}`, { method: "PATCH", body: JSON.stringify({ name, tagIds: selectedTags }) }).then(() => { notify("设备已保存"); reload(); })}><Save size={15} />{dirty ? "保存" : "已保存"}</button>}
  </div>;
}

function Playlists({ assets, labels, devices, tags, playlists, reload, notify, setError }: any) {
  const [editing, setEditing] = useState<Playlist | null>(playlists[0] || null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(8);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [assetType, setAssetType] = useState("all");
  const [assetLabel, setAssetLabel] = useState("all");
  const [query, setQuery] = useState("");
  const [targetTags, setTargetTags] = useState<number[]>([]);
  const [targetDevices, setTargetDevices] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) { setName("新节目单"); setDuration(8); setItems([]); return; }
    setName(editing.name);
    setDuration(editing.default_image_duration);
    setItems((editing.items || []).map((i) => ({ assetId: i.assetId, imageDuration: i.imageDuration, imageFit: i.imageFit || "contain" })));
  }, [editing?.id]);

  useEffect(() => {
    if (!editing && playlists.length > 0) setEditing(playlists[0]);
  }, [playlists.length]);

  const assetMap = useMemo(() => new Map(assets.map((a: Asset) => [a.id, a])), [assets]);
  const availableAssets = assets.filter((asset: Asset) => {
    const typeOk = assetType === "all" || asset.type === assetType;
    const labelOk = assetLabel === "all" || asset.tags.some((tag) => tag.id === Number(assetLabel));
    const queryOk = !query || asset.displayName.toLowerCase().includes(query.toLowerCase());
    return typeOk && labelOk && queryOk;
  });
  const targetDeviceCount = useMemo(() => {
    const set = new Set(targetDevices);
    devices.forEach((device: Device) => { if (device.boundAt && device.tags.some((tag) => targetTags.includes(tag.id))) set.add(device.id); });
    return set.size;
  }, [targetDevices, targetTags, devices]);

  const save = async () => {
    setSaving(true);
    let target = editing;
    try {
      if (!target) {
        const created = (await api("/api/playlists", { method: "POST", body: JSON.stringify({ name, defaultImageDuration: duration }) })).playlist;
        target = { ...created, items: [] };
        setEditing(target);
      }
      await api(`/api/playlists/${target.id}`, { method: "PUT", body: JSON.stringify({ name, defaultImageDuration: duration, items }) });
      await reload();
      return target;
    } finally {
      setSaving(false);
    }
  };

  const publish = () => save().then((target) => api(`/api/playlists/${target.id}/publish`, { method: "POST", body: JSON.stringify({ tagIds: targetTags, deviceIds: targetDevices }) })).then((res) => { notify(`发布成功，命中 ${res.publish.resolvedDeviceIds.length} 台设备`); reload(); }).catch((e) => setError(e.message));

  const createPlaylist = () => {
    setSaving(true);
    api("/api/playlists", { method: "POST", body: JSON.stringify({ name: "新节目单", defaultImageDuration: 8 }) })
      .then(async (res) => {
        const created = { ...res.playlist, items: [] };
        setEditing(created);
        setName(created.name);
        setDuration(created.default_image_duration);
        setItems([]);
        notify("已新建节目单，可在右侧编辑");
        await reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return <section className="playlistWorkspace">
    <aside className="playlistList">
      <div className="sectionHead"><h2>节目单</h2><button disabled={saving} onClick={createPlaylist}><Plus size={16} />新建</button></div>
      {playlists.length === 0 && <p className="empty">还没有节目单，点击“新建”开始。</p>}
      {playlists.map((p: Playlist) => <div key={p.id} className={`playlistListItem ${editing?.id === p.id ? "selected" : ""}`} onClick={() => setEditing(p)}><div><strong>{p.name}</strong><span>{(p.items || []).length} 个素材 · {p.is_draft ? "草稿" : "已发布"}</span></div><button className="iconDanger" onClick={(e) => { e.stopPropagation(); confirm(`删除节目单「${p.name}」？`) && api(`/api/playlists/${p.id}`, { method: "DELETE" }).then(async () => { notify("节目单已删除"); setEditing(null); await reload(); }); }}><Trash2 size={15} /></button></div>)}
    </aside>
    <div className="playlistEditor">
      <div className="editorCard">
        <div className="editorTitle">
          <div><label>节目单名称</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>默认图片秒数</label><input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
        </div>
      </div>
      <div className="editorGrid">
        <div className="editorCard">
          <h3>素材选择器</h3>
          <div className="toolbar compact"><div className="searchBox"><Search size={15} /><input placeholder="搜索素材" value={query} onChange={(e) => setQuery(e.target.value)} /></div><Segment value={assetType} onChange={setAssetType} options={[["all", "全部"], ["image", "图片"], ["video", "视频"]]} /><select value={assetLabel} onChange={(e) => setAssetLabel(e.target.value)}><option value="all">全部标签</option>{labels.map((l: Label) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div className="assetSelectList">{availableAssets.map((asset: Asset) => <button key={asset.id} onClick={() => setItems([...items, { assetId: asset.id, imageFit: "contain" }])}>{asset.type === "image" ? <Image size={16} /> : <Video size={16} />}<span>{asset.displayName}</span><Plus size={15} /></button>)}</div>
        </div>
        <div className="editorCard">
          <h3>播放顺序</h3>
          <div className="playlistItems">
            {items.map((item, index) => {
              const asset = assetMap.get(item.assetId) as Asset;
              return <div className="itemRow" key={`${item.assetId}-${index}`}><span>{index + 1}</span><strong>{asset?.displayName}</strong>{asset?.type === "image" && <input type="number" placeholder={`${duration}s`} value={item.imageDuration || ""} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, imageDuration: Number(e.target.value) || undefined } : it))} />}{asset?.type === "image" && <select value={item.imageFit} onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, imageFit: e.target.value as any } : it))}><option value="contain">完整显示</option><option value="cover">填满裁剪</option></select>}<button className="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}><X size={15} /></button></div>;
            })}
            {items.length === 0 && <p className="empty">从左侧选择素材加入节目单。</p>}
          </div>
        </div>
      </div>
      <div className="editorCard">
        <div className="sectionHead"><h3>发布目标</h3><button onClick={() => setTargetDevices(devices.filter((d: Device) => d.boundAt).map((d: Device) => d.id))}>全选设备</button></div>
        <div className="targetGrid"><div><strong>按设备标签</strong><div className="chips">{tags.map((tag: Label) => <label key={tag.id} className="chip"><input type="checkbox" checked={targetTags.includes(tag.id)} onChange={(e) => setTargetTags(e.target.checked ? [...targetTags, tag.id] : targetTags.filter((id) => id !== tag.id))} />{tag.name}</label>)}</div></div><div><strong>单独选择设备</strong><div className="chips">{devices.filter((d: Device) => d.boundAt).map((d: Device) => <label key={d.id} className="chip"><input type="checkbox" checked={targetDevices.includes(d.id)} onChange={(e) => setTargetDevices(e.target.checked ? [...targetDevices, d.id] : targetDevices.filter((id) => id !== d.id))} />{d.name}</label>)}</div></div></div>
        <div className="footerActions"><span>当前将命中约 {targetDeviceCount} 台设备</span><button disabled={saving} onClick={() => save().then(() => notify("草稿已保存")).catch((e) => setError(e.message))}><Save size={16} />保存草稿</button><button disabled={saving} className="primary" onClick={publish}><Send size={16} />保存并发布</button></div>
      </div>
    </div>
  </section>;
}

function DefaultPlaylist({ assets, items, reload, notify, setError }: any) {
  const [draft, setDraft] = useState<PlaylistItem[]>(items.map((i: any) => ({ assetId: i.assetId, imageDuration: i.imageDuration, imageFit: i.imageFit })));
  const assetMap = useMemo(() => new Map(assets.map((a: Asset) => [a.id, a])), [assets]);
  return <section className="panel"><div className="sectionHead"><div><h2>默认广告</h2><p className="hint">设备还没有节目单时播放这里的内容。</p></div><button className="primary" onClick={() => api("/api/default-playlist", { method: "PUT", body: JSON.stringify({ items: draft }) }).then(() => { notify("默认广告已保存"); reload(); }).catch((e) => setError(e.message))}><Save size={16} />保存</button></div><div className="assetPicker">{assets.map((asset: Asset) => <button key={asset.id} onClick={() => setDraft([...draft, { assetId: asset.id, imageFit: "contain" }])}>{asset.type === "image" ? <Image size={16} /> : <Video size={16} />}{asset.displayName}</button>)}</div><div className="playlistItems">{draft.map((item, index) => <div className="itemRow" key={`${item.assetId}-${index}`}><span>{index + 1}</span><strong>{(assetMap.get(item.assetId) as Asset)?.displayName}</strong><button className="ghost" onClick={() => setDraft(draft.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>)}</div></section>;
}

function Segment({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <div className="segment">{options.map(([id, label]) => <button key={id} className={value === id ? "selected" : ""} onClick={() => onChange(id)}>{label}</button>)}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
