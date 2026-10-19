#pragma once
#include <Arduino.h>
#include <SD.h>
#include <vector>
#include "config.h"

struct Track {
  String id, title, artist;
  uint32_t dur = 0;
};

// Reads the track index written by the desktop app. Line-based so it never
// needs to be held in RAM as a whole.
namespace Library {

static uint32_t cachedCount = 0;
static std::vector<uint32_t> offsets;  // where each entry starts in the index, for quick lookups by position

static bool parseLine(const String &line, Track &t) {
  int a = line.indexOf('\t');
  if (a <= 0) return false;
  int b = line.indexOf('\t', a + 1);
  int c = b < 0 ? -1 : line.indexOf('\t', b + 1);
  t.id = line.substring(0, a);
  t.title = b < 0 ? line.substring(a + 1) : line.substring(a + 1, b);
  t.artist = b < 0 ? "" : (c < 0 ? line.substring(b + 1) : line.substring(b + 1, c));
  t.dur = c < 0 ? 0 : line.substring(c + 1).toInt();
  t.title.trim();
  t.artist.trim();
  return true;
}

// Calls fn(index, track) for each entry; stops early when fn returns false
template <typename F>
static void forEach(F fn) {
  File f = SD.open(INDEX_PATH, FILE_READ);
  if (!f) return;
  uint32_t i = 0;
  Track t;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    if (!parseLine(line, t)) continue;
    if (!fn(i++, t)) break;
  }
  f.close();
}

static uint32_t reload() {
  offsets.clear();
  File f = SD.open(INDEX_PATH, FILE_READ);
  Track t;
  while (f && f.available()) {
    uint32_t at = f.position();
    String line = f.readStringUntil('\n');
    if (parseLine(line, t)) offsets.push_back(at);
  }
  if (f) f.close();
  cachedCount = offsets.size();
  return cachedCount;
}

/** The i-th song in library order. */
static bool trackAt(uint32_t i, Track &out) {
  if (i >= offsets.size()) return false;
  File f = SD.open(INDEX_PATH, FILE_READ);
  if (!f) return false;
  f.seek(offsets[i]);
  bool ok = parseLine(f.readStringUntil('\n'), out);
  f.close();
  return ok;
}

static uint32_t count() { return cachedCount; }

static bool find(const String &id, Track &out) {
  bool found = false;
  forEach([&](uint32_t, const Track &t) {
    if (t.id != id) return true;
    out = t;
    found = true;
    return false;
  });
  return found;
}

static void allIds(std::vector<String> &ids) {
  ids.clear();
  forEach([&](uint32_t, const Track &t) { ids.push_back(t.id); return true; });
}

static String musicPath(const String &id) { return String(MUSIC_DIR) + "/" + id + ".mp3"; }
static String artPath(const String &id) { return String(ART_DIR) + "/" + id + ".bin"; }

}  // namespace Library
