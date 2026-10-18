// Button test for ESP32 DevKit + SSD1306 OLED
// OLED:   GND->GND, VCC->3V3, SCL->GPIO22, SDA->GPIO21
// Button: one leg -> GPIO4, diagonally opposite leg -> GND
//         (uses the internal pull-up, so no resistor needed)

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SDA_PIN 21
#define SCL_PIN 22
#define BUTTON_PIN 4
#define DEBOUNCE_MS 30

Adafruit_SSD1306 display(128, 64, &Wire, -1);

bool pressed = false;        // debounced state
bool lastReading = false;
uint32_t lastChange = 0;
uint32_t pressCount = 0;

void drawScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Button test (GPIO4)");

  display.setTextSize(2);
  display.setCursor(0, 16);
  display.println(pressed ? "PRESSED" : "released");

  display.setTextSize(1);
  display.setCursor(0, 44);
  display.printf("Presses: %lu", pressCount);

  if (pressed) display.fillCircle(116, 52, 8, SSD1306_WHITE);
  else display.drawCircle(116, 52, 8, SSD1306_WHITE);
  display.display();
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Wire.begin(SDA_PIN, SCL_PIN);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 init failed");
    while (true) delay(100);
  }
  display.setTextColor(SSD1306_WHITE);
  Serial.printf("Button test ready, GPIO%d reads %s\n", BUTTON_PIN,
                digitalRead(BUTTON_PIN) ? "HIGH (released)" : "LOW (pressed?)");
  drawScreen();
}

void loop() {
  // Pull-up means the pin reads LOW while the button is held
  bool reading = digitalRead(BUTTON_PIN) == LOW;
  if (reading != lastReading) {
    lastChange = millis();
    lastReading = reading;
  }
  if (millis() - lastChange >= DEBOUNCE_MS && reading != pressed) {
    pressed = reading;
    if (pressed) pressCount++;
    Serial.printf("%s (presses: %lu)\n", pressed ? "Pressed" : "Released", pressCount);
    drawScreen();
  }
}
