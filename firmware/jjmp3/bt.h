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
  uint8_t *peer() { return peer_bd_addr; }
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

// What the link has been doing, newest last (shown in the app when something's wrong)
static char events[6][28];
static int eventCount = 0;
static portMUX_TYPE eventLock = portMUX_INITIALIZER_UNLOCKED;
static volatile bool audioStarted = false;
static volatile int refused = 0;  // connection attempts in a row that the headphones turned down

static void note(const char *what) {
  char line[28];
  snprintf(line, sizeof(line), "%lus %s", (unsigned long)(millis() / 1000), what);
  portENTER_CRITICAL(&eventLock);
  if (eventCount == 6) {
    memmove(events[0], events[1], sizeof(events[0]) * 5);
    eventCount = 5;
  }
  strlcpy(events[eventCount++], line, sizeof(events[0]));
  portEXIT_CRITICAL(&eventLock);
}

static void onConnection(esp_a2d_connection_state_t st, void *) {
  static const char *names[] = {"disconnected", "connecting", "connected", "disconnecting"};
  if (st != ESP_A2D_CONNECTION_STATE_CONNECTED) audioStarted = false;
  if (st == ESP_A2D_CONNECTION_STATE_CONNECTED) refused = 0;
  if (st == ESP_A2D_CONNECTION_STATE_DISCONNECTED) refused++;
  note(st <= 3 ? names[st] : "link ?");
}

static volatile bool tuneLink = false;  // set when audio starts; loop() then asks for a faster link

static void onAudio(esp_a2d_audio_state_t st, void *) {
  audioStarted = st == ESP_A2D_AUDIO_STATE_STARTED;
  if (audioStarted) tuneLink = true;
  note(audioStarted ? "audio started" : "audio stopped");
}

// Some headphones keep the link in a power-saving rhythm (seen: a turn every 45 slots = 28.1 ms)
// that carries only ~58% of the audio, heard as play/freeze stutter. Ask for frequent polling and
// allow every ACL packet type, including the fast EDR ones, so the stream fits.
static void applyLinkTuning() {
  esp_err_t q = esp_bt_gap_set_qos(a2dp.peer(), 8);  // poll at least every 8 slots (5 ms)
  esp_err_t p = esp_bt_gap_set_acl_pkt_types(a2dp.peer(), ESP_BT_ACL_PKT_TYPES_MASK_DM1 | ESP_BT_ACL_PKT_TYPES_MASK_DH1 |
                                                              ESP_BT_ACL_PKT_TYPES_MASK_DM3 | ESP_BT_ACL_PKT_TYPES_MASK_DH3 |
                                                              ESP_BT_ACL_PKT_TYPES_MASK_DM5 | ESP_BT_ACL_PKT_TYPES_MASK_DH5);
  char line[28];
  snprintf(line, sizeof(line), "link qos %s pkt %s", q == ESP_OK ? "ok" : "err", p == ESP_OK ? "ok" : "err");
  note(line);
}

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

// Some headphones give the link only ~190 kbit/s at times, while SBC at the usual bitpool 53
// needs ~330: then the music plays at ~58% speed, stuttering. A lower maximum bitpool makes
// every SBC frame smaller (13 + 2 x bitpool bytes) so the audio fits; 0 = no limit.
static uint8_t maxBitpool = 0;

static void limitBitpool() {
  maxBitpool = prefs.getUChar("bt_bp", 0);
  if (!maxBitpool) return;
  esp_a2d_mcc_t mcc = {};
  mcc.type = ESP_A2D_MCT_SBC;
  mcc.cie.sbc_info.samp_freq = ESP_A2D_SBC_CIE_SF_44K;
  mcc.cie.sbc_info.ch_mode = ESP_A2D_SBC_CIE_CH_MODE_JOINT_STEREO | ESP_A2D_SBC_CIE_CH_MODE_STEREO |
                             ESP_A2D_SBC_CIE_CH_MODE_DUAL_CHANNEL | ESP_A2D_SBC_CIE_CH_MODE_MONO;
  mcc.cie.sbc_info.block_len = ESP_A2D_SBC_CIE_BLOCK_LEN_16;
  mcc.cie.sbc_info.num_subbands = ESP_A2D_SBC_CIE_NUM_SUBBANDS_8;
  mcc.cie.sbc_info.alloc_mthd = ESP_A2D_SBC_CIE_ALLOC_MTHD_LOUDNESS;
  mcc.cie.sbc_info.min_bitpool = 2;
  mcc.cie.sbc_info.max_bitpool = maxBitpool;
  esp_err_t e = esp_a2d_source_register_stream_endpoint(0, &mcc);
  char line[28];
  snprintf(line, sizeof(line), "bitpool %u: %s", maxBitpool, e == ESP_OK ? "ok" : esp_err_to_name(e));
  note(line);
}

static void start() {
  if (started) return;
  a2dp.set_local_name(DEVICE_NAME);
  // Modern earbuds only pair with Secure Simple Pairing; without it the
  // library falls back to PIN "1234", pairing fails and the link stays idle.
  a2dp.set_ssp_enabled(true);
  a2dp.set_on_connection_state_changed(onConnection);
  a2dp.set_on_audio_state_changed(onAudio);
  note(target[0] ? "looking for headphones" : "scanning");
  a2dp.set_reset_ble(true);  // classic BT only: hand the BLE controller memory back to the heap
  a2dp.set_auto_reconnect(true);
  a2dp.set_ssid_callback(onDeviceFound);
  a2dp.set_data_callback_in_frames(onData);
  a2dp.set_avrc_passthru_command_callback(onRemoteKey);
  Serial.printf("# heap before bt %lu\n", (unsigned long)ESP.getFreeHeap());
  a2dp.start();
  started = true;
  limitBitpool();
  // Classic Bluetooth defaults to a low transmit power; a weak link makes the stack slow its audio below real time
  esp_bredr_tx_power_set(ESP_PWR_LVL_P9, ESP_PWR_LVL_P9);
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

// Old pairing keys (say from before Secure Simple Pairing) make headphones refuse us; start clean
static void removeBonds() {
  if (!started) return;
  int n = esp_bt_gap_get_bond_device_num();
  if (n <= 0) return;
  esp_bd_addr_t *list = (esp_bd_addr_t *)malloc(sizeof(esp_bd_addr_t) * n);
  if (!list) return;
  esp_bt_gap_get_bond_device_list(&n, list);
  for (int i = 0; i < n; i++) esp_bt_gap_remove_bond_device(list[i]);
  free(list);
}

// Pairing with a different device needs a clean start of the BT stack
static void connectTo(const char *name) {
  prefs.putString("bt_name", name);
  if (started) {
    a2dp.clean_last_connection();
    removeBonds();
  }
  delay(300);
  ESP.restart();
}

static void forget() {
  prefs.remove("bt_name");
  if (started) {
    a2dp.clean_last_connection();
    removeBonds();
  }
  delay(300);
  ESP.restart();
}

static const char *stateName() {
  if (!started) return "off";
  if (a2dp.is_connected()) return audioStarted ? "connected" : "connected, no audio";
  if (refused >= 3) return "refused";  // they keep turning us down: needs a fresh pairing
  if (a2dp.get_connection_state() == ESP_A2D_CONNECTION_STATE_CONNECTING) return "connecting";
  if (a2dp.discovering()) return "scanning";
  return "idle";
}

static bool connected() { return started && a2dp.is_connected(); }

// A one-line, human explanation of what the link is doing right now, for the
// on-device Bluetooth screen (the app shows the raw event log instead).
static const char *hint() {
  if (!target[0]) return "No headphones set yet";
  if (a2dp.is_connected()) return audioStarted ? "Playing through headphones" : "Linked, waiting for audio";
  if (refused >= 3) return "They keep refusing";
  if (a2dp.get_connection_state() == ESP_A2D_CONNECTION_STATE_CONNECTING) return "Connecting now";
  if (a2dp.discovering()) return "Searching nearby";
  return "Looking for headphones";
}

// The newest event line ("12s connecting"), for the on-device screen.
static const char *lastEvent() {
  static char out[28] = "";
  portENTER_CRITICAL(&eventLock);
  if (eventCount) strlcpy(out, events[eventCount - 1], sizeof(out));
  portEXIT_CRITICAL(&eventLock);
  return out;
}

static void loop() {
  if (tuneLink) {
    tuneLink = false;
    applyLinkTuning();
  }
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
static const char *hint() { return "Off in Wi-Fi mode"; }
static const char *lastEvent() { return ""; }
static void loop() {}
}  // namespace BT

#endif
