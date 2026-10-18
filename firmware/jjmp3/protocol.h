#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <base64.h>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "net.h"
#include "ui.h"
#include "mode.h"

// JSON command protocol shared by USB serial and HTTP.
// Request:  {"id":1,"cmd":"status", ...}
// Response: {"id":1,"ok":true, ...}   or   {"id":1,"ok":false,"error":"..."}
namespace Protocol {

static void mkdirs(const String &path) {
  int slash = 0;
  while ((slash = path.indexOf('/', slash + 1)) > 0) SD.mkdir(path.substring(0, slash));
}

static void sdInfo(JsonObject o) {
  o["total"] = SD.totalBytes();
  o["used"] = SD.usedBytes();
}

static void status(JsonObject o) {
  o["mode"] = Mode::name();
  o["state"] = Player::stateName();
  o["track"] = Player::current.id;
  o["title"] = Player::current.title;
  o["artist"] = Player::current.artist;
  o["pos"] = Player::position();
  o["dur"] = Player::current.dur;
  o["vol"] = Player::volume;
  o["qpos"] = Player::qpos;
  o["qlen"] = Player::queue.size();
  o["repeat"] = (int)Player::repeat;
  o["shuffle"] = Player::shuffle;
  o["tracks"] = Library::count();
  if (Player::lastError.length()) o["error"] = Player::lastError;
  JsonObject bt = o["bt"].to<JsonObject>();
  bt["state"] = BT::stateName();
  bt["name"] = BT::target;
  JsonObject wifi = o["wifi"].to<JsonObject>();
  wifi["state"] = Net::stateName();
  wifi["ssid"] = Net::ssid;
  wifi["ip"] = Net::ip();
  o["heap"] = ESP.getFreeHeap();
}

// Handles every command except binary file transfers (transport specific)
static void handle(JsonDocument &req, JsonObject res) {
  String cmd = req["cmd"] | "";
  res["ok"] = true;

  if (cmd == "hello") {
    res["name"] = DEVICE_NAME;
    res["fw"] = FW_VERSION;
    res["mode"] = Mode::name();
    res["tracks"] = Library::count();
  } else if (cmd == "status") {
    status(res);
  } else if (cmd == "sd") {
    sdInfo(res);
  } else if (!JJ_BT && (cmd == "play" || cmd == "toggle" || cmd == "next" || cmd == "prev")) {
    res["ok"] = false;
    res["error"] = "The player is in Wi-Fi mode. Switch to music mode to listen.";
  } else if (cmd == "play") {
    if (req["queue"].is<JsonArray>()) {
      std::vector<String> ids;
      for (JsonVariant v : req["queue"].as<JsonArray>()) ids.push_back(v.as<String>());
      Player::setQueue(ids, req["index"] | 0);
    } else if (req["index"].is<int>()) {
      Player::playIndex(req["index"].as<int>());
    } else {
      Player::play();
    }
  } else if (cmd == "pause") {
    Player::pause();
  } else if (cmd == "toggle") {
    Player::toggle();
  } else if (cmd == "next") {
    Player::next();
  } else if (cmd == "prev") {
    Player::prev();
  } else if (cmd == "seek") {
    Player::seek(req["pos"] | 0);
  } else if (cmd == "vol") {
    Player::setVolume(req["v"] | (int)Player::volume);
    BT::applyVolume();
    UI::toast("Volume " + String(Player::volume) + "%", 900);
  } else if (cmd == "mode") {
    if (req["repeat"].is<int>()) Player::repeat = (RepeatMode)constrain(req["repeat"].as<int>(), 0, 2);
    if (req["shuffle"].is<bool>()) Player::shuffle = req["shuffle"].as<bool>();
    prefs.putUChar("repeat", Player::repeat);
    prefs.putBool("shuffle", Player::shuffle);
  } else if (cmd == "reload") {
    res["tracks"] = Library::reload();
    if (Player::queue.empty()) Player::loadQueue();
    UI::invalidate();
  } else if (cmd == "ls") {
    String path = req["path"] | "/";
    File dir = SD.open(path);
    JsonArray arr = res["files"].to<JsonArray>();
    if (dir && dir.isDirectory()) {
      for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
        JsonObject e = arr.add<JsonObject>();
        e["name"] = String(f.name());
        e["size"] = f.size();
        e["dir"] = f.isDirectory();
        f.close();
      }
    }
    if (dir) dir.close();
  } else if (cmd == "rm") {
    String path = req["path"] | "";
    Player::releaseFile(path);
    res["ok"] = path.length() && SD.remove(path);
  } else if (cmd == "screen") {
    res["b64"] = base64::encode(UI::buffer(), 1024);
  } else if (cmd == "wifi_set") {
    Net::setCredentials(req["ssid"] | "", req["pass"] | "");
    if (JJ_WIFI) UI::toast("Joining Wi-Fi...");
  } else if (cmd == "wifi_forget") {
    Net::forget();
  } else if (cmd == "mode_switch") {
    const char *err = Mode::prepareSwitch();
    if (err) {
      res["ok"] = false;
      res["error"] = err;
    }
#if JJ_WIFI
  } else if (cmd == "wifi_scan") {
    int n = WiFi.scanNetworks();
    JsonArray arr = res["networks"].to<JsonArray>();
    for (int i = 0; i < n; i++) {
      JsonObject e = arr.add<JsonObject>();
      e["ssid"] = WiFi.SSID(i);
      e["rssi"] = WiFi.RSSI(i);
      e["lock"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }
    WiFi.scanDelete();
#else
  } else if (cmd == "wifi_scan") {
    res["ok"] = false;
    res["error"] = "Scanning needs Wi-Fi mode. Type the network name instead.";
#endif
  } else if (cmd == "bt_scan") {
    BT::scan();
  } else if (cmd == "bt_stop") {
    BT::stopScan();
  } else if (cmd == "bt_devices") {
    JsonArray arr = res["devices"].to<JsonArray>();
    portENTER_CRITICAL(&BT::foundLock);
    for (int i = 0; i < BT::foundCount; i++) {
      JsonObject e = arr.add<JsonObject>();
      e["name"] = String(BT::found[i].name);
      e["rssi"] = BT::found[i].rssi;
    }
    portEXIT_CRITICAL(&BT::foundLock);
    res["state"] = BT::stateName();
  } else if (cmd == "bt_connect" || cmd == "bt_forget" || cmd == "reboot") {
    // handled after the response is sent (the device restarts)
  } else {
    res["ok"] = false;
    res["error"] = "unknown command";
  }
}

// Commands that restart the device must run after the reply went out
static bool lastFailed = false;
static bool res_failed(JsonDocument &) { return lastFailed; }

static void afterReply(JsonDocument &req) {
  String cmd = req["cmd"] | "";
  if (cmd == "bt_connect") BT::connectTo(req["name"] | "");
  else if (cmd == "bt_forget") BT::forget();
  else if (cmd == "reboot" || (cmd == "mode_switch" && !res_failed(req))) {
    Mode::restart();
  }
}

// ---------- USB serial transport ----------

static void reply(JsonDocument &res) {
  serializeJson(res, Serial);
  Serial.write('\n');
}

static void replyError(int id, const char *error) {
  Serial.printf("{\"id\":%d,\"ok\":false,\"error\":\"%s\"}\n", id, error);
}

// put: header line, then raw bytes in XFER_CHUNK pieces, each acknowledged
static void serialPut(int id, const String &path, uint32_t size) {
  static uint8_t buf[XFER_CHUNK];
  bool resume = Player::isPlaying();
  Player::pause();
  Player::releaseFile(path);
  mkdirs(path);
  String tmp = path + ".part";
  SD.remove(tmp);
  File f = SD.open(tmp, FILE_WRITE);
  if (!f) return replyError(id, "cannot open file");

  Serial.printf("{\"id\":%d,\"ok\":true,\"chunk\":%d}\n", id, XFER_CHUNK);
  uint32_t got = 0, lastByte = millis(), lastUi = 0;
  while (got < size) {
    uint32_t want = min<uint32_t>(XFER_CHUNK, size - got), n = 0;
    while (n < want) {
      int avail = Serial.available();
      if (avail > 0) {
        n += Serial.readBytes(buf + n, min<uint32_t>(avail, want - n));
        lastByte = millis();
      } else if (millis() - lastByte > 5000) {
        f.close();
        SD.remove(tmp);
        return replyError(id, "timeout");
      }
    }
    if (f.write(buf, want) != want) {
      f.close();
      SD.remove(tmp);
      return replyError(id, "write failed (card full?)");
    }
    got += want;
    Serial.printf("{\"ack\":%lu}\n", (unsigned long)got);
    if (millis() - lastUi > 400) {
      UI::progress("Receiving", got, size);
      lastUi = millis();
    }
  }
  f.close();
  SD.remove(path);
  SD.rename(tmp, path);
  Serial.printf("{\"id\":%d,\"ok\":true,\"done\":true,\"size\":%lu}\n", id, (unsigned long)got);
  if (resume) Player::play();
}

// get: header line with the size, then the raw bytes
static void serialGet(int id, const String &path) {
  File f = SD.open(path, FILE_READ);
  if (!f || f.isDirectory()) return replyError(id, "not found");
  Serial.printf("{\"id\":%d,\"ok\":true,\"size\":%lu}\n", id, (unsigned long)f.size());
  static uint8_t buf[1024];
  int n;
  while ((n = f.read(buf, sizeof(buf))) > 0) Serial.write(buf, n);
  f.close();
}

static void serialLine(const String &line) {
  JsonDocument req;
  if (deserializeJson(req, line)) return;  // not for us (noise, boot logs)
  int id = req["id"] | 0;
  String cmd = req["cmd"] | "";
  if (cmd == "put") return serialPut(id, req["path"] | "", req["size"] | 0);
  if (cmd == "get") return serialGet(id, req["path"] | "");

  JsonDocument res;
  handle(req, res.to<JsonObject>());
  lastFailed = !(res["ok"] | false);
  res["id"] = id;
  reply(res);
  Serial.flush();
  afterReply(req);
}

static void serialLoop() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (line.length()) serialLine(line);
      line = "";
    } else if (c != '\r') {
      if (line.length() < 2048) line += c;
    }
  }
}

// ---------- HTTP transport (when on Wi-Fi) ----------
#if JJ_WIFI

static File httpUploadFile;
static bool httpResume = false;

static void httpRoutes() {
  WebServer &s = Net::server;

  s.on("/cmd", HTTP_POST, [&s]() {
    JsonDocument req, res;
    if (deserializeJson(req, s.arg("plain"))) {
      s.send(400, "application/json", "{\"ok\":false,\"error\":\"bad json\"}");
      return;
    }
    handle(req, res.to<JsonObject>());
    lastFailed = !(res["ok"] | false);
    if (req["id"].is<int>()) res["id"] = req["id"];
    String out;
    serializeJson(res, out);
    s.send(200, "application/json", out);
    afterReply(req);
  });

  s.on("/file", HTTP_GET, [&s]() {
    File f = SD.open(s.arg("path"), FILE_READ);
    if (!f || f.isDirectory()) {
      s.send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}");
      return;
    }
    s.streamFile(f, "application/octet-stream");
    f.close();
  });

  // multipart upload: POST /upload?path=/music/x.mp3&size=123
  s.on(
      "/upload", HTTP_POST,
      [&s]() { s.send(200, "application/json", "{\"ok\":true,\"done\":true}"); },
      [&s]() {
        HTTPUpload &up = s.upload();
        String path = s.arg("path");
        String tmp = path + ".part";
        static uint32_t total = 0, lastUi = 0;
        if (up.status == UPLOAD_FILE_START) {
          httpResume = Player::isPlaying();
          Player::pause();
          Player::releaseFile(path);
          mkdirs(path);
          SD.remove(tmp);
          httpUploadFile = SD.open(tmp, FILE_WRITE);
          total = s.arg("size").toInt();
        } else if (up.status == UPLOAD_FILE_WRITE) {
          if (httpUploadFile) httpUploadFile.write(up.buf, up.currentSize);
          if (millis() - lastUi > 400) {
            UI::progress("Receiving (Wi-Fi)", up.totalSize, total);
            lastUi = millis();
          }
        } else if (up.status == UPLOAD_FILE_END) {
          if (httpUploadFile) {
            httpUploadFile.close();
            SD.remove(path);
            SD.rename(tmp, path);
          }
          if (httpResume) Player::play();
        } else if (up.status == UPLOAD_FILE_ABORTED) {
          if (httpUploadFile) httpUploadFile.close();
          SD.remove(tmp);
        }
      });
}
#else
static void httpRoutes() {}
#endif

}  // namespace Protocol