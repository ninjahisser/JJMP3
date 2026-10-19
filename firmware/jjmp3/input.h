#pragma once
#include <Arduino.h>
#include "config.h"

// Five buttons: < P > and volume - +. Physical buttons and the desktop app's remote
// buttons produce the same events.
enum Key : uint8_t { K_LEFT, K_PLAY, K_RIGHT, K_UP, K_DOWN, K_COUNT };
enum Act : uint8_t { A_PRESS, A_HOLD, A_REPEAT };
struct KeyEvent {
  Key key;
  Act act;
};

namespace Input {

static const int PINS[K_COUNT] = {PIN_BTN_LEFT, PIN_BTN_PLAY, PIN_BTN_RIGHT, PIN_BTN_VOLUP, PIN_BTN_VOLDN};
static const uint32_t DEBOUNCE = 25, HOLD_MS = 600, REPEAT_START = 450, REPEAT_EVERY = 110;

static KeyEvent queue[16];
static uint8_t qHead = 0, qTail = 0;
static bool down[K_COUNT];
static uint32_t downAt[K_COUNT], lastEdge[K_COUNT], lastRepeat[K_COUNT];
static bool holdFired[K_COUNT];
static uint32_t remoteUntil[K_COUNT];  // remote presses look held for a moment (games read key state)

static void push(Key k, Act a) {
  uint8_t next = (qHead + 1) % 16;
  if (next == qTail) return;  // full: drop
  queue[qHead] = {k, a};
  qHead = next;
}

static bool pop(KeyEvent &e) {
  if (qTail == qHead) return false;
  e = queue[qTail];
  qTail = (qTail + 1) % 16;
  return true;
}

/** Is the key held right now (physical, or a recent remote press)? */
static bool isDown(Key k) { return down[k] || millis() < remoteUntil[k]; }

static void begin() {
  for (int k = 0; k < K_COUNT; k++) pinMode(PINS[k], INPUT_PULLUP);
}

/** From the desktop app: a press, or a hold (P held = back). */
static void inject(Key k, bool hold) {
  remoteUntil[k] = millis() + 160;
  push(k, hold ? A_HOLD : A_PRESS);
}

static void loop() {
  uint32_t now = millis();
  for (int i = 0; i < K_COUNT; i++) {
    Key k = (Key)i;
    bool pressed = digitalRead(PINS[i]) == LOW;
    if (pressed != down[i] && now - lastEdge[i] > DEBOUNCE) {
      lastEdge[i] = now;
      down[i] = pressed;
      if (pressed) {
        downAt[i] = now;
        holdFired[i] = false;
        lastRepeat[i] = now;
        if (k != K_PLAY) push(k, A_PRESS);  // arrows and volume act on press
      } else if (k == K_PLAY && !holdFired[i]) {
        push(k, A_PRESS);  // P acts on release, so a hold can mean "back"
      }
    }
    if (!down[i]) continue;
    if (k == K_PLAY) {
      if (!holdFired[i] && now - downAt[i] > HOLD_MS) {
        holdFired[i] = true;
        push(k, A_HOLD);
      }
    } else if (now - downAt[i] > REPEAT_START && now - lastRepeat[i] > REPEAT_EVERY) {
      lastRepeat[i] = now;
      push(k, A_REPEAT);
    }
  }
}

}  // namespace Input