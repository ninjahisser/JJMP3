#pragma once
#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include "config.h"

// Mounting the SD card, with a report of what happened so a failing card or reader can be diagnosed
// without a serial cable (the app can ask for it over Wi-Fi).
//
// Two sets of pins are tried: the alternative set first (D16 D17 D15 D35, all free pins on the right
// header), then the original VSPI pins. Whichever the reader is wired to works.
namespace Sd {

struct Pins {
  int sck, miso, mosi, cs;
  const char *name;
};
static const Pins SETS[] = {
    {PIN_SD2_SCK, PIN_SD2_MISO, PIN_SD2_MOSI, PIN_SD2_CS, "alt"},
    {PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS, "std"},
};

static bool ok = false;
static String report;
static int csPin = PIN_SD_CS;  // of the set that mounted

static const char *typeName(uint8_t t) {
  switch (t) {
    case CARD_MMC: return "MMC";
    case CARD_SD: return "SD";
    case CARD_SDHC: return "SDHC";
    default: return "none";
  }
}

// Raw look at the card, without any library: clock out CMD0 and read what comes back on MISO.
// A card that is there and wired right answers 01. FF means silence, 00 means the line is held low.
static uint8_t bangByte(int sck, int miso, int mosi, uint8_t out) {
  uint8_t in = 0;
  for (int b = 7; b >= 0; b--) {
    digitalWrite(mosi, (out >> b) & 1);
    delayMicroseconds(4);
    digitalWrite(sck, HIGH);
    delayMicroseconds(4);
    in = (in << 1) | digitalRead(miso);
    digitalWrite(sck, LOW);
  }
  return in;
}

static String rawCmd0(const Pins &p, int miso, int mosi) {
  SPI.end();
  pinMode(p.sck, OUTPUT);
  pinMode(p.cs, OUTPUT);
  pinMode(mosi, OUTPUT);
  pinMode(miso, INPUT);
  digitalWrite(p.sck, LOW);
  digitalWrite(p.cs, HIGH);
  for (int i = 0; i < 12; i++) bangByte(p.sck, miso, mosi, 0xFF);  // 96 clocks to wake the card
  digitalWrite(p.cs, LOW);
  static const uint8_t cmd0[6] = {0x40, 0, 0, 0, 0, 0x95};
  for (uint8_t c : cmd0) bangByte(p.sck, miso, mosi, c);
  String hex;
  for (int i = 0; i < 10; i++) {
    char h[4];
    snprintf(h, sizeof h, "%02X ", bangByte(p.sck, miso, mosi, 0xFF));
    hex += h;
  }
  digitalWrite(p.cs, HIGH);
  return hex;
}

static bool mountOn(const Pins &p) {
  SD.end();
  SPI.end();
  SPI.begin(p.sck, p.miso, p.mosi, p.cs);
  // Wires on a breadboard often can't carry a fast SPI clock: try fast first, then slower and slower
  static const uint32_t SPEEDS[] = {SD_SPI_HZ, 4000000, 1000000, 400000};
  for (uint32_t hz : SPEEDS) {
    if (SD.begin(p.cs, SPI, hz)) {
      report += String(p.name) + " " + String(hz / 1000) + "kHz:ok type=" + typeName(SD.cardType()) + " size=" + String((uint32_t)(SD.cardSize() / (1024 * 1024))) + "MB";
      csPin = p.cs;
      return true;
    }
    SD.end();
    delay(50);
  }
  // idle level of MISO tells wiring from card: floating pulls differently than a card holding it
  pinMode(p.miso, INPUT_PULLUP);
  int up = digitalRead(p.miso);
  pinMode(p.miso, INPUT_PULLDOWN);
  int down = digitalRead(p.miso);
  report += String(p.name) + ": no answer; miso " + (up == down ? (up ? "stuck high" : "stuck low") : "floating") + "; cmd0 " + rawCmd0(p, p.miso, p.mosi) + "| ";
  return false;
}

static bool mount() {
  report = "";
  ok = false;
  for (const Pins &p : SETS)
    if ((ok = mountOn(p))) break;
  if (!ok) SPI.begin(SETS[0].sck, SETS[0].miso, SETS[0].mosi, SETS[0].cs);
  Serial.printf("# sd: %s\n", report.c_str());
  return ok;
}

}  // namespace Sd
