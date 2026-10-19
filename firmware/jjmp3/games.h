#pragma once
#include <Arduino.h>
#include <SD.h>
#include "screen.h"

// ---------- Snake (built in) ----------
// The board is the blue area in 4 px cells: 32 x 12. < > turn, P pauses, hold P quits.
struct SnakeScreen : Screen {
  static const int W = 32, H = 12;
  uint16_t body[W * H];  // ring of cells, head at headIdx
  int headIdx = 0, len = 3, dir = 0;  // 0 right, 1 down, 2 left, 3 up
  int foodX = 0, foodY = 0, score = 0, best = 0;
  bool over = false, paused = false;
  uint32_t lastStep = 0;

  void placeFood() {
    for (;;) {
      foodX = random(W);
      foodY = random(H);
      bool hit = false;
      for (int i = 0; i < len && !hit; i++) hit = body[(headIdx - i + W * H) % (W * H)] == foodY * W + foodX;
      if (!hit) return;
    }
  }

  void reset() {
    len = 3;
    dir = 0;
    score = 0;
    over = paused = false;
    headIdx = 2;
    for (int i = 0; i < 3; i++) body[i] = (H / 2) * W + 8 + i;
    placeFood();
  }

  void enter() override { reset(); }
  String title() override { return over ? "Game over" : "Score " + String(score); }
  bool animating() override { return true; }

  void key(const KeyEvent &e) override {
    if (e.key == K_PLAY && e.act == A_HOLD) return OS::back();
    if (e.key == K_PLAY && e.act == A_PRESS) {
      if (over) reset();
      else paused = !paused;
    }
    if (e.act != A_PRESS || over || paused) return;
    if (e.key == K_LEFT) dir = (dir + 3) % 4;
    if (e.key == K_RIGHT) dir = (dir + 1) % 4;
  }

  void tick() override {
    uint32_t speed = max(70, 160 - score * 4);
    if (over || paused || millis() - lastStep < speed) return;
    lastStep = millis();
    uint16_t h = body[headIdx];
    int x = h % W + (dir == 0) - (dir == 2), y = h / W + (dir == 1) - (dir == 3);
    if (x < 0 || y < 0 || x >= W || y >= H) {
      over = true;
      best = max(best, score);
      return UI::invalidate();
    }
    for (int i = 0; i < len - 1; i++)
      if (body[(headIdx - i + W * H) % (W * H)] == y * W + x) {
        over = true;
        best = max(best, score);
        return UI::invalidate();
      }
    headIdx = (headIdx + 1) % (W * H);
    body[headIdx] = y * W + x;
    if (x == foodX && y == foodY) {
      len = min(len + 1, W * H - 1);
      score++;
      placeFood();
    }
    UI::invalidate();
  }

  void draw() override {
    if (over) {
      UI::centerText("Score " + String(score), 22, 2);
      UI::centerText("Best " + String(best), 42);
      UI::centerText("P again  hold P quit", 54);
      return;
    }
    UI::oled.fillRect(foodX * 4 + 1, UI::BAND + foodY * 4 + 1, 2, 2, SSD1306_WHITE);
    for (int i = 0; i < len; i++) {
      uint16_t c = body[(headIdx - i + W * H) % (W * H)];
      UI::oled.fillRect((c % W) * 4, UI::BAND + (c / W) * 4, 4, 4, SSD1306_WHITE);
    }
    if (paused) UI::centerText("Paused", 34);
  }
};
static SnakeScreen snakeScreen;

// ---------- CHIP-8 (games from the SD card) ----------
// A classic 64x32 virtual console; doubled it fills the 128x64 screen exactly.
// Keys: < 4, > 6, P 5, + 2, - 8. Hold P to quit.
struct Chip8Screen : Screen {
  uint8_t *mem = nullptr;
  uint8_t V[16], sp = 0, dt = 0, st = 0;
  uint16_t I = 0, pc = 0x200, stack[16];
  uint8_t fb[64 * 32 / 8];
  bool changed = true, waiting = false;
  uint8_t waitReg = 0;
  uint32_t lastTimer = 0, lastFrame = 0, lastRun = 0;
  String name, error;

  static constexpr uint8_t FONT[80] = {
      0xF0, 0x90, 0x90, 0x90, 0xF0, 0x20, 0x60, 0x20, 0x20, 0x70, 0xF0, 0x10, 0xF0, 0x80, 0xF0, 0xF0, 0x10, 0xF0, 0x10, 0xF0,
      0x90, 0x90, 0xF0, 0x10, 0x10, 0xF0, 0x80, 0xF0, 0x10, 0xF0, 0xF0, 0x80, 0xF0, 0x90, 0xF0, 0xF0, 0x10, 0x20, 0x40, 0x40,
      0xF0, 0x90, 0xF0, 0x90, 0xF0, 0xF0, 0x90, 0xF0, 0x10, 0xF0, 0xF0, 0x90, 0xF0, 0x90, 0x90, 0xE0, 0x90, 0xE0, 0x90, 0xE0,
      0xF0, 0x80, 0x80, 0x80, 0xF0, 0xE0, 0x90, 0x90, 0x90, 0xE0, 0xF0, 0x80, 0xF0, 0x80, 0xF0, 0xF0, 0x80, 0xF0, 0x80, 0x80};

  // CHIP-8 key -> our button
  static int keyFor(uint8_t k) {
    switch (k) {
      case 4: return K_LEFT;
      case 6: return K_RIGHT;
      case 5: return K_PLAY;
      case 2: return K_UP;
      case 8: return K_DOWN;
      default: return -1;
    }
  }
  static bool keyDown(uint8_t k) {
    int b = keyFor(k & 15);
    return b >= 0 && Input::isDown((Key)b);
  }

  bool load(const String &path) {
    name = path.substring(path.lastIndexOf('/') + 1);
    name.replace(".ch8", "");
    error = "";
    if (!mem) mem = (uint8_t *)malloc(4096);
    if (!mem) {
      error = "Not enough memory";
      return false;
    }
    memset(mem, 0, 4096);
    memcpy(mem + 0x50, FONT, 80);
    File f = SD.open(path, FILE_READ);
    if (!f) {
      error = "Can't open game";
      return false;
    }
    f.read(mem + 0x200, min<size_t>(f.size(), 4096 - 0x200));
    f.close();
    memset(V, 0, 16);
    memset(fb, 0, sizeof(fb));
    sp = dt = st = 0;
    I = 0;
    pc = 0x200;
    waiting = false;
    changed = true;
    lastRun = lastTimer = millis();
    return true;
  }

  void freeMem() {
    if (mem) free(mem);
    mem = nullptr;
  }

  bool fullscreen() override { return error.length() == 0; }
  String title() override { return name; }

  void key(const KeyEvent &e) override {
    if (e.key == K_PLAY && e.act == A_HOLD) {
      freeMem();
      return OS::back();
    }
    if (waiting && e.act == A_PRESS) {
      static const uint8_t back[K_COUNT] = {4, 5, 6, 2, 8};
      V[waitReg] = back[e.key];
      waiting = false;
    }
  }

  void step() {
    uint16_t op = (mem[pc & 0xFFF] << 8) | mem[(pc + 1) & 0xFFF];
    pc += 2;
    uint8_t x = (op >> 8) & 15, y = (op >> 4) & 15, n = op & 15, kk = op & 0xFF;
    uint16_t nnn = op & 0xFFF;
    switch (op >> 12) {
      case 0x0:
        if (op == 0x00E0) {
          memset(fb, 0, sizeof(fb));
          changed = true;
        } else if (op == 0x00EE && sp) pc = stack[--sp];
        break;
      case 0x1: pc = nnn; break;
      case 0x2:
        if (sp < 16) stack[sp++] = pc;
        pc = nnn;
        break;
      case 0x3: if (V[x] == kk) pc += 2; break;
      case 0x4: if (V[x] != kk) pc += 2; break;
      case 0x5: if (V[x] == V[y]) pc += 2; break;
      case 0x6: V[x] = kk; break;
      case 0x7: V[x] += kk; break;
      case 0x8: {
        uint8_t f = 0;
        switch (n) {
          case 0x0: V[x] = V[y]; break;
          case 0x1: V[x] |= V[y]; break;
          case 0x2: V[x] &= V[y]; break;
          case 0x3: V[x] ^= V[y]; break;
          case 0x4: { uint16_t s = V[x] + V[y]; V[x] = s; V[15] = s > 255; } break;
          case 0x5: f = V[x] >= V[y]; V[x] -= V[y]; V[15] = f; break;
          case 0x6: f = V[x] & 1; V[x] >>= 1; V[15] = f; break;
          case 0x7: f = V[y] >= V[x]; V[x] = V[y] - V[x]; V[15] = f; break;
          case 0xE: f = V[x] >> 7; V[x] <<= 1; V[15] = f; break;
        }
      } break;
      case 0x9: if (V[x] != V[y]) pc += 2; break;
      case 0xA: I = nnn; break;
      case 0xB: pc = nnn + V[0]; break;
      case 0xC: V[x] = random(256) & kk; break;
      case 0xD: {
        V[15] = 0;
        for (int r = 0; r < n; r++) {
          uint8_t bits = mem[(I + r) & 0xFFF];
          for (int c = 0; c < 8; c++) {
            if (!(bits & (0x80 >> c))) continue;
            int px = (V[x] + c) & 63, py = (V[y] + r) & 31;
            int bi = py * 64 + px;
            if (fb[bi >> 3] & (1 << (bi & 7))) V[15] = 1;
            fb[bi >> 3] ^= 1 << (bi & 7);
          }
        }
        changed = true;
      } break;
      case 0xE:
        if (kk == 0x9E && keyDown(V[x])) pc += 2;
        else if (kk == 0xA1 && !keyDown(V[x])) pc += 2;
        break;
      case 0xF:
        switch (kk) {
          case 0x07: V[x] = dt; break;
          case 0x0A: waiting = true; waitReg = x; break;
          case 0x15: dt = V[x]; break;
          case 0x18: st = V[x]; break;
          case 0x1E: I += V[x]; break;
          case 0x29: I = 0x50 + (V[x] & 15) * 5; break;
          case 0x33: mem[I & 0xFFF] = V[x] / 100; mem[(I + 1) & 0xFFF] = V[x] / 10 % 10; mem[(I + 2) & 0xFFF] = V[x] % 10; break;
          case 0x55: for (int i = 0; i <= x; i++) mem[(I + i) & 0xFFF] = V[i]; break;
          case 0x65: for (int i = 0; i <= x; i++) V[i] = mem[(I + i) & 0xFFF]; break;
        }
        break;
    }
  }

  void tick() override {
    if (!mem) return;
    uint32_t now = millis();
    while (now - lastTimer >= 16) {  // 60 Hz timers
      lastTimer += 16;
      if (dt) dt--;
      if (st) st--;
    }
    uint32_t todo = min<uint32_t>((now - lastRun) * 7 / 10, 40);  // about 700 instructions a second
    if (todo) lastRun = now;
    for (uint32_t i = 0; i < todo && !waiting; i++) step();
    if (changed && now - lastFrame > 33) {
      lastFrame = now;
      changed = false;
      UI::invalidate();
    }
  }

  void draw() override {
    if (error.length()) {
      UI::centerText(error, 30);
      UI::centerText("hold P: back", 46);
      return;
    }
    for (int i = 0; i < 64 * 32; i++)
      if (fb[i >> 3] & (1 << (i & 7))) UI::oled.fillRect((i & 63) * 2, (i >> 6) * 2, 2, 2, SSD1306_WHITE);
  }
};
static Chip8Screen chip8Screen;