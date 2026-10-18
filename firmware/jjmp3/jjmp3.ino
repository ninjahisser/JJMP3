// JJMP3 - ESP32 MP3 player
// Plays music from the SD card over Bluetooth (A2DP) with a now-playing
// screen on the OLED. Managed by the JJMP3 desktop app over USB or Wi-Fi.
//
// Wiring (all on the right-hand header of the DevKit):
//   OLED    SDA->D21  SCL->D22  VCC->3V3  GND->GND
//   SD      CS->D5  SCK->D18  MOSI->D23  MISO->D19  VCC->3V3  GND->GND
//   Button  D4 -> GND (internal pull-up)

#include <Preferences.h>
#include <SPI.h>
#include <SD.h>
#include "config.h"
#include "library.h"
#include "player.h"
#include "bt.h"
#include "net.h"
#include "ui.h"
#include "protocol.h"
#include "mode.h"

Preferences prefs;
static bool sdOk = false;

// Click: play/pause - double click: next - hold: previous - triple click: switch mode
static void buttonLoop() {
  static bool down = false, longFired = false;
  static uint32_t downAt = 0, upAt = 0, lastEdge = 0;
  static int clicks = 0;
  uint32_t now = millis();
  bool pressed = digitalRead(PIN_BUTTON) == LOW;

  if (pressed != down && now - lastEdge > 25) {
    lastEdge = now;
    down = pressed;
    if (down) {
      downAt = now;
      longFired = false;
    } else if (!longFired) {
      clicks++;
      upAt = now;
    }
  }
  if (down && !longFired && now - downAt > 650) {
    longFired = true;
    clicks = 0;
    Player::prev();
    UI::toast("Previous", 700);
  }
  if (!down && clicks && now - upAt > 320) {
    if (clicks >= 3) {
      const char *err = Mode::prepareSwitch();
      UI::toast(err ? err : (JJ_WIFI ? "Music mode..." : "Wi-Fi mode..."), 1500);
      UI::loop();
      if (!err) Mode::restart();
    } else if (clicks == 1) Player::toggle();
    else {
      Player::next();
      UI::toast("Next", 700);
    }
    clicks = 0;
    UI::invalidate();
  }
}

void setup() {
  Serial.setRxBufferSize(XFER_CHUNK * 2 + 512);
  Serial.begin(SERIAL_BAUD);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  prefs.begin("jjmp3", false);

  Serial.printf("# heap boot %lu\n", (unsigned long)ESP.getFreeHeap());
  UI::begin();

  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  sdOk = SD.begin(PIN_SD_CS, SPI, SD_SPI_HZ);
  if (sdOk) {
    SD.mkdir(MUSIC_DIR);
    SD.mkdir(ART_DIR);
    Library::reload();
  }

  Serial.printf("# heap after sd %lu\n", (unsigned long)ESP.getFreeHeap());
  BT::begin();
  Player::begin();
  Serial.printf("# heap after player %lu\n", (unsigned long)ESP.getFreeHeap());
  Net::begin();
  Protocol::httpRoutes();

  Serial.printf("# JJMP3 %s ready, sd=%d tracks=%lu heap=%lu\n", FW_VERSION, sdOk,
                (unsigned long)Library::count(), (unsigned long)ESP.getFreeHeap());
  if (!sdOk) UI::toast("No SD card", 4000);
}

void loop() {
  Protocol::serialLoop();
  Player::loop();
  BT::loop();
  if (Net::loop()) UI::toast(Net::ip(), 2500);
  buttonLoop();
  UI::loop();
}
