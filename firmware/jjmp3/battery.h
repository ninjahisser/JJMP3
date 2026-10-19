#pragma once
#include <Arduino.h>
#include <esp_sleep.h>
#include "config.h"

// LiPo level from a 2:1 divider (two 100k resistors) on an ADC1 pin.
// No battery wired: the reading is missing or jumpy, and the indicator stays hidden.
namespace Battery {

static float volts = 0;       // smoothed battery voltage
static int percent = -1;      // 0..100, or -1 when there's no battery
static bool present = false;
static uint32_t lastRead = 0, emptySince = 0;
static bool warned = false;

// Typical single-cell LiPo resting voltage vs. charge left
static const float CURVE_V[] = {3.27, 3.61, 3.69, 3.71, 3.73, 3.75, 3.77, 3.79, 3.80, 3.82, 3.84, 3.85, 3.87, 3.91, 3.95, 3.98, 4.02, 4.08, 4.11, 4.15, 4.20};
static const int CURVE_N = sizeof(CURVE_V) / sizeof(CURVE_V[0]);  // 0, 5, 10 ... 100 %

static int toPercent(float v) {
  if (v <= CURVE_V[0]) return 0;
  if (v >= CURVE_V[CURVE_N - 1]) return 100;
  for (int i = 1; i < CURVE_N; i++)
    if (v < CURVE_V[i]) return round((i - 1 + (v - CURVE_V[i - 1]) / (CURVE_V[i] - CURVE_V[i - 1])) * 5);
  return 100;
}

static float sample() {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(PIN_BATTERY);
  return mv / 16.0f / 1000.0f * BATTERY_DIVIDER;
}

static void begin() {
  analogSetPinAttenuation(PIN_BATTERY, ADC_11db);  // full 0-3.1 V input range
  volts = sample();
}

/** Returns true the moment the battery is empty (the caller saves state, then we sleep). */
static bool loop() {
  uint32_t now = millis();
  if (now - lastRead < 2000) return false;
  lastRead = now;
  float v = sample();
  // A real cell reads 3.0-4.3 V and moves slowly; a floating pin reads low or jumps around.
  bool plausible = v > 2.9f && v < 4.4f && (volts == 0 || fabsf(v - volts) < 0.25f);
  volts = volts == 0 || !plausible ? v : volts * 0.8f + v * 0.2f;
  present = plausible && volts > 2.9f;
  percent = present ? toPercent(volts) : -1;
  if (!present) {
    emptySince = 0;
    return false;
  }
  if (percent <= 5 && !warned) {
    warned = true;
    return false;  // the OS shows "Battery low" (see os.h)
  }
  if (percent > 10) warned = false;
  if (volts < 3.30f) {
    if (!emptySince) emptySince = now;
    return now - emptySince > 20000;  // empty for 20 s: time to sleep
  }
  emptySince = 0;
  return false;
}

/** Sleep until P is pressed, so a flat cell isn't drained into brown-out resets. */
static void sleepUntilPressed() {
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_BTN_PLAY, 0);
  esp_deep_sleep_start();
}

}  // namespace Battery