#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "config.h"
#include "player.h"

#if JJ_BT
#include <BluetoothA2DPSource.h>

extern Preferences prefs;

// Exposes discovery control that the library keeps protected
class JJA2DP : public BluetoothA2DPSource {
 public:
  void resumeDiscovery() {
    is_end = false;
    esp_bt_gap_start_discovery(ESP_BT_INQ_MODE_GENERAL_INQUIRY, 10, 0);
  }
  bool discovering() { return discovery_active; }
};

// Streams the player's audio to Bluetooth headphones / speakers (A2DP source)
namespace BT {

struct Device {
  char name[33];
  int rssi;
  uint32_t seen;
};

static JJA2DP a2dp;
static bool started = false;
static char target[33] = "";
static Device found[16];
static int foundCount = 0;
static portMUX_TYPE foundLock = portMUX_INITIALIZER_UNLOCKED;

// Remote control buttons on the headphones, handled in loop()
static volatile uint8_t pendingKey = 0;

static bool onDeviceFound(const char *name, esp_bd_addr_t, int rssi) {
  if (!name || !name[0]) return false;
  portENTER_CRITICAL(&foundLock);
  int i = 0;
  while (i < foundCount && strcmp(found[i].name, name) != 0) i++;
  if (i == foundCount && foundCount < 16) {
    strlcpy(found[i].name, name, sizeof(found[i].name));
    foundCount++;
  }
  if (i < foundCount) {
    found[i].rssi = rssi;
    found[i].seen = millis();
  }
  portEXIT_CRITICAL(&foundLock);
  return target[0] && strcmp(name, target) == 0;
}

static int32_t onData(Frame *data, int32_t len) {
  return Player::fillFrames((uint32_t *)data, len);
}

static void onRemoteKey(uint8_t key, bool released) {
  if (released) pendingKey = key;
}

static void applyVolume() {
  if (started) a2dp.set_volume(Player::volume * 127 / 100);
}

static void start() {
  if (started) return;
  a2dp.set_local_name(DEVICE_NAME);
  a2dp.set_reset_ble(true);  // classic BT only: hand the BLE controller memory back to the heap
  a2dp.set_auto_reconnect(true);
  a2dp.set_ssid_callback(onDeviceFound);
  a2dp.set_data_callback_in_frames(onData);
  a2dp.set_avrc_passthru_command_callback(onRemoteKey);
  Serial.printf("# heap before bt %lu\n", (unsigned long)ESP.getFreeHeap());
  a2dp.start();
  started = true;
  Serial.printf("# heap after bt %lu\n", (unsigned long)ESP.getFreeHeap());
  applyVolume();
}

static void begin() {
  prefs.getString("bt_name", target, sizeof(target));
  if (target[0]) start();  // only use the radio once a device has been chosen
}

static void scan() {
  portENTER_CRITICAL(&foundLock);
  foundCount = 0;
  portEXIT_CRITICAL(&foundLock);
  if (!started) start();
  else if (!a2dp.is_connected() && !a2dp.discovering()) a2dp.resumeDiscovery();
}

static void stopScan() {
  if (started && a2dp.discovering()) a2dp.cancel_discovery();
}

// Pairing with a different device needs a clean start of the BT stack
static void connectTo(const char *name) {
  prefs.putString("bt_name", name);
  if (started) a2dp.clean_last_connection();
  delay(100);
  ESP.restart();
}

static void forget() {
  prefs.remove("bt_name");
  if (started) a2dp.clean_last_connection();
  delay(100);
  ESP.restart();
}

static const char *stateName() {
  if (!started) return "off";
  if (a2dp.is_connected()) return "connected";
  if (a2dp.get_connection_state() == ESP_A2D_CONNECTION_STATE_CONNECTING) return "connecting";
  if (a2dp.discovering()) return "scanning";
  return "idle";
}

static bool connected() { return started && a2dp.is_connected(); }

static void loop() {
  uint8_t key = pendingKey;
  if (!key) return;
  pendingKey = 0;
  switch (key) {
    case ESP_AVRC_PT_CMD_PLAY: Player::play(); break;
    case ESP_AVRC_PT_CMD_PAUSE: Player::pause(); break;
    case ESP_AVRC_PT_CMD_FORWARD: Player::next(); break;
    case ESP_AVRC_PT_CMD_BACKWARD: Player::prev(); break;
    default: break;
  }
}

}  // namespace BT

#else

// Bluetooth compiled out (Wi-Fi mode): same interface, no audio output
namespace BT {
struct Device {
  char name[33];
  int rssi;
};
static char target[33] = "";
static Device found[1];
static int foundCount = 0;
static portMUX_TYPE foundLock = portMUX_INITIALIZER_UNLOCKED;
static void begin() { prefs.getString("bt_name", target, sizeof(target)); }
static void applyVolume() {}
static void scan() {}
static void stopScan() {}
static void connectTo(const char *name) { prefs.putString("bt_name", name); }
static void forget() { prefs.remove("bt_name"); }
static const char *stateName() { return "off"; }
static bool connected() { return false; }
static void loop() {}
}  // namespace BT

#endif
