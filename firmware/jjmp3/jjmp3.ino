// Z0Ɛ - ESP32 MP3 player with a small iPod-style OS.
// Plays music from the SD card over Bluetooth (A2DP); menus, playlists, games and settings
// on the two-colour OLED, driven by five buttons (< P > and - +). Managed by the JJMP3
// desktop app over USB or Wi-Fi.
//
// Wiring (right-hand header of the DevKit, plus the buttons):
//   OLED    SDA->D21 (or RX2/D16)  SCL->D22  VCC->3V3  GND->GND
//   SD      CS->D5  SCK->D18  MOSI->D23  MISO->D19  VCC->5V (VIN)  GND->GND
//   Buttons to GND: P->D4  <->D32  >->D13  +->D14  -->D33 (internal pull-ups)
//   Battery  LiPo+ -> 100k -> D34 -> 100k -> GND

#include <Preferences.h>
#include <SPI.h>
#include <SD.h>
#include <exception>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "speaker.h"
#include "net.h"
#include "ui.h"
#include "input.h"
#include "profile.h"
#include "os.h"
#include "protocol.h"

SET_LOOP_TASK_STACK_SIZE(5 * 1024);  // default 8 KB, taken from the heap the Bluetooth stack needs

Preferences prefs;

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

  Sd::mount();
  if (Sd::ok) {
    SD.mkdir(MUSIC_DIR);
    SD.mkdir(ART_DIR);
    SD.mkdir(GAMES_DIR);
    Library::reload();
  }

  BT::begin();
  Player::begin();
  Speaker::begin();
  Net::begin();
  Protocol::httpRoutes();
  OS::begin();

  Serial.printf("# Z0Ɛ %s ready, sd=%d tracks=%lu heap=%lu\n", FW_VERSION, Sd::ok,
                (unsigned long)Library::count(), (unsigned long)ESP.getFreeHeap());
  if (!Sd::ok) UI::toast("No SD card", 4000);
}

void loop() {
  Protocol::serialLoop();
  Player::loop();
  BT::loop();
  if (Net::loop()) UI::toast(Net::ip(), 2500);
  Input::loop();
  OS::loop();
}