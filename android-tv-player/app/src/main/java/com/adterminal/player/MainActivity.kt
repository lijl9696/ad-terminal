package com.adterminal.player

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

data class PlayItem(
    val id: String,
    val name: String,
    val type: String,
    val url: String,
    val sha256: String,
    val durationSeconds: Int,
    val fit: String
)

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("player", Context.MODE_PRIVATE) }
    private var items = mutableListOf<PlayItem>()
    private var version = 0L
    private var index = 0
    private lateinit var root: FrameLayout
    private var stopped = false
    private var menuShowing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemUi()
        root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        setContentView(root)
        if (prefs.getString("deviceToken", null) == null) showSetup() else startPlayback()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        stopped = false
    }

    override fun onPause() {
        super.onPause()
        stopped = true
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && shouldOpenMenu(event)) {
            showPlayerMenu()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onBackPressed() {
        showPlayerMenu()
    }

    private fun shouldOpenMenu(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS || code == KeyEvent.KEYCODE_INFO) return true
        if (code == KeyEvent.KEYCODE_BACK) return true
        if (event.isLongPress && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)) return true
        return false
    }

    private fun hideSystemUi() {
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    private fun showSetup() {
        root.removeAllViews()
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.gravity = Gravity.CENTER
        box.setPadding(48, 48, 48, 48)
        val title = TextView(this)
        title.text = "广告终端播放器 0.1.1"
        title.textSize = 32f
        title.setTextColor(Color.WHITE)
        val input = EditText(this)
        input.hint = "后台地址，例如 http://192.168.1.10:8787"
        input.setText(prefs.getString("serverUrl", ""))
        input.setSingleLine(true)
        input.setTextColor(Color.WHITE)
        input.setHintTextColor(Color.GRAY)
        val button = Button(this)
        button.text = "生成配对码"
        val status = TextView(this)
        status.setTextColor(Color.WHITE)
        status.textSize = 22f
        status.gravity = Gravity.CENTER
        val help = TextView(this)
        help.text = "播放界面：长按确认键打开设置。若要让 Home 键回到本应用，请在系统默认桌面中选择广告终端播放器。"
        help.setTextColor(Color.LTGRAY)
        help.textSize = 16f
        help.gravity = Gravity.CENTER
        box.addView(title)
        box.addView(input, LinearLayout.LayoutParams(720, LinearLayout.LayoutParams.WRAP_CONTENT))
        box.addView(button)
        val settingsButton = Button(this)
        settingsButton.text = "打开默认桌面设置"
        settingsButton.setOnClickListener { openHomeSettings() }
        box.addView(settingsButton)
        box.addView(status)
        box.addView(help, LinearLayout.LayoutParams(900, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        button.setOnClickListener {
            val server = normalizeServerUrl(input.text.toString())
            if (server.isEmpty()) return@setOnClickListener
            prefs.edit().putString("serverUrl", server).apply()
            requestPairing(server, status)
        }
    }

    private fun showPlayerMenu() {
        if (menuShowing) return
        menuShowing = true
        runOnUiThread {
            val message = """
                当前后台：${prefs.getString("serverUrl", "未配置")}
                当前版本：$version
                App 版本：0.1.1

                打开方式：返回键、菜单键、设置键，或长按确认键。
                Home 键由电视系统处理，只有设为默认桌面后才会回到本应用。
            """.trimIndent()
            AlertDialog.Builder(this)
                .setTitle("播放器设置")
                .setMessage(message)
                .setPositiveButton("重新配置后台") { _, _ -> resetConfiguration() }
                .setNegativeButton("继续播放", null)
                .setNeutralButton("默认桌面设置") { _, _ -> openHomeSettings() }
                .setOnDismissListener { menuShowing = false }
                .show()
        }
    }

    private fun openHomeSettings() {
        try {
            if (Build.VERSION.SDK_INT >= 21) {
                startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
            } else {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            }
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    private fun resetConfiguration() {
        prefs.edit()
            .remove("deviceToken")
            .remove("pairingCode")
            .remove("pendingToken")
            .remove("manifest")
            .remove("version")
            .apply()
        items.clear()
        version = 0L
        index = 0
        showSetup()
    }

    private fun normalizeServerUrl(raw: String): String {
        var value = raw.trim().trimEnd('/')
        if (value.isEmpty()) return ""
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://$value"
        }
        val uri = Uri.parse(value)
        if ((uri.scheme == "http" || uri.scheme == "https") && uri.port == -1 && !uri.host.isNullOrEmpty()) {
            value = "$value:8787"
        }
        return value
    }

    private fun requestPairing(server: String, status: TextView) {
        thread {
            try {
                val res = postJson("$server/api/player/pairing", JSONObject().put("appVersion", "0.1.1"), null)
                val code = res.getString("pairingCode")
                val pending = res.getString("pendingToken")
                prefs.edit().putString("pairingCode", code).putString("pendingToken", pending).apply()
                runOnUiThread { status.text = "配对码\n$code\n请在后台设备页确认绑定" }
                pollPairing()
            } catch (e: Exception) {
                runOnUiThread { status.text = "连接失败：${e.message}" }
            }
        }
    }

    private fun pollPairing() {
        val server = prefs.getString("serverUrl", "") ?: return
        val code = prefs.getString("pairingCode", "") ?: return
        val pending = prefs.getString("pendingToken", "") ?: return
        handler.postDelayed({
            thread {
                try {
                    val res = getJson("$server/api/player/pairing/$code?pendingToken=$pending", null)
                    if (res.optBoolean("paired")) {
                        prefs.edit().putString("deviceToken", res.getString("deviceToken")).apply()
                        runOnUiThread { startPlayback() }
                    } else {
                        pollPairing()
                    }
                } catch (_: Exception) {
                    pollPairing()
                }
            }
        }, 3000)
    }

    private fun startPlayback() {
        root.removeAllViews()
        showMessage("正在加载节目...")
        loadCachedManifest()
        if (items.isNotEmpty()) playCurrent()
        scheduleSync()
    }

    private fun scheduleSync() {
        handler.postDelayed({
            if (!stopped) syncManifest()
            scheduleSync()
        }, 7000)
    }

    private fun syncManifest() {
        val server = prefs.getString("serverUrl", "") ?: return
        val token = prefs.getString("deviceToken", "") ?: return
        thread {
            try {
                val manifest = getJson("$server/api/player/manifest", token)
                val newVersion = manifest.optLong("version", 0)
                if (newVersion != version) {
                    val newItems = parseItems(manifest.getJSONArray("items"))
                    if (newItems.isEmpty()) {
                        runOnUiThread { showMessage("等待节目发布") }
                    } else if (downloadAll(server, newItems)) {
                        saveManifest(manifest)
                        version = newVersion
                        items = newItems.toMutableList()
                        index = 0
                        runOnUiThread { playCurrent() }
                    }
                }
                heartbeat()
            } catch (_: Exception) {
                if (items.isEmpty()) runOnUiThread { showMessage("离线，暂无缓存节目") }
            }
        }
    }

    private fun parseItems(array: JSONArray): List<PlayItem> {
        val list = mutableListOf<PlayItem>()
        for (i in 0 until array.length()) {
            val o = array.getJSONObject(i)
            list.add(PlayItem(
                o.getString("id"),
                o.getString("name"),
                o.getString("type"),
                o.getString("url"),
                o.getString("sha256"),
                o.optInt("durationSeconds", 8),
                o.optString("fit", "contain")
            ))
        }
        return list
    }

    private fun playCurrent() {
        if (items.isEmpty()) {
            showMessage("等待节目发布")
            return
        }
        val item = items[index % items.size]
        heartbeat(item.name)
        if (item.type == "image") playImage(item) else playVideo(item)
    }

    private fun playImage(item: PlayItem) {
        root.removeAllViews()
        val image = ImageView(this)
        image.setBackgroundColor(Color.BLACK)
        image.scaleType = if (item.fit == "cover") ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
        image.setImageURI(Uri.fromFile(localFile(item)))
        root.addView(image, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        handler.postDelayed({ next() }, item.durationSeconds.coerceAtLeast(1) * 1000L)
    }

    private fun playVideo(item: PlayItem) {
        root.removeAllViews()
        val video = VideoView(this)
        video.setVideoURI(Uri.fromFile(localFile(item)))
        video.setOnPreparedListener { it.isLooping = false; video.start() }
        video.setOnCompletionListener { next() }
        video.setOnErrorListener { _, _, _ -> next(); true }
        root.addView(video, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    private fun next() {
        index = (index + 1) % items.size
        playCurrent()
    }

    private fun showMessage(text: String) {
        root.removeAllViews()
        val view = TextView(this)
        view.text = text
        view.setTextColor(Color.WHITE)
        view.textSize = 30f
        view.gravity = Gravity.CENTER
        root.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    private fun downloadAll(server: String, newItems: List<PlayItem>): Boolean {
        val dir = File(filesDir, "cache")
        dir.mkdirs()
        for (item in newItems) {
            val file = localFile(item)
            if (file.exists() && fileSha(file) == item.sha256) continue
            val url = if (item.url.startsWith("http")) item.url else server + item.url
            URL(url).openStream().use { input -> file.outputStream().use { output -> input.copyTo(output) } }
            if (fileSha(file) != item.sha256) return false
        }
        dir.listFiles()?.forEach { file ->
            if (newItems.none { localFile(it).name == file.name }) file.delete()
        }
        return true
    }

    private fun localFile(item: PlayItem): File = File(File(filesDir, "cache"), item.sha256)

    private fun fileSha(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun saveManifest(json: JSONObject) {
        prefs.edit().putString("manifest", json.toString()).putLong("version", json.optLong("version", 0)).apply()
    }

    private fun loadCachedManifest() {
        val raw = prefs.getString("manifest", null) ?: return
        val manifest = JSONObject(raw)
        version = manifest.optLong("version", 0)
        items = parseItems(manifest.getJSONArray("items")).toMutableList()
    }

    private fun heartbeat(current: String? = null) {
        val server = prefs.getString("serverUrl", "") ?: return
        val token = prefs.getString("deviceToken", "") ?: return
        thread {
            try {
                val body = JSONObject().put("currentVersion", version).put("currentItem", current ?: JSONObject.NULL).put("appVersion", "0.1.1")
                postJson("$server/api/player/heartbeat", body, token)
            } catch (_: Exception) {}
        }
    }

    private fun getJson(url: String, token: String?): JSONObject {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        return JSONObject(conn.inputStream.bufferedReader().readText())
    }

    private fun postJson(url: String, body: JSONObject, token: String?): JSONObject {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        return JSONObject(conn.inputStream.bufferedReader().readText())
    }
}
