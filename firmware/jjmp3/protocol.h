#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>
#include "sdcard.h"
#include <Update.h>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "net.h"
#include "ui.h"
#include "mode.h"
#include "input.h"
#include "battery.h"
#include "os.h"
#include "profile.h"

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

// The 1024-byte OLED frame, base64-encoded. The core's base64::encode() mallocs
// ~1.4 KB every call and returns "-FAIL-" when the heap is short (Bluetooth mode
// leaves very little RAM), which is what made the app's screen mirror blank.
// Encode into a reusable static buffer instead, so repeated polls never allocate.
static const char *screenB64() {
  static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  static char out[1400];  // 1024 bytes -> 1368 chars, plus NUL
  const uint8_t *in = UI::buffer();
  size_t n = 0;
  uint32_t v = 0;
  int bits = 0;
  for (int i = 0; i < 1024; i++) {
    v = (v << 8) | in[i];
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out[n++] = B64[(v >> bits) & 0x3F];
    }
  }
  if (bits > 0) out[n++] = B64[(v << (6 - bits)) & 0x3F];
  while (n & 3) out[n++] = '=';
  out[n] = 0;
  return out;
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
#if JJ_BT
  JsonArray ev = bt["events"].to<JsonArray>();
  portENTER_CRITICAL(&BT::eventLock);
  for (int i = 0; i < BT::eventCount; i++) ev.add(String(BT::events[i]));
  portEXIT_CRITICAL(&BT::eventLock);
#endif
#if JJ_BT
  bt["bitpool"] = BT::agreedBitpool;
  bt["mtu"] = BT::a2dp.audioMtu;
#endif
  o["speaker"] = Speaker::stateName();
  JsonObject wifi = o["wifi"].to<JsonObject>();
  wifi["state"] = Net::stateName();
  wifi["ssid"] = Net::ssid;
  wifi["ip"] = Net::ip();
  o["heap"] = ESP.getFreeHeap();
  o["sd"] = Sd::ok;
  if (!Sd::ok) o["sd_report"] = Sd::report;
  o["minheap"] = ESP.getMinFreeHeap();
  o["maxblock"] = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  o["user"] = Profile::user;
  JsonObject perf = o["perf"].to<JsonObject>();
  perf["rd"] = Player::perfRead;
  perf["dec"] = Player::perfDecode;
  perf["bytes"] = Player::perfBytes;
  perf["miss"] = Player::perfLockMiss;
  perf["gate"] = Player::perfGate;
  perf["iter"] = Player::perfIter;
  perf["lockus"] = Player::perfLockWait;
  perf["cpu"] = ESP.getCpuFreqMHz();
  perf["pulls"] = Player::perfPulls;
  perf["pullfr"] = Player::perfPullFrames;
  perf["pullmax"] = Player::perfPullMax;
  perf["gaps"] = Player::perfGaps;
  perf["gapfr"] = Player::perfGapFrames;
  perf["burst"] = Player::perfBurst;
  perf["pullgap"] = Player::perfPullGapMax;
  perf["gapstage"] = Player::perfGapStage;
  Player::perfPullGapMax = 0;
  if (Battery::present) {
    JsonObject b = o["battery"].to<JsonObject>();
    b["pct"] = Battery::percent;
    b["v"] = roundf(Battery::volts * 100) / 100;
  }
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
#if JJ_BT
  } else if (cmd == "ring") {
    // diagnostics: {"frames":1024|2048} resizes the PCM ring now (Speaker::loop may resize it back)
    if (req["frames"].is<int>()) res["ok"] = Player::resizeRing(req["frames"].as<int>());
    res["frames"] = Player::ring.capacity();
#endif
  } else if (cmd == "speaker") {
    // {"on":true/false} switches the built-in speaker; without it, just report
    if (req["on"].is<bool>()) Speaker::set(req["on"]);
    res["on"] = Speaker::enabled;
    res["state"] = Speaker::stateName();
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
  } else if (cmd == "user_set") {
    Profile::setUser(req["name"] | "");
    UI::invalidate();
  } else if (cmd == "time_set") {
    Profile::setTime(req["t"] | 0, req["tz"] | 0);
  } else if (cmd == "sd_mount") {
    // remount the card (after plugging in a reader or card) and report what happened
    if (Sd::mount()) {
      SD.mkdir(MUSIC_DIR);
      SD.mkdir(ART_DIR);
      SD.mkdir(GAMES_DIR);
      res["tracks"] = Library::reload();
    }
    res["sd"] = Sd::ok;
    res["report"] = Sd::report;
  } else if (cmd == "i2c_scan") {
    // is the OLED there? levels of SDA/SCL (a powered module pulls them high), and every address that answers,
    // on the normal pins and on swapped pins
    auto scan = [](int sda, int scl) {
      String found;
      Wire.end();
      Wire.begin(sda, scl);
      Wire.setTimeOut(20);
      for (int a = 1; a < 127; a++) {
        Wire.beginTransmission(a);
        if (Wire.endTransmission() == 0) {
          char h[8];
          snprintf(h, sizeof h, "0x%02X ", a);
          found += h;
        }
      }
      return found.length() ? found : String("none");
    };
    // a real pull-up (the module's resistors, so the module has power) wins over the weak internal pull-down;
    // a pin that reads high only without the pull-down is just floating
    auto level = [](int pin) {
      pinMode(pin, INPUT_PULLDOWN);
      delay(2);
      int down = digitalRead(pin);
      pinMode(pin, INPUT_PULLUP);
      delay(2);
      int up = digitalRead(pin);
      pinMode(pin, INPUT);
      return String(down ? "pulled up" : up ? "floating" : "held low");
    };
    Wire.end();
    res["sda_in_use"] = UI::sdaPin;
    res["sda_level"] = level(PIN_SDA);
    res["sda_spare_level"] = level(PIN_SDA_SPARE);
    res["scl_level"] = level(PIN_SCL);
    res["found"] = scan(PIN_SDA, PIN_SCL);
    res["found_swapped"] = scan(PIN_SCL, PIN_SDA);
    // the display wired to other pins by mistake? Try every pair of free pins for an OLED address
    // (SD pins are left alone so the card stays mounted)
    static const int FREE[] = {2, 4, 13, 14, 15, 16, 17, 21, 22, 25, 26, 27, 32, 33};
    String elsewhere;
    for (int sda : FREE)
      for (int scl : FREE) {
        if (sda == scl) continue;
        Wire.end();
        Wire.begin(sda, scl);
        Wire.setTimeOut(5);
        for (int a : {0x3C, 0x3D}) {
          Wire.beginTransmission(a);
          if (Wire.endTransmission() == 0) elsewhere += "sda=" + String(sda) + " scl=" + String(scl) + " ";
        }
      }
    res["found_elsewhere"] = elsewhere.length() ? elsewhere : String("none");
    Wire.end();
    Wire.begin(UI::sdaPin, PIN_SCL);
    UI::invalidate();
  } else if (cmd == "oled_test") {
    // light every pixel straight from the controller (0xA5 ignores the image in RAM) for a few seconds,
    // slowly: tells a dead panel from a software or bus problem. 0 = the display took the command.
    auto send = [](std::initializer_list<uint8_t> bytes) {
      Wire.beginTransmission(OLED_ADDR);
      Wire.write(0x00);
      for (uint8_t b : bytes) Wire.write(b);
      return (int)Wire.endTransmission();
    };
    UI::begin();  // find the display again first
    Wire.setClock(100000);
    res["sda"] = UI::sdaPin;
    res["init_ok"] = UI::ok;
    res["power_on"] = send({0x8D, 0x14, 0x81, 0xFF, 0xAF});  // charge pump on, max contrast, display on
    res["all_on"] = send({0xA5});
    delay(req["ms"] | 10000);
    res["back"] = send({0xA4});
    UI::invalidate();
  } else if (cmd == "events") {    res["keys"] = Remote::pendingKeys;
    Remote::pendingKeys = "";
  } else if (cmd == "remote") {
    if (!(req["on"] | false)) {
      Remote::active = false;
    } else {
      if (req["title"].is<const char *>()) {
        Remote::title = req["title"].as<String>();
        Remote::artist = req["artist"] | "";
        Remote::setArt(req["art"] | "");
      }
      if (req["dur"].is<int>()) Remote::dur = req["dur"];
      Remote::posBase = req["pos"] | 0;
      Remote::posAt = millis();
      Remote::playing = req["playing"] | false;
      Remote::lastUpdate = millis();
      if (!Remote::active) {
        Remote::active = true;
        if (OS::top() != &remoteScreen) OS::push(&remoteScreen);
      }
      UI::invalidate();
    }
  } else if (cmd == "pintest") {
    // wire a jumper from D19 to the pin under test: drives it high and low, reports what D19 sees
    int out = req["out"] | -1;
    if (out != 5 && out != 18 && out != 23 && out != 13 && out != 14 && out != 25 && out != 26 && out != 27) {
      res["ok"] = false;
      res["error"] = "pick 5, 18, 23, 13, 14, 25, 26 or 27";
    } else {
      pinMode(19, INPUT);
      pinMode(out, OUTPUT);
      digitalWrite(out, HIGH);
      delay(5);
      int high = digitalRead(19);
      digitalWrite(out, LOW);
      delay(5);
      int low = digitalRead(19);
      pinMode(out, INPUT);
      res["high"] = high;
      res["low"] = low;
      res["follows"] = high == 1 && low == 0;
    }
  } else if (cmd == "btn_test") {
    // for a few seconds, which buttons pull their pin low? "stuck" = already low at the start
    uint32_t until = millis() + (req["ms"] | 15000);
    bool low[K_COUNT] = {}, atStart[K_COUNT];
    for (int k = 0; k < K_COUNT; k++) atStart[k] = digitalRead(Input::PINS[k]) == LOW;
    while (millis() < until) {
      for (int k = 0; k < K_COUNT; k++) low[k] |= digitalRead(Input::PINS[k]) == LOW;
      delay(5);
    }
    static const char *NAMES[K_COUNT] = {"left_D32", "play_D4", "right_D13", "up_D14", "down_D33"};
    for (int k = 0; k < K_COUNT; k++) res[NAMES[k]] = atStart[k] ? "stuck" : low[k] ? "pressed" : "nothing";
  } else if (cmd == "btn") {
    // the desktop app's buttons: same as pressing the real ones
    String k = req["k"] | "";
    int key = k == "left" ? K_LEFT : k == "play" ? K_PLAY : k == "right" ? K_RIGHT : k == "up" ? K_UP : k == "down" ? K_DOWN : -1;
    if (key < 0) {
      res["ok"] = false;
      res["error"] = "unknown button";
    } else {
      Input::inject((Key)key, req["hold"] | false);
    }
  } else if (cmd == "screen") {
    res["b64"] = screenB64();
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
        UI::doneReceiving();
        return replyError(id, "timeout");
      }
    }
    if (f.write(buf, want) != want) {
      f.close();
      SD.remove(tmp);
      UI::doneReceiving();
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
  UI::doneReceiving();
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

  // firmware update over Wi-Fi: POST /ota?size=N (multipart). Writes the other app slot and boots into it.
  s.on(
      "/ota", HTTP_POST,
      [&s]() {
        bool ok = !Update.hasError();
        s.send(200, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
        if (ok) Mode::restart();
      },
      [&s]() {
        HTTPUpload &up = s.upload();
        static uint32_t total = 0, lastUi = 0;
        if (up.status == UPLOAD_FILE_START) {
          Player::pause();
          total = s.arg("size").toInt();
          Update.begin(UPDATE_SIZE_UNKNOWN);
        } else if (up.status == UPLOAD_FILE_WRITE) {
          Update.write(up.buf, up.currentSize);
          if (millis() - lastUi > 400) {
            UI::progress("Updating firmware", up.totalSize, total);
            lastUi = millis();
          }
        } else if (up.status == UPLOAD_FILE_END) {
          Update.end(true);
          UI::doneReceiving();
        } else if (up.status == UPLOAD_FILE_ABORTED) {
          Update.abort();
          UI::doneReceiving();
        }
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
          UI::doneReceiving();
          if (httpResume) Player::play();
        } else if (up.status == UPLOAD_FILE_ABORTED) {
          UI::doneReceiving();
          if (httpUploadFile) httpUploadFile.close();
          SD.remove(tmp);
        }
      });
}
#else
static void httpRoutes() {}
#endif

}  // namespace Protocol