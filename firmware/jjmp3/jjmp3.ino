// Z0Ɛ - ESP32 MP3 player with a small iPod-style OS.
// Plays music from the SD card over Bluetooth (A2DP); menus, playlists, games and settings
// on the two-colour OLED, driven by five buttons (< P > and - +). Managed by the JJMP3
// desktop app over USB or Wi-Fi.
//
// Wiring (right-hand header of the DevKit, plus the buttons):
//   OLED    SDA->D21  SCL->D22  VCC->3V3  GND->GND
//   SD      CS->D5  SCK->D18  MOSI->D23  MISO->D19  VCC->3V3  GND->GND
//   Buttons to GND: P->D4  <->D32  >->D33  +->D13  -->D14 (internal pull-ups)
//   Battery  LiPo+ -> 100k -> D34 -> 100k -> GND

#include <Preferences.h>
#include <SPI.h>
#include <SD.h>
#include <exception>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "net.h"
#include "ui.h"
#include "input.h"
#include "profile.h"
#include "os.h"
#include "protocol.h"

SET_LOOP_TASK_STACK_SIZE(5 * 1024);  // default 8 KB, taken from the heap the Bluetooth stack needs

Preferences prefs;
static bool sdOk = false;

// A failed std::vector/String allocation throws std::bad_alloc; the default
// handler calls abort() and the device boot-loops. That must never happen:
// restart cleanly instead so a transient low-memory moment recovers by itself.
static void onTerminate() {
  Serial.printf("# terminate: low memory (free=%lu), rebooting\n", (unsigned long)ESP.getFreeHeap());
  Serial.flush();
  delay(50);
  ESP.restart();
}

void setup() {
  std::set_terminate(onTerminate);
  // Generous RX ring: at 921600 baud a slow loop() pass (SD scan, flash write, OLED)
  // would otherwise drop bytes mid-command and the app would see no reply.
  Serial.setRxBufferSize(XFER_CHUNK * 2 + 256);
  Serial.begin(SERIAL_BAUD);
  Input::begin();
  Battery::begin();
  prefs.begin("jjmp3", false);
  Profile::begin();

  UI::begin();

  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  // Wires on a breadboard often can't carry a fast SPI clock: try fast first, then slower and slower
  static const uint32_t SD_SPEEDS[] = {SD_SPI_HZ, 4000000, 1000000, 400000};
  for (uint32_t hz : SD_SPEEDS) {
    sdOk = SD.begin(PIN_SD_CS, SPI, hz);
    Serial.printf("# sd at %lu Hz: %s\n", (unsigned long)hz, sdOk ? "ok" : "no card");
    if (sdOk) break;
    SD.end();
    delay(50);
  }
  if (!sdOk) {
    // idle level of MISO tells wiring from card: floating pulls differently than a card holding it
    pinMode(PIN_SD_MISO, INPUT_PULLUP);
    int up = digitalRead(PIN_SD_MISO);
    pinMode(PIN_SD_MISO, INPUT_PULLDOWN);
    int down = digitalRead(PIN_SD_MISO);
    Serial.printf("# sd miso probe: pullup=%d pulldown=%d (%s)\n", up, down, up == down ? "driven by the card/module" : "floating: MISO not connected");
    SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  }
  if (sdOk) {
    SD.mkdir(MUSIC_DIR);
    SD.mkdir(ART_DIR);
    SD.mkdir(GAMES_DIR);
    Library::reload();
  }

  BT::begin();
  Player::begin();
  Net::begin();
  Protocol::httpRoutes();
  OS::begin();

  Serial.printf("# Z0Ɛ %s ready, sd=%d tracks=%lu heap=%lu\n", FW_VERSION, sdOk,
                (unsigned long)Library::count(), (unsigned long)ESP.getFreeHeap());
  if (!sdOk) UI::toast("No SD card", 4000);
}

void loop() {
  Protocol::serialLoop();
  Player::loop();
  BT::loop();
  if (Net::loop()) UI::toast(Net::ip(), 2500);
  Input::loop();
  OS::loop();
}