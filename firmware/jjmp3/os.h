#pragma once
#include <Arduino.h>
#include <SD.h>
#include <vector>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "net.h"
#include "mode.h"
#include "ui.h"
#include "screen.h"
#include "keyboard.h"
#include "games.h"
#if JJ_WIFI
#include <WiFi.h>
#endif

// The player's OS: an iPod-style menu on the OLED, driven by < P > and - +.
namespace OS {
static void openNowPlaying();
static bool canPlay() {
  if (JJ_BT) return true;
  UI::toast("Music mode needed", 1600);
  return false;
}
}  // namespace OS

// ---------- Now playing ----------
struct NowPlayingScreen : Screen {
  String title() override {
    if (!Player::current.id.length()) return "Now playing";
    return UI::fmtTime(Player::position()) + "/" + UI::fmtTime(Player::current.dur);
  }
  bool animating() override { return true; }
  void draw() override { UI::drawNowPlaying(); }
  void key(const KeyEvent &e) override {
    if (e.key == K_PLAY && e.act == A_HOLD) return OS::back();
    if (e.key == K_PLAY && e.act == A_PRESS && OS::canPlay()) Player::toggle();
    if (e.key == K_LEFT && e.act == A_PRESS) Player::prev();
    if (e.key == K_RIGHT && e.act == A_PRESS) Player::next();
    if (e.key == K_LEFT && e.act == A_REPEAT) Player::seek(Player::position() > 5 ? Player::position() - 5 : 0);
    if (e.key == K_RIGHT && e.act == A_REPEAT) Player::seek(Player::position() + 5);
  }
};
static NowPlayingScreen nowPlayingScreen;
static void OS::openNowPlaying() { OS::push(&nowPlayingScreen); }

// ---------- Music: every song on the card ----------
struct MusicScreen : ListScreen {
  struct Row {
    int idx = -1;
    String title;
    uint32_t dur = 0;
  } cache[8];

  Row &row(int i) {
    Row &r = cache[i % 8];
    if (r.idx != i) {
      Track t;
      r.idx = i;
      r.title = Library::trackAt(i, t) ? t.title : String("?");
      r.dur = t.dur;
    }
    return r;
  }
  void enter() override {
    for (auto &r : cache) r.idx = -1;
    ListScreen::enter();
  }
  String title() override { return "Music"; }
  int count() override { return Library::count() ? Library::count() + 1 : 0; }
  String label(int i) override { return i == 0 ? String("Shuffle all") : row(i - 1).title; }
  String detail(int i) override { return i == 0 ? String("") : UI::fmtTime(row(i - 1).dur); }
  String emptyText() override { return "No songs yet"; }
  void select(int i) override {
    if (!OS::canPlay()) return;
    std::vector<String> ids;
    Library::allIds(ids);
    if (i == 0) {
      Player::shuffle = true;
      Player::setQueue(ids, random(ids.size()));
    } else {
      Player::setQueue(ids, i - 1);
    }
    OS::openNowPlaying();
  }
};
static MusicScreen musicScreen;

// ---------- Playlists (written to the card by the desktop app) ----------
struct PlaylistScreen : ListScreen {
  String name;
  std::vector<String> ids, titles;
  void open(const String &n, const String &csv) {
    name = n;
    ids.clear();
    titles.clear();
    int start = 0;
    while (start < (int)csv.length() && ids.size() < 200) {
      int comma = csv.indexOf(',', start);
      String id = csv.substring(start, comma < 0 ? csv.length() : comma);
      id.trim();
      if (id.length()) ids.push_back(id);
      if (comma < 0) break;
      start = comma + 1;
    }
    titles.assign(ids.size(), String("?"));
    Library::forEach([&](uint32_t, const Track &t) {  // one pass for all the names
      for (size_t k = 0; k < ids.size(); k++)
        if (ids[k] == t.id) titles[k] = t.title;
      return true;
    });
    sel = scroll = 0;
    OS::push(this);
  }
  String title() override { return name; }
  int count() override { return ids.empty() ? 0 : ids.size() + 1; }
  String label(int i) override { return i == 0 ? String("Play all") : titles[i - 1]; }
  String emptyText() override { return "Empty playlist"; }
  void select(int i) override {
    if (!OS::canPlay()) return;
    Player::setQueue(ids, i == 0 ? 0 : i - 1);
    OS::openNowPlaying();
  }
};
static PlaylistScreen playlistScreen;

struct PlaylistsScreen : ListScreen {
  struct Entry {
    String name, ids;
    int n;
  };
  std::vector<Entry> lists;
  void enter() override {
    lists.clear();
    File f = SD.open(PLAYLISTS_PATH, FILE_READ);
    while (f && f.available() && lists.size() < 60) {
      String line = f.readStringUntil('\n');
      int a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
      if (a < 0 || b < 0) continue;
      String ids = line.substring(b + 1);
      ids.trim();
      int n = ids.length() ? 1 : 0;
      for (char c : ids) n += c == ',';
      lists.push_back({line.substring(a + 1, b), ids, n});
    }
    if (f) f.close();
    ListScreen::enter();
  }
  String title() override { return "Playlists"; }
  int count() override { return lists.size(); }
  String label(int i) override { return lists[i].name; }
  String detail(int i) override { return String(lists[i].n); }
  String emptyText() override { return "Make some in the app"; }
  void select(int i) override { playlistScreen.open(lists[i].name, lists[i].ids); }
};
static PlaylistsScreen playlistsScreen;

// ---------- Games ----------
struct GamesScreen : ListScreen {
  std::vector<String> files;
  void enter() override {
    files.clear();
    File dir = SD.open(GAMES_DIR);
    if (dir && dir.isDirectory())
      for (File f = dir.openNextFile(); f && files.size() < 50; f = dir.openNextFile()) {
        String n = f.name();
        if (!f.isDirectory() && (n.endsWith(".ch8") || n.endsWith(".CH8"))) files.push_back(n);
        f.close();
      }
    if (dir) dir.close();
    ListScreen::enter();
  }
  String title() override { return "Games"; }
  int count() override { return files.size() + 1; }
  String label(int i) override {
    if (i == 0) return "Snake";
    String n = files[i - 1];
    return n.substring(0, n.length() - 4);
  }
  String detail(int i) override { return i == 0 ? String("") : String("8"); }
  void select(int i) override {
    if (i == 0) return OS::push(&snakeScreen);
    chip8Screen.load(String(GAMES_DIR) + "/" + files[i - 1]);
    OS::push(&chip8Screen);
  }
};
static GamesScreen gamesScreen;

// ---------- Settings ----------
static void switchModeAsk() {
  confirmScreen.ask(JJ_WIFI ? "Music mode?" : "Wi-Fi mode?", JJ_WIFI ? "Restart for music" : "Restart for Wi-Fi", [] {
    const char *err = Mode::prepareSwitch();
    if (err) return UI::toast(err, 2500);
    UI::toast("Restarting...", 3000);
    if (UI::redrawHook) UI::redrawHook();
    Mode::restart();
  });
}

struct BtScanScreen : ListScreen {
  void enter() override {
    BT::scan();
    ListScreen::enter();
  }
  String title() override { return "Pick headphones"; }
  bool animating() override { return true; }  // the list fills in as devices answer
  int count() override { return BT::foundCount; }
  String label(int i) override { return BT::found[i].name; }
  String detail(int i) override {
    int r = BT::found[i].rssi;
    return r > -60 ? "|||" : r > -75 ? "||" : "|";
  }
  void draw() override {
    if (!count()) {
      UI::centerText("Searching...", 22);
      UI::centerText("Hold the headphones'", 38);
      UI::centerText("pairing button", 50);
      return;
    }
    ListScreen::draw();
  }
  void key(const KeyEvent &e) override {
    if (e.key == K_PLAY && e.act == A_HOLD) BT::stopScan();
    ListScreen::key(e);
  }
  void select(int i) override {
    UI::toast("Connecting...", 4000);
    if (UI::redrawHook) UI::redrawHook();
    BT::connectTo(BT::found[i].name);  // restarts into the new pairing
  }
};
static BtScanScreen btScanScreen;

struct BluetoothScreen : ListScreen {
  String title() override { return "Bluetooth"; }
  int count() override { return JJ_WIFI ? 2 : (BT::target[0] ? 3 : 2); }
  String label(int i) override {
    if (JJ_WIFI) return i == 0 ? String("Off in Wi-Fi mode") : String("Switch to music");
    if (i == 0) return BT::connected() ? "On: " + String(BT::target) : BT::target[0] ? "Looking: " + String(BT::target) : String("No headphones yet");
    if (i == 1) return BT::target[0] ? "Pair other ones" : "Find headphones";
    return "Forget " + String(BT::target);
  }
  void select(int i) override {
    if (JJ_WIFI) {
      if (i == 1) switchModeAsk();
      return;
    }
    if (i == 1) OS::push(&btScanScreen);
    if (i == 2) confirmScreen.ask("Forget?", "Forget them", [] { BT::forget(); });
  }
};
static BluetoothScreen bluetoothScreen;

static void askPasswordFor(const String &ssid) {
  keyboardScreen.open("Password", "", true, [ssid](const String &pass) {
    Net::setCredentials(ssid, pass);
    if (JJ_WIFI) UI::toast("Joining " + ssid, 2500);
    else confirmScreen.ask("Join now?", "Restart for Wi-Fi", [] {
        const char *err = Mode::prepareSwitch();
        if (err) return UI::toast(err, 2500);
        Mode::restart();
      });
  });
}

#if JJ_WIFI
struct WifiScanScreen : ListScreen {
  struct Net_ {
    String ssid;
    int rssi;
    bool lock;
  };
  std::vector<Net_> nets;
  bool scanning = false;
  void enter() override {
    nets.clear();
    WiFi.scanNetworks(true);  // async, so the screen keeps drawing
    scanning = true;
    ListScreen::enter();
  }
  void tick() override {
    if (!scanning) return;
    int n = WiFi.scanComplete();
    if (n < 0) return;
    for (int i = 0; i < n && nets.size() < 20; i++)
      if (WiFi.SSID(i).length()) nets.push_back({WiFi.SSID(i), WiFi.RSSI(i), WiFi.encryptionType(i) != WIFI_AUTH_OPEN});
    WiFi.scanDelete();
    scanning = false;
    UI::invalidate();
  }
  String title() override { return "Networks"; }
  bool animating() override { return scanning; }
  int count() override { return nets.size(); }
  String label(int i) override { return nets[i].ssid; }
  String detail(int i) override { return String(nets[i].lock ? "* " : "") + (nets[i].rssi > -60 ? "|||" : nets[i].rssi > -75 ? "||" : "|"); }
  String emptyText() override { return scanning ? "Scanning..." : "No networks found"; }
  void select(int i) override {
    if (nets[i].lock) askPasswordFor(nets[i].ssid);
    else {
      Net::setCredentials(nets[i].ssid, "");
      UI::toast("Joining " + nets[i].ssid, 2500);
      OS::back();
    }
  }
};
static WifiScanScreen wifiScanScreen;
#endif

struct WifiScreen : ListScreen {
  // rows: status, [choose network], type a name, [forget], mode switch
  std::vector<int> rows() {
    std::vector<int> r = {0};
    if (JJ_WIFI) r.push_back(1);
    r.push_back(2);
    if (Net::ssid.length()) r.push_back(3);
    r.push_back(4);
    return r;
  }
  String title() override { return "Wi-Fi"; }
  int count() override { return rows().size(); }
  String label(int i) override {
    switch (rows()[i]) {
      case 0: {
        String st = Net::stateName();
        if (!Net::ssid.length()) return "Not set up";
        if (st == "connected") return "On: " + Net::ssid;
        if (st == "failed") return "Can't join " + Net::ssid;
        if (st == "connecting") return "Joining " + Net::ssid;
        return "Saved: " + Net::ssid;
      }
      case 1: return "Choose network";
      case 2: return "Type a name";
      case 3: return "Forget network";
      default: return JJ_WIFI ? "Switch to music" : "Switch to Wi-Fi";
    }
  }
  String detail(int i) override { return rows()[i] == 0 && Net::connected() ? Net::ip().substring(Net::ip().lastIndexOf('.')) : String(""); }
  void select(int i) override {
    switch (rows()[i]) {
#if JJ_WIFI
      case 1: OS::push(&wifiScanScreen); break;
#endif
      case 2:
        keyboardScreen.open("Network name", Net::ssid, false, [](const String &ssid) {
          if (ssid.length()) askPasswordFor(ssid);
        });
        break;
      case 3: confirmScreen.ask("Forget Wi-Fi?", "Forget it", [] { Net::forget(); }); break;
      case 4: switchModeAsk(); break;
    }
  }
};
static WifiScreen wifiScreen;

struct AboutScreen : ListScreen {
  String title() override { return "About"; }
  int count() override { return 6; }
  String label(int i) override {
    static const char *names[] = {"Firmware", "Mode", "Songs", "Memory", "Wi-Fi", "Headphones"};
    return names[i];
  }
  String detail(int i) override {
    switch (i) {
      case 0: return FW_VERSION;
      case 1: return JJ_WIFI ? "Wi-Fi" : "Music";
      case 2: return String(Library::count());
      case 3: return String(ESP.getFreeHeap() / 1024) + " KB";
      case 4: return Net::connected() ? Net::ip() : String("off");
      default: return BT::connected() ? String("on") : String("off");
    }
  }
  void select(int) override {}
};
static AboutScreen aboutScreen;

struct SettingsScreen : ListScreen {
  String title() override { return "Settings"; }
  int count() override { return 4; }
  String label(int i) override {
    static const char *names[] = {"Bluetooth", "Wi-Fi", "Mode", "About"};
    return names[i];
  }
  String detail(int i) override { return i == 2 ? (JJ_WIFI ? "Wi-Fi" : "Music") : String(">"); }
  void select(int i) override {
    if (i == 0) OS::push(&bluetoothScreen);
    if (i == 1) OS::push(&wifiScreen);
    if (i == 2) switchModeAsk();
    if (i == 3) OS::push(&aboutScreen);
  }
};
static SettingsScreen settingsScreen;

// ---------- Home ----------
struct HomeScreen : ListScreen {
  bool hasNow() { return JJ_BT && Player::current.id.length(); }
  int first() { return hasNow() ? 0 : 1; }
  String title() override { return JJ_WIFI ? "Wi-Fi mode" : "JJMP3"; }
  int count() override { return 5 - first(); }
  String label(int i) override {
    static const char *names[] = {"Now playing", "Music", "Playlists", "Games", "Settings"};
    return names[i + first()];
  }
  String detail(int i) override { return i + first() == 1 ? String(Library::count()) : String(">"); }
  void select(int i) override {
    switch (i + first()) {
      case 0: OS::openNowPlaying(); break;
      case 1: OS::push(&musicScreen); break;
      case 2: OS::push(&playlistsScreen); break;
      case 3: OS::push(&gamesScreen); break;
      default: OS::push(&settingsScreen); break;
    }
  }
};
static HomeScreen homeScreen;

// ---------- the loop ----------
namespace OS {

static void draw() {
  if (!UI::ok) return;
  UI::oled.clearDisplay();
  UI::oled.setTextSize(1);
  UI::oled.setTextColor(SSD1306_WHITE);
  Screen *s = top();
  if (s->fullscreen()) s->draw();
  else {
    UI::drawBand(s->title());
    s->draw();
  }
  if (millis() < UI::toastUntil) UI::drawToast();
  UI::oled.display();
}

static void begin() {
  depth = 0;
  push(&homeScreen);
  UI::redrawHook = draw;
}

static void handle(const KeyEvent &e) {
  Screen *s = top();
  bool volumeKey = e.key == K_UP || e.key == K_DOWN;
  if (volumeKey && !s->fullscreen() && s != &snakeScreen) {
    Player::setVolume(Player::volume + (e.key == K_UP ? 5 : -5));
    BT::applyVolume();
    UI::toast("Volume " + String(Player::volume) + "%", 700);
    return;
  }
  s->key(e);
}

static void loop() {
  KeyEvent e;
  while (Input::pop(e)) {
    handle(e);
    UI::invalidate();
  }
  Screen *s = top();
  s->tick();
  if (!UI::ok) return;
  uint32_t now = millis();
  bool busy = s->animating() || now < UI::toastUntil || UI::receiving() || (Player::state == PLAYING && s == &nowPlayingScreen);
  uint32_t interval = s->fullscreen() ? 33 : busy ? 120 : 1000;
  if (!UI::dirty && now - UI::lastDraw < interval) return;
  if (s->fullscreen() && !UI::dirty) return;  // games redraw when they change
  UI::lastDraw = now;
  UI::dirty = false;
  draw();
}

}  // namespace OS