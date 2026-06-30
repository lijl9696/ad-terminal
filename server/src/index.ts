import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { all, db, get, initDb, json, mediaDir, now, parseJson } from "./db.js";

initDb();

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const sessionSecret = process.env.SESSION_SECRET || "local-dev-secret";

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser(sessionSecret));
app.use("/media", express.static(mediaDir, { immutable: true, maxAge: "1y" }));

const upload = multer({ dest: path.join(mediaDir, ".incoming"), limits: { fileSize: 1024 * 1024 * 1024 } });
fs.mkdirSync(path.join(mediaDir, ".incoming"), { recursive: true });

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function pairingCode() {
  return String(crypto.randomInt(100000, 999999));
}

function sha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assetType(mime: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.signedCookies?.session;
  if (!token) return res.status(401).json({ error: "未登录" });
  const row = get("SELECT * FROM sessions WHERE token = ? AND expires_at > ?", [token, now()]);
  if (!row) return res.status(401).json({ error: "登录已过期" });
  next();
}

function playerAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const device = get<any>("SELECT * FROM devices WHERE token = ? AND bound_at IS NOT NULL", [token]);
  if (!device) return res.status(401).json({ error: "设备未授权" });
  (req as any).device = device;
  next();
}

function tagsForDevice(deviceId: number) {
  return all("SELECT t.* FROM device_tags t JOIN device_tag_links l ON l.tag_id = t.id WHERE l.device_id = ? ORDER BY t.name", [deviceId]);
}

function serializeAsset(row: any) {
  return {
    id: row.id,
    folderId: row.folder_id,
    originalName: row.original_name,
    displayName: row.display_name,
    type: row.type,
    mimeType: row.mime_type,
    size: row.size,
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    url: `/media/${row.storage_name}`,
    sha256: row.sha256,
    createdAt: row.created_at
  };
}

function playlistItems(playlistId: number, table = "playlist_items") {
  const where = table === "playlist_items" ? "i.playlist_id = ?" : "1 = 1";
  const params = table === "playlist_items" ? [playlistId] : [];
  return all<any>(`
    SELECT i.*, a.display_name, a.type, a.mime_type, a.size, a.storage_name, a.sha256
    FROM ${table} i
    JOIN media_assets a ON a.id = i.asset_id
    WHERE ${where}
    ORDER BY i.sort_order ASC, i.id ASC
  `, params).map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    sortOrder: row.sort_order,
    imageDuration: row.image_duration,
    imageFit: row.image_fit,
    asset: {
      id: row.asset_id,
      displayName: row.display_name,
      type: row.type,
      mimeType: row.mime_type,
      size: row.size,
      url: `/media/${row.storage_name}`,
      sha256: row.sha256
    }
  }));
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = get<any>("SELECT * FROM admin_users WHERE username = ?", [username]);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "账号或密码不正确" });
  }
  const token = randomToken();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, user.id, expires);
  db.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = 1").run(now());
  res.cookie("session", token, { signed: true, httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ user: { username: user.username } });
});

app.post("/api/auth/logout", auth, (req, res) => {
  const token = req.signedCookies?.session;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, (_req, res) => {
  const user = get<any>("SELECT username, last_login_at FROM admin_users WHERE id = 1");
  res.json({ user: { username: user?.username, lastLoginAt: user?.last_login_at } });
});

app.get("/api/folders", auth, (_req, res) => res.json({ folders: all("SELECT * FROM media_folders ORDER BY name") }));
app.post("/api/folders", auth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "文件夹名称不能为空" });
  const result = db.prepare("INSERT INTO media_folders (name, created_at) VALUES (?, ?)").run(name, now());
  res.json({ folder: get("SELECT * FROM media_folders WHERE id = ?", [result.lastInsertRowid]) });
});
app.delete("/api/folders/:id", auth, (req, res) => {
  db.prepare("DELETE FROM media_folders WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/media", auth, (_req, res) => {
  res.json({ assets: all<any>("SELECT * FROM media_assets ORDER BY created_at DESC").map(serializeAsset) });
});

app.post("/api/media", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请选择文件" });
  const type = assetType(req.file.mimetype);
  if (!type) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "只支持图片和视频" });
  }
  const hash = sha256(req.file.path);
  const ext = path.extname(req.file.originalname).toLowerCase() || (type === "image" ? ".jpg" : ".mp4");
  const storageName = `${Date.now()}-${hash.slice(0, 12)}${ext}`;
  fs.renameSync(req.file.path, path.join(mediaDir, storageName));
  const folderId = req.body?.folderId ? Number(req.body.folderId) : null;
  const result = db.prepare(`
    INSERT INTO media_assets (folder_id, original_name, display_name, type, mime_type, size, storage_name, sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(folderId, req.file.originalname, req.file.originalname, type, req.file.mimetype, req.file.size, storageName, hash, now());
  res.json({ asset: serializeAsset(get("SELECT * FROM media_assets WHERE id = ?", [result.lastInsertRowid])) });
});

app.patch("/api/media/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE media_assets SET display_name = COALESCE(?, display_name), folder_id = ? WHERE id = ?")
    .run(req.body.displayName || null, req.body.folderId || null, id);
  res.json({ asset: serializeAsset(get("SELECT * FROM media_assets WHERE id = ?", [id])) });
});

app.delete("/api/media/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const asset = get<any>("SELECT * FROM media_assets WHERE id = ?", [id]);
  if (asset) {
    db.prepare("DELETE FROM media_assets WHERE id = ?").run(id);
    fs.rmSync(path.join(mediaDir, asset.storage_name), { force: true });
  }
  res.json({ ok: true });
});

app.get("/api/tags", auth, (_req, res) => res.json({ tags: all("SELECT * FROM device_tags ORDER BY name") }));
app.post("/api/tags", auth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const color = String(req.body?.color || "#1f7a5a");
  if (!name) return res.status(400).json({ error: "标签名不能为空" });
  const result = db.prepare("INSERT INTO device_tags (name, color, created_at) VALUES (?, ?, ?)").run(name, color, now());
  res.json({ tag: get("SELECT * FROM device_tags WHERE id = ?", [result.lastInsertRowid]) });
});

app.get("/api/devices", auth, (_req, res) => {
  const devices = all<any>("SELECT * FROM devices ORDER BY created_at DESC").map((device) => ({
    id: device.id,
    name: device.name,
    deviceCode: device.device_code,
    pairingCode: device.pairing_code,
    boundAt: device.bound_at,
    lastHeartbeatAt: device.last_heartbeat_at,
    online: device.last_heartbeat_at ? Date.now() - new Date(device.last_heartbeat_at).getTime() < 30000 : false,
    currentItem: device.current_item,
    currentVersion: device.current_version,
    ipAddress: device.ip_address,
    appVersion: device.app_version,
    tags: tagsForDevice(device.id)
  }));
  res.json({ devices });
});

app.post("/api/pairings/:code/approve", auth, (req, res) => {
  const code = String(req.params.code);
  const device = get<any>("SELECT * FROM devices WHERE pairing_code = ?", [code]);
  if (!device) return res.status(404).json({ error: "配对码不存在" });
  const token = randomToken();
  db.prepare("UPDATE devices SET name = ?, token = ?, bound_at = ?, pairing_code = NULL WHERE id = ?")
    .run(req.body.name || `电视-${code}`, token, now(), device.id);
  const tags = Array.isArray(req.body.tagIds) ? req.body.tagIds : [];
  db.prepare("DELETE FROM device_tag_links WHERE device_id = ?").run(device.id);
  for (const tagId of tags) db.prepare("INSERT OR IGNORE INTO device_tag_links (device_id, tag_id) VALUES (?, ?)").run(device.id, tagId);
  res.json({ device: get("SELECT * FROM devices WHERE id = ?", [device.id]) });
});

app.patch("/api/devices/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (req.body.name) db.prepare("UPDATE devices SET name = ? WHERE id = ?").run(req.body.name, id);
  if (Array.isArray(req.body.tagIds)) {
    db.prepare("DELETE FROM device_tag_links WHERE device_id = ?").run(id);
    for (const tagId of req.body.tagIds) db.prepare("INSERT OR IGNORE INTO device_tag_links (device_id, tag_id) VALUES (?, ?)").run(id, Number(tagId));
  }
  res.json({ ok: true });
});

app.get("/api/playlists", auth, (_req, res) => {
  const playlists = all<any>("SELECT * FROM playlists ORDER BY updated_at DESC").map((p) => ({ ...p, items: playlistItems(p.id) }));
  res.json({ playlists });
});

app.post("/api/playlists", auth, (req, res) => {
  const t = now();
  const result = db.prepare("INSERT INTO playlists (name, default_image_duration, is_draft, created_at, updated_at) VALUES (?, ?, 1, ?, ?)")
    .run(req.body.name || "新节目单", Number(req.body.defaultImageDuration || 8), t, t);
  res.json({ playlist: get("SELECT * FROM playlists WHERE id = ?", [result.lastInsertRowid]) });
});

app.put("/api/playlists/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  db.prepare("UPDATE playlists SET name = ?, default_image_duration = ?, is_draft = 1, updated_at = ? WHERE id = ?")
    .run(req.body.name || "未命名节目单", Number(req.body.defaultImageDuration || 8), now(), id);
  db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(id);
  items.forEach((item: any, index: number) => {
    db.prepare("INSERT INTO playlist_items (playlist_id, asset_id, sort_order, image_duration, image_fit) VALUES (?, ?, ?, ?, ?)")
      .run(id, Number(item.assetId), index, item.imageDuration || null, item.imageFit || "contain");
  });
  res.json({ ok: true });
});

app.delete("/api/playlists/:id", auth, (req, res) => {
  db.prepare("DELETE FROM playlists WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.post("/api/playlists/:id/publish", auth, (req, res) => {
  const playlistId = Number(req.params.id);
  const tagIds = Array.isArray(req.body.tagIds) ? req.body.tagIds.map(Number) : [];
  const deviceIds = Array.isArray(req.body.deviceIds) ? req.body.deviceIds.map(Number) : [];
  const resolved = new Set<number>(deviceIds);
  for (const tagId of tagIds) {
    all<any>("SELECT device_id FROM device_tag_links WHERE tag_id = ?", [tagId]).forEach((row) => resolved.add(row.device_id));
  }
  const resolvedIds = [...resolved];
  const version = Date.now();
  const result = db.prepare(`
    INSERT INTO publish_records (playlist_id, version, target_tag_ids, target_device_ids, resolved_device_ids, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(playlistId, version, json(tagIds), json(deviceIds), json(resolvedIds), now());
  for (const deviceId of resolvedIds) {
    db.prepare(`
      INSERT INTO device_assignments (device_id, playlist_id, publish_id, version, assigned_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET playlist_id = excluded.playlist_id, publish_id = excluded.publish_id, version = excluded.version, assigned_at = excluded.assigned_at
    `).run(deviceId, playlistId, result.lastInsertRowid, version, now());
  }
  db.prepare("UPDATE playlists SET is_draft = 0, updated_at = ? WHERE id = ?").run(now(), playlistId);
  res.json({ publish: { id: result.lastInsertRowid, version, resolvedDeviceIds: resolvedIds } });
});

app.get("/api/default-playlist", auth, (_req, res) => res.json({ items: playlistItems(0, "default_playlist_items") }));
app.put("/api/default-playlist", auth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  db.prepare("DELETE FROM default_playlist_items").run();
  items.forEach((item: any, index: number) => {
    db.prepare("INSERT INTO default_playlist_items (asset_id, sort_order, image_duration, image_fit) VALUES (?, ?, ?, ?)")
      .run(item.assetId, index, item.imageDuration || null, item.imageFit || "contain");
  });
  res.json({ ok: true });
});

app.post("/api/player/pairing", (req, res) => {
  let code = pairingCode();
  while (get("SELECT id FROM devices WHERE pairing_code = ?", [code])) code = pairingCode();
  const pendingToken = randomToken();
  const deviceCode = randomToken(8);
  db.prepare(`
    INSERT INTO devices (name, device_code, pending_token, pairing_code, ip_address, app_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`待绑定-${code}`, deviceCode, pendingToken, code, req.ip, req.body?.appVersion || null, now());
  res.json({ pairingCode: code, pendingToken });
});

app.get("/api/player/pairing/:code", (req, res) => {
  const device = get<any>("SELECT * FROM devices WHERE pending_token = ? AND (pairing_code = ? OR token IS NOT NULL)", [req.query.pendingToken, req.params.code]);
  if (!device || !device.token) return res.json({ paired: false });
  res.json({ paired: true, deviceToken: device.token, deviceName: device.name });
});

app.get("/api/player/manifest", playerAuth, (req, res) => {
  const device = (req as any).device;
  const assignment = get<any>("SELECT * FROM device_assignments WHERE device_id = ?", [device.id]);
  let version = assignment?.version || 0;
  let items = assignment ? playlistItems(assignment.playlist_id) : playlistItems(0, "default_playlist_items");
  let source = assignment ? "playlist" : "default";
  if (!assignment && items.length > 0) version = 1;
  res.json({
    deviceId: device.id,
    version,
    source,
    items: items.map((item) => ({
      id: item.id,
      assetId: item.asset.id,
      name: item.asset.displayName,
      type: item.asset.type,
      url: item.asset.url,
      sha256: item.asset.sha256,
      durationSeconds: item.imageDuration || 8,
      fit: item.imageFit
    }))
  });
});

app.post("/api/player/heartbeat", playerAuth, (req, res) => {
  const device = (req as any).device;
  db.prepare("UPDATE devices SET last_heartbeat_at = ?, current_item = ?, current_version = ?, ip_address = ?, app_version = COALESCE(?, app_version) WHERE id = ?")
    .run(now(), req.body?.currentItem || null, req.body?.currentVersion || null, req.ip, req.body?.appVersion || null, device.id);
  res.json({ ok: true });
});

const webDist = path.resolve("web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.listen(port, host, () => {
  console.log(`Ad terminal server listening on http://${host}:${port}`);
});
