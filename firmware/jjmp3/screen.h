#pragma once
#include <Arduino.h>
#include <functional>
#include "input.h"
#include "ui.h"

// A screen of the player's OS. Screens sit on a stack: P opens, holding P goes back.
struct Screen {
  virtual String title() { return ""; }  // shown in the yellow band
  virtual void draw() = 0;               // the blue area (or everything, when fullscreen)
  virtual void key(const KeyEvent &e) = 0;
  virtual void enter() {}                // each time it's opened
  virtual void tick() {}                 // every loop, while on top
  virtual bool fullscreen() { return false; }
  virtual bool animating() { return false; }  // wants frequent redraws
  virtual ~Screen() {}
};

namespace OS {
static Screen *stack[10];
static int depth = 0;

static Screen *top() { return stack[depth - 1]; }

static void push(Screen *s) {
  if (depth >= 10) return;
  stack[depth++] = s;
  s->enter();
  UI::invalidate();
}

static void back() {
  if (depth > 1) depth--;
  UI::invalidate();
}
}  // namespace OS

// A scrolling list: < > move, P selects, hold P goes back. Four rows fit in the blue area.
struct ListScreen : Screen {
  int sel = 0, scroll = 0;
  static const int ROWS = 4;

  virtual int count() = 0;
  virtual String label(int i) = 0;
  virtual String detail(int) { return ""; }
  virtual void select(int i) = 0;
  virtual String emptyText() { return "Nothing here yet"; }

  void clampSel() {
    int n = count();
    sel = n ? constrain(sel, 0, n - 1) : 0;
    if (sel < scroll) scroll = sel;
    if (sel >= scroll + ROWS) scroll = sel - ROWS + 1;
    scroll = constrain(scroll, 0, max(0, n - ROWS));
  }

  void enter() override { clampSel(); }

  void move(int d, bool wrap) {
    int n = count();
    if (!n) return;
    int s = sel + d;
    if (wrap) s = (s + n) % n;
    sel = constrain(s, 0, n - 1);
    clampSel();
  }

  void key(const KeyEvent &e) override {
    if (e.key == K_LEFT) move(-1, e.act == A_PRESS);
    else if (e.key == K_RIGHT) move(1, e.act == A_PRESS);
    else if (e.key == K_PLAY && e.act == A_PRESS && count()) select(sel);
    else if (e.key == K_PLAY && e.act == A_HOLD) OS::back();
  }

  void draw() override {
    clampSel();
    int n = count();
    if (!n) {
      UI::centerText(emptyText(), 34);
      return;
    }
    for (int r = 0; r < ROWS && scroll + r < n; r++) UI::drawRow(r, label(scroll + r), detail(scroll + r), scroll + r == sel, n > ROWS);
    UI::drawScrollbar(scroll, ROWS, n);
  }

  bool animating() override { return count() && (int)label(sel).length() * 6 > 110; }
};

// Two choices: do it, or don't.
struct ConfirmScreen : ListScreen {
  String question, yes;
  std::function<void()> onYes;
  void ask(const String &q, const String &yesLabel, std::function<void()> f) {
    question = q;
    yes = yesLabel;
    onYes = f;
    sel = 1;  // the safe choice first
    OS::push(this);
  }
  String title() override { return question; }
  int count() override { return 2; }
  String label(int i) override { return i == 0 ? yes : String("Cancel"); }
  void select(int i) override {
    OS::back();
    if (i == 0 && onYes) onYes();
  }
};
static ConfirmScreen confirmScreen;