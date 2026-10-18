// OLED test for ESP32 DevKit + 0.96" SSD1306 128x64 I2C display
// Wiring: GND->GND, VCC->3V3, SCL->GPIO22, SDA->GPIO21

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SDA_PIN 21
#define SCL_PIN 22
#define SCREEN_W 128
#define SCREEN_H 64

Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1);

// Returns the first I2C address that responds, or 0 if none
uint8_t scanI2C() {
  uint8_t found = 0;
  Serial.println("Scanning I2C bus...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  Device found at 0x%02X\n", addr);
      if (!found) found = addr;
    }
  }
  if (!found) Serial.println("  No I2C devices found - check wiring");
  return found;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(SDA_PIN, SCL_PIN);

  uint8_t addr = scanI2C();
  if (!addr) addr = 0x3C;

  if (!display.begin(SSD1306_SWITCHCAPVCC, addr)) {
    Serial.println("SSD1306 init failed");
    while (true) delay(100);
  }
  Serial.printf("SSD1306 OK at 0x%02X\n", addr);

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println("JJMP3");
  display.setTextSize(1);
  display.println("Display OK!");
  display.drawRect(0, 0, SCREEN_W, SCREEN_H, SSD1306_WHITE);
  display.display();
}

void loop() {
  // Live uptime counter so you can tell the board is running
  static uint32_t last = 0;
  if (millis() - last >= 1000) {
    last = millis();
    display.fillRect(2, 40, SCREEN_W - 4, 16, SSD1306_BLACK);
    display.setCursor(4, 44);
    display.printf("Uptime: %lus", millis() / 1000);
    display.display();
  }
}
