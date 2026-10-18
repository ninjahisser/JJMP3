// SD card test for ESP32 DevKit + HW-125 SD module + SSD1306 OLED
// OLED: GND->GND, VCC->3V3, SCL->GPIO22, SDA->GPIO21
// SD:   GND->GND, VCC->VIN (5V), MISO->GPIO19, MOSI->GPIO23, SCK->GPIO18, CS->GPIO5
// Card must be FAT32 formatted

#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SDA_PIN 21
#define SCL_PIN 22
#define SD_SCK  18
#define SD_MISO 19
#define SD_MOSI 23
#define SD_CS   5

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void showStatus(const char *line1, const String &line2 = "", const String &line3 = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("SD card test");
  display.setTextSize(2);
  display.setCursor(0, 14);
  display.println(line1);
  display.setTextSize(1);
  display.setCursor(0, 36);
  display.println(line2);
  display.println(line3);
  display.display();
}

const char *cardTypeName(uint8_t type) {
  switch (type) {
    case CARD_MMC:  return "MMC";
    case CARD_SD:   return "SDSC";
    case CARD_SDHC: return "SDHC";
    default:        return "unknown";
  }
}

void listRoot() {
  File root = SD.open("/");
  Serial.println("Files in /:");
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    Serial.printf("  %s%s  %llu bytes\n", f.name(), f.isDirectory() ? "/" : "", (uint64_t)f.size());
    f.close();
  }
  root.close();
}

// Writes a file, reads it back, returns true if contents match
bool writeReadTest() {
  const char *path = "/jjmp3_test.txt";
  const char *msg = "Hello from JJMP3!";

  File f = SD.open(path, FILE_WRITE);
  if (!f) return false;
  f.print(msg);
  f.close();

  f = SD.open(path, FILE_READ);
  if (!f) return false;
  String back = f.readString();
  f.close();
  Serial.printf("Read back: \"%s\"\n", back.c_str());
  return back == msg;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(SDA_PIN, SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 init failed");
  }
  display.setTextColor(SSD1306_WHITE);
  showStatus("Mounting");

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, SPI, 4000000)) {
    Serial.println("SD mount failed - check wiring, card inserted, FAT32 format");
    showStatus("NO CARD", "Check wiring/format", "Press EN to retry");
    return;
  }

  uint8_t type = SD.cardType();
  uint64_t sizeMB = SD.cardSize() / (1024 * 1024);
  uint64_t usedMB = SD.usedBytes() / (1024 * 1024);
  Serial.printf("SD mounted: %s, %llu MB, %llu MB used\n", cardTypeName(type), sizeMB, usedMB);
  listRoot();

  bool ok = writeReadTest();
  Serial.println(ok ? "Write/read test PASSED" : "Write/read test FAILED");

  showStatus(ok ? "SD OK" : "RW FAIL",
             String(cardTypeName(type)) + " " + String((uint32_t)(sizeMB / 1024)) + " GB",
             ok ? "Write/read passed" : "Write/read failed");
}

void loop() {}
