// JJMP3 - ESP32 MP3 player with a small iPod-style OS.
// Plays music from the SD card over Bluetooth (A2DP); menus, playlists, games and settings
// on the two-colour OLED, driven by five buttons (< P > and - +). Managed by the JJMP3
// desktop app over USB or Wi-Fi.
//
// Wiring (right-hand header of the DevKit, plus the buttons):
//   OLED    SDA->D21  SCL->D22  VCC->3V3  GND->GND
//   SD      CS->D5  SCK->D18  MOSI->D23  MISO->D19  VCC->3V3  GND->GND
//   Buttons to GND: P->D4  <->D32  >->D33  +->D13  -->D14 (internal pull-ups)

#include <Preferences.h>
#include <SPI.h>
#include <SD.h>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "net.h"
#include "ui.h"
#include "input.h"
#include "os.h"
#include "protocol.h"

Preferences prefs;
static bool sdOk = false;

void setup() {
  Serial.setRxBufferSize(XFER_CHUNK * 2 + 512);
  Serial.begin(SERIAL_BAUD);
  Input::begin();
  prefs.begin("jjmp3", false);

  UI::begin();

  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  sdOk = SD.begin(PIN_SD_CS, SPI, SD_SPI_HZ);
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

  Serial.printf("# JJMP3 %s ready, sd=%d tracks=%lu heap=%lu\n", FW_VERSION, sdOk,
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