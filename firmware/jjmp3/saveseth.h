#pragma once
#include <Arduino.h>
#include "screen.h"
#include "input.h"
#include "ui.h"

// Save Seth: a small side-scrolling brawler. Zoe walks through Kinepolis, punching Steffe's
// goons, to reach Steffe at the end and bring Seth home.
// < > walk, P punch, hold P quit. Three hearts.
struct SaveSethScreen : Screen {
  static const int LEVEL_END = 640;  // Steffe waits here
  static const int GROUND = 60;
  static const int MAX_GOONS = 5;
  struct Goon {
    bool on;
    float x;
    int hp;
    uint32_t flashUntil;
  } goons[MAX_GOONS];
  struct Talk {
    const char *text;
    float x, y;
    uint32_t until;
  } talk[3];

  enum State { PLAY, WIN, LOSE };
  State state = PLAY;
  float zx = 10;       // Zoe, world position
  bool faceRight = true;
  int hearts = 3, defeated = 0, bossHp = 8, nextSpawn = 0;
  float bossX = LEVEL_END + 40;
  bool bossOn = false;
  uint32_t punchUntil = 0, hurtUntil = 0, bossFlash = 0, lastStep = 0, nextTalk = 0, startedAt = 0;
  uint32_t winAt = 0;

  static constexpr int SPAWN_AT[] = {150, 230, 300, 370, 430, 490, 540, 580};
  static constexpr const char *NOISES[] = {"*snort*", "*fart*", "*burp*"};

  void reset() {
    for (auto &g : goons) g.on = false;
    for (auto &t : talk) t.until = 0;
    state = PLAY;
    zx = 10;
    faceRight = true;
    hearts = 3;
    defeated = 0;
    bossHp = 8;
    bossOn = false;
    bossX = LEVEL_END + 40;
    nextSpawn = 0;
    punchUntil = hurtUntil = bossFlash = 0;
    lastStep = millis();
    nextTalk = millis() + 1500;
    startedAt = millis();
  }

  void enter() override { reset(); }
  String title() override { return state == PLAY ? "Save Seth" : state == WIN ? "Seth is safe" : "Game over"; }
  bool animating() override { return true; }

  int camera() { return constrain((int)zx - 40, 0, LEVEL_END - 60); }

  void say(float x, float y) {
    for (auto &t : talk)
      if (t.until < millis()) {
        t.text = NOISES[random(3)];
        t.x = x;
        t.y = y;
        t.until = millis() + 1400;
        return;
      }
  }

  void key(const KeyEvent &e) override {
    if (e.key == K_PLAY && e.act == A_HOLD) return OS::back();
    if (e.key != K_PLAY || e.act != A_PRESS) return;
    if (state != PLAY) return reset();
    punchUntil = millis() + 170;
    float lo = faceRight ? zx + 2 : zx - 18, hi = faceRight ? zx + 18 : zx - 2;
    for (auto &g : goons)
      if (g.on && g.x + 4 > lo && g.x < hi) {
        g.hp--;
        g.flashUntil = millis() + 150;
        g.x += faceRight ? 8 : -8;
        if (g.hp <= 0) {
          g.on = false;
          defeated++;
        }
      }
    if (bossOn && bossX + 8 > lo && bossX - 4 < hi) {
      bossFlash = millis() + 150;
      bossX += faceRight ? 3 : -3;
      if (--bossHp <= 0) {
        state = WIN;
        winAt = millis();
      }
    }
  }

  void tick() override {
    uint32_t now = millis();
    if (state != PLAY || now - lastStep < 30) return;
    lastStep = now;
    if (Input::isDown(K_RIGHT)) { zx += 1.7f; faceRight = true; }
    if (Input::isDown(K_LEFT)) { zx -= 1.7f; faceRight = false; }
    zx = constrain(zx, 0.0f, bossOn ? (float)LEVEL_END + 20 : (float)LEVEL_END);

    // goons come in along the way, never more than MAX_GOONS at once
    if (nextSpawn < 8 && zx + 130 > SPAWN_AT[nextSpawn]) {
      for (auto &g : goons)
        if (!g.on) {
          g = {true, (float)SPAWN_AT[nextSpawn] + 40, 2, 0};
          break;
        }
      nextSpawn++;
    }
    if (!bossOn && zx > LEVEL_END - 100) bossOn = true;

    for (auto &g : goons) {
      if (!g.on) continue;
      g.x += g.x > zx ? -0.55f : 0.55f;
      if (fabsf(g.x - zx) < 6 && now > hurtUntil) hit(now, g.x > zx ? -1 : 1);
    }
    if (bossOn) {
      bossX += bossX > zx + 20 ? -0.25f : 0.25f;
      if (fabsf(bossX - zx) < 9 && now > hurtUntil) hit(now, bossX > zx ? -1 : 1);
    }

    if (now >= nextTalk) {  // Steffe's gang is never quiet
      float sx = bossOn ? bossX : zx + 90;
      for (auto &g : goons)
        if (g.on && random(2)) sx = g.x;
      say(sx, GROUND - 22);
      nextTalk = now + random(900, 2200);
    }
    UI::invalidate();
  }

  void hit(uint32_t now, int knock) {
    hurtUntil = now + 900;
    zx = max(0.0f, zx + knock * 14);
    if (--hearts <= 0) state = LOSE;
  }

  // ---- drawing ----
  void drawZoe(int sx, bool hurt) {
    auto &o = UI::oled;
    if (hurt && (millis() / 80) % 2) return;  // blink while hurt
    o.fillCircle(sx, GROUND - 17, 3, SSD1306_WHITE);                      // head
    o.drawLine(sx - 3, GROUND - 19, sx - 5, GROUND - 14, SSD1306_WHITE);  // ponytail
    o.drawLine(sx, GROUND - 14, sx, GROUND - 7, SSD1306_WHITE);           // body
    o.drawLine(sx, GROUND - 7, sx - 3, GROUND - 1, SSD1306_WHITE);        // legs
    o.drawLine(sx, GROUND - 7, sx + 3, GROUND - 1, SSD1306_WHITE);
    int dir = faceRight ? 1 : -1;
    bool punching = millis() < punchUntil;
    o.drawLine(sx, GROUND - 12, sx + dir * (punching ? 9 : 3), GROUND - (punching ? 12 : 8), SSD1306_WHITE);
    if (punching) o.fillCircle(sx + dir * 10, GROUND - 12, 1, SSD1306_WHITE);
  }

  void drawGoon(int sx, bool flash) {
    auto &o = UI::oled;
    if (flash) {
      o.fillRect(sx - 4, GROUND - 16, 9, 15, SSD1306_WHITE);
      return;
    }
    o.drawRect(sx - 4, GROUND - 12, 9, 11, SSD1306_WHITE);  // jacket
    o.fillRect(sx - 3, GROUND - 17, 7, 5, SSD1306_WHITE);   // head
    o.drawFastHLine(sx - 3, GROUND - 15, 7, SSD1306_BLACK);  // shades
    o.drawLine(sx - 2, GROUND - 1, sx - 2, GROUND, SSD1306_WHITE);
    o.drawLine(sx + 2, GROUND - 1, sx + 2, GROUND, SSD1306_WHITE);
  }

  void drawSteffe(int sx, bool flash) {
    auto &o = UI::oled;
    if (flash) {
      o.fillRect(sx - 7, GROUND - 26, 15, 25, SSD1306_WHITE);
      return;
    }
    o.drawRoundRect(sx - 7, GROUND - 16, 15, 16, 3, SSD1306_WHITE);  // big body
    o.fillCircle(sx, GROUND - 21, 6, SSD1306_WHITE);                 // head
    o.fillCircle(sx - 2, GROUND - 22, 1, SSD1306_BLACK);
    o.fillCircle(sx + 2, GROUND - 22, 1, SSD1306_BLACK);
    o.drawFastHLine(sx - 2, GROUND - 18, 5, SSD1306_BLACK);
    for (int i = -5; i <= 5; i += 5) o.drawLine(sx + i, GROUND - 27, sx + i, GROUND - 24, SSD1306_WHITE);  // spiky hair
  }

  void drawSeth(int sx) {
    auto &o = UI::oled;
    o.fillCircle(sx, GROUND - 14, 3, SSD1306_WHITE);
    o.drawLine(sx, GROUND - 11, sx, GROUND - 5, SSD1306_WHITE);
    o.drawLine(sx, GROUND - 5, sx - 2, GROUND - 1, SSD1306_WHITE);
    o.drawLine(sx, GROUND - 5, sx + 2, GROUND - 1, SSD1306_WHITE);
    o.drawLine(sx, GROUND - 9, sx - 3, GROUND - 12, SSD1306_WHITE);  // arms up: help!
    o.drawLine(sx, GROUND - 9, sx + 3, GROUND - 12, SSD1306_WHITE);
  }

  void draw() override {
    auto &o = UI::oled;
    int cam = camera();
    uint32_t now = millis();

    // Kinepolis: sign, film posters and floor
    o.setCursor(14 - cam, 20);
    o.print("KINEPOLIS");
    for (int w = 60; w < LEVEL_END + 120; w += 70) {
      int sx = w - cam;
      if (sx < -16 || sx > 128) continue;
      o.drawRect(sx, 30, 14, 18, SSD1306_WHITE);
      o.drawLine(sx + 3, 35, sx + 10, 35, SSD1306_WHITE);
      o.drawLine(sx + 3, 39, sx + 8, 39, SSD1306_WHITE);
    }
    o.drawFastHLine(0, GROUND, 128, SSD1306_WHITE);
    for (int x = -(cam % 8); x < 128; x += 8) o.drawPixel(x, GROUND + 2, SSD1306_WHITE);

    for (auto &g : goons)
      if (g.on) drawGoon((int)g.x - cam, now < g.flashUntil);
    if (bossOn && state != WIN) drawSteffe((int)bossX - cam, now < bossFlash);
    if (state == WIN) drawSeth((int)bossX - cam);
    drawZoe((int)zx - cam, now < hurtUntil);

    for (auto &t : talk)  // *snort* *fart* *burp* floating up
      if (t.until > now) {
        int rise = (1400 - (int)(t.until - now)) / 90;
        o.setCursor((int)t.x - cam - 18, (int)t.y - rise);
        o.print(t.text);
      }

    for (int i = 0; i < hearts; i++) UI::heart(118 - i * 9, 18, 1);  // lives

    if (state == WIN) {
      UI::centerText("Seth is safe!", 24);
      UI::heart(60, 34, 3);
      UI::centerText("P again  hold P quit", 56);
    } else if (state == LOSE) {
      UI::centerText("Steffe wins...", 28);
      UI::centerText("P again  hold P quit", 56);
    } else if (now - startedAt < 2600) {
      o.fillRect(0, 24, 128, 28, SSD1306_BLACK);
      UI::centerText("Steffe took Seth!", 28);
      UI::centerText("Punch your way there", 40);
    }
  }
};
static SaveSethScreen saveSethScreen;
