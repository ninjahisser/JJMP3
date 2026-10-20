#pragma once
#include <Arduino.h>
#include <SD.h>
#include "screen.h"
#include "player.h"
#include "library.h"
#include "profile.h"

// Washington Zen: a focus timer with your music and a pibble.
// Focus: music plays, the pibble sleeps and talks in his sleep. Break: he wakes up.
// Before starting: < > set the focus length, P starts. During a session: P pauses,
// < > change song, hold P ends the session (hold again to leave).
struct ZenScreen : Screen {
  enum Phase { SETUP, FOCUS, BREAK };
  Phase phase = SETUP;
  bool paused = false;
  int focusMin = 25, breakMin = 5;
  uint32_t endsAt = 0, leftWhenPaused = 0;
  String bubble;
  uint32_t bubbleUntil = 0, nextTalk = 0;
  int sessions = 0;
  bool hasPhoto = false;
  uint8_t photo[288];  // optional 48x48 picture from the app (/zen.bin)

  static constexpr const char *SLEEP_TALK[] = {"wash MY bellay", "I love you %s", "%s is zo beatifull", "There is nothing better then a date with %s"};
  static constexpr const char *AWAKE_TALK[] = {"good job %s!", "stretch time", "drink some water", "pibble is proud of %s", "belly rub break?"};
  static constexpr const char *READY_TALK[] = {"ready when you are", "lets focus %s", "i will nap with you"};

  String say(const char *line) {
    String s = line;
    s.replace("%s", Profile::who());
    return s;
  }

  void enter() override {
    File f = SD.open("/zen.bin", FILE_READ);
    hasPhoto = f && f.read(photo, sizeof(photo)) == sizeof(photo);
    if (f) f.close();
    nextTalk = millis() + 1500;
  }

  uint32_t left() {
    if (phase == SETUP) return focusMin * 60;
    if (paused) return leftWhenPaused / 1000;
    return endsAt > millis() ? (endsAt - millis()) / 1000 : 0;
  }

  String title() override {
    String t = UI::fmtTime(left());
    if (phase == SETUP) return "Zen " + String(focusMin) + " min";
    return String(paused ? "Paused " : phase == FOCUS ? "Focus " : "Break ") + t;
  }
  bool animating() override { return true; }

  void startPhase(Phase p) {
    phase = p;
    paused = false;
    endsAt = millis() + (p == FOCUS ? focusMin : breakMin) * 60000UL;
    bubble = "";
    nextTalk = millis() + (p == FOCUS ? 8000 : 1200);
    if (p == FOCUS && JJ_BT) {
      if (Player::queue.empty()) {
        std::vector<String> ids;
        Library::allIds(ids);
        if (!ids.empty()) Player::setQueue(ids, random(ids.size()));
      } else {
        Player::play();
      }
    }
    if (p == BREAK) {
      sessions++;
      UI::toast("Break time", 1500);
    }
  }

  void key(const KeyEvent &e) override {
    if (e.key == K_PLAY && e.act == A_HOLD) {
      if (phase == SETUP) return OS::back();
      phase = SETUP;  // end the session, stay in Zen
      paused = false;
      Player::pause();
      return;
    }
    if (phase == SETUP) {
      if ((e.key == K_LEFT || e.key == K_RIGHT) && e.act != A_HOLD) focusMin = constrain(focusMin + (e.key == K_RIGHT ? 5 : -5), 5, 90);
      if (e.key == K_PLAY && e.act == A_PRESS) startPhase(FOCUS);
      return;
    }
    if (e.key == K_PLAY && e.act == A_PRESS) {
      if (paused) {
        endsAt = millis() + leftWhenPaused;
        paused = false;
        if (phase == FOCUS) Player::play();
      } else {
        leftWhenPaused = endsAt > millis() ? endsAt - millis() : 0;
        paused = true;
        Player::pause();
      }
    }
    if (e.key == K_LEFT && e.act == A_PRESS) Player::prev();
    if (e.key == K_RIGHT && e.act == A_PRESS) Player::next();
  }

  void tick() override {
    uint32_t now = millis();
    if (phase != SETUP && !paused && now >= endsAt) startPhase(phase == FOCUS ? BREAK : FOCUS);
    if (now >= nextTalk) {
      bool asleep = phase == FOCUS && !paused;
      if (asleep) bubble = say(SLEEP_TALK[random(4)]);
      else if (phase == BREAK) bubble = say(AWAKE_TALK[random(5)]);
      else bubble = say(READY_TALK[random(3)]);
      bubbleUntil = now + 5500;
      nextTalk = now + (asleep ? random(15000, 40000) : random(9000, 20000));
      UI::invalidate();
    }
  }

  // the Washington pibble: a big white pit bull face, eyes open or snoozing
  void drawPibble(int cx, int cy, bool asleep) {
    auto &o = UI::oled;
    o.fillTriangle(cx - 15, cy - 9, cx - 8, cy - 15, cx - 5, cy - 8, SSD1306_WHITE);  // ears
    o.fillTriangle(cx + 15, cy - 9, cx + 8, cy - 15, cx + 5, cy - 8, SSD1306_WHITE);
    o.fillRoundRect(cx - 14, cy - 12, 28, 23, 9, SSD1306_WHITE);  // head
    o.fillRoundRect(cx - 17, cy + 9, 13, 6, 3, SSD1306_WHITE);    // paws
    o.fillRoundRect(cx + 4, cy + 9, 13, 6, 3, SSD1306_WHITE);
    o.drawFastVLine(cx - 11, cy + 11, 3, SSD1306_BLACK);
    o.drawFastVLine(cx + 11, cy + 11, 3, SSD1306_BLACK);
    o.drawRoundRect(cx - 8, cy, 16, 10, 4, SSD1306_BLACK);  // muzzle
    o.fillRoundRect(cx - 3, cy + 1, 6, 4, 2, SSD1306_BLACK); // nose
    o.drawLine(cx, cy + 5, cx - 3, cy + 7, SSD1306_BLACK);  // mouth
    o.drawLine(cx, cy + 5, cx + 3, cy + 7, SSD1306_BLACK);
    if (asleep) {
      o.drawLine(cx - 9, cy - 5, cx - 4, cy - 4, SSD1306_BLACK);
      o.drawLine(cx + 4, cy - 4, cx + 9, cy - 5, SSD1306_BLACK);
    } else if ((millis() / 120) % 30 == 0) {  // blink now and then
      o.drawFastHLine(cx - 8, cy - 5, 4, SSD1306_BLACK);
      o.drawFastHLine(cx + 4, cy - 5, 4, SSD1306_BLACK);
    } else {
      o.fillCircle(cx - 6, cy - 5, 2, SSD1306_BLACK);
      o.fillCircle(cx + 6, cy - 5, 2, SSD1306_BLACK);
      o.drawPixel(cx - 7, cy - 6, SSD1306_WHITE);
      o.drawPixel(cx + 5, cy - 6, SSD1306_WHITE);
    }
  }

  void drawZzz(int x, int y) {
    int f = (millis() / 400) % 3;  // drifting up
    UI::oled.setCursor(x, y + 8 - f * 2);
    UI::oled.print("z");
    if (f > 0) {
      UI::oled.setCursor(x + 6, y + 2 - f * 2);
      UI::oled.print("Z");
    }
  }

  // speech bubble on the right, word-wrapped to 13 characters a line
  void drawBubble(const String &text) {
    String lines[3];
    int n = 0;
    String word, line;
    String t = text + " ";
    for (unsigned i = 0; i < t.length() && n < 3; i++) {
      if (t[i] != ' ') {
        word += t[i];
        continue;
      }
      if (line.length() + word.length() + (line.length() ? 1 : 0) > 13) {
        lines[n++] = line;
        line = word;
      } else {
        line += (line.length() ? " " : "") + word;
      }
      word = "";
    }
    if (n < 3 && line.length()) lines[n++] = line;
    int h = n * 10 + 6, y = 17 + (36 - h) / 2;
    UI::oled.drawRoundRect(46, y, 82, h, 4, SSD1306_WHITE);
    UI::oled.fillTriangle(46, y + h / 2 - 3, 46, y + h / 2 + 3, 41, y + h / 2 + 4, SSD1306_WHITE);
    for (int i = 0; i < n; i++) {
      UI::oled.setCursor(50, y + 4 + i * 10);
      UI::oled.print(lines[i]);
    }
  }

  void draw() override {
    bool asleep = phase == FOCUS && !paused;
    if (hasPhoto) {
      UI::oled.drawBitmap(0, UI::BAND, photo, 48, 48, SSD1306_WHITE);
      if (asleep) {
        UI::oled.fillRect(30, 17, 16, 14, SSD1306_BLACK);
        drawZzz(32, 17);
      }
    } else {
      drawPibble(21, 42, asleep);
      if (asleep) drawZzz(34, 16);
    }
    if (millis() < bubbleUntil && bubble.length()) {
      drawBubble(bubble);
    } else {
      UI::oled.setTextSize(2);
      String t = UI::fmtTime(left());
      UI::oled.setCursor(52 + max(0, (76 - (int)t.length() * 12) / 2), 26);
      UI::oled.print(t);
      UI::oled.setTextSize(1);
      String sub = phase == SETUP ? "< > time  P go" : paused ? "paused" : phase == FOCUS ? "shh, focus" : "break";
      UI::oled.setCursor(52 + max(0, (76 - (int)sub.length() * 6) / 2), 48);
      UI::oled.print(sub);
    }
    if (sessions) {  // a little heart per finished session
      for (int i = 0; i < min(sessions, 4); i++) UI::heart(124 - i * 9, 57, 1);
    }
  }
};
static ZenScreen zenScreen;