#pragma once
#include <Arduino.h>
#include <SD.h>
#include <Preferences.h>
#include <MP3DecoderHelix.h>
#include <vector>
#include "config.h"
#include "library.h"
#include "pcm_ring.h"

using namespace libhelix;

enum PlayState { STOPPED, PLAYING, PAUSED };
enum RepeatMode { REPEAT_OFF = 0, REPEAT_ALL = 1, REPEAT_ONE = 2 };

extern Preferences prefs;

// Decodes MP3 files from the SD card into a PCM ring that the Bluetooth
// task drains. All SD access happens in loop(), never in the BT task.
namespace Player {

static PcmRing ring;
static MP3DecoderHelix mp3;
static File file;
static volatile PlayState state = STOPPED;
static volatile uint32_t framesPlayed = 0;
static bool eof = false;
static uint32_t fileSize = 0;

static std::vector<String> queue;
static int qpos = 0;
static Track current;
static bool hasArt = false;
static uint8_t art[512];  // 1-bit, row-major, MSB first: 48x48 (288 bytes) or 64x64 (512)
static int artSize = 48;

static uint8_t volume = 60;  // 0..100
static RepeatMode repeat = REPEAT_ALL;
static bool shuffle = false;
static String lastError;
static volatile uint32_t perfRead = 0, perfDecode = 0, perfBytes = 0, perfLockMiss = 0, perfGate = 0, perfIter = 0, perfLockWait = 0, perfPulls = 0, perfPullFrames = 0, perfPullMax = 0;  // microseconds / bytes since boot, for diagnosing slow playback

// Decoding runs in its own task (see decodeTask) so screen updates, USB traffic and menus in
// loop() can never starve the audio. This lock guards the file and the decoder between them.
static SemaphoreHandle_t lock = nullptr;
struct Guard {
  Guard() { if (lock) xSemaphoreTakeRecursive(lock, portMAX_DELAY); }
  ~Guard() { if (lock) xSemaphoreGiveRecursive(lock); }
};

// Called by the decoder, which runs inside mp3.write() while decodeTask holds
// the decoder lock. It must therefore NEVER block: if it waited for ring room,
// loop() (core 1) would block on that same lock and the whole device would
// freeze. So push what fits and drop the rest of this burst; the decode loop
// sees the shortfall and feeds again shortly. Worst case a rare audible click,
// never a hang.
static volatile bool ringOverflow = false;
static void onPcm(MP3FrameInfo &info, short *pcm, size_t samples, void *) {
  if (info.samprate != SAMPLE_RATE) lastError = "Unsupported sample rate";
  uint32_t want = info.nChans == 2 ? samples / 2 : samples;  // frames wanted
  uint32_t put = ring.pushSamples(pcm, samples, info.nChans);
  if (put < want) ringOverflow = true;
}

// Called from the Bluetooth task: fill `len` stereo frames
static int32_t fillFrames(uint32_t *out, int32_t len) {
  uint32_t n = 0;
  perfPulls++; perfPullFrames += len; if ((uint32_t)len > perfPullMax) perfPullMax = len;
  if (state == PLAYING) n = ring.pop(out, len);
  if (n < (uint32_t)len) memset(out + n, 0, (len - n) * sizeof(uint32_t));
  framesPlayed += n;
  return len;
}

static uint32_t position() { return framesPlayed / SAMPLE_RATE; }
static bool isPlaying() { return state == PLAYING; }

static void saveQueue() {
  File f = SD.open(QUEUE_PATH, FILE_WRITE);
  if (!f) return;
  for (auto &id : queue) f.println(id);
  f.close();
  prefs.putInt("qpos", qpos);
}

static void loadQueue() {
  queue.clear();
  queue.reserve(Library::count() + 1);  // one allocation for the whole queue, not a realloc chain
  File f = SD.open(QUEUE_PATH, FILE_READ);
  if (f) {
    while (f.available() && queue.size() < 500) {
      String id = f.readStringUntil('\n');
      id.trim();
      if (id.length()) queue.push_back(id);
    }
    f.close();
  }
  if (queue.empty()) Library::allIds(queue);
  qpos = constrain(prefs.getInt("qpos", 0), 0, max(0, (int)queue.size() - 1));
}

static void closeFile() {
  Guard g;
  if (file) file.close();
  eof = true;
  // Do NOT mp3.end() here: tearing the decoder down and rebuilding it costs
  // ~25 KB of heap churn (decoder + frame + PCM buffers) and, with Bluetooth
  // up, fails intermittently ("allocation failed", then a stall). The decoder
  // is allocated once in begin() and reused; helix re-syncs on the new file's
  // first MP3 frame by itself. seek() re-inits it because a mid-file restart
  // can leave stale bit-reservoir state.
}

static bool loadTrack(int index) {
  Guard g;
  closeFile();
  ring.clear();
  framesPlayed = 0;
  hasArt = false;
  if (index < 0 || index >= (int)queue.size()) return false;
  qpos = index;
  const String &id = queue[qpos];
  if (!Library::find(id, current)) {
    current = Track();
    current.id = id;
    current.title = id;
  }
  file = SD.open(Library::musicPath(id), FILE_READ);
  if (!file) {
    lastError = "Missing file";
    return false;
  }
  fileSize = file.size();
  eof = false;
  File a = SD.open(Library::artPath(id), FILE_READ);
  if (a) {
    int n = a.read(art, sizeof(art));
    hasArt = n == 288 || n == 512;
    artSize = n == 288 ? 48 : 64;
    a.close();
  }
  prefs.putInt("qpos", qpos);
  return true;
}

static int nextIndex(int dir) {
  int n = queue.size();
  if (n == 0) return -1;
  if (shuffle && n > 1 && dir > 0) {
    int r;
    do r = random(n); while (r == qpos);
    return r;
  }
  int i = qpos + dir;
  if (i >= n) return repeat == REPEAT_OFF ? -1 : 0;
  if (i < 0) return repeat == REPEAT_OFF ? 0 : n - 1;
  return i;
}

// Plays queue[index], skipping over missing files
static bool playIndex(int index, int dir = 1) {
  for (int tries = 0; tries < (int)queue.size(); tries++) {
    if (loadTrack(index)) {
      state = PLAYING;
      return true;
    }
    qpos = index;
    index = nextIndex(dir);
    if (index < 0) break;
  }
  state = STOPPED;
  return false;
}

static void play() {
  if (!JJ_BT) return;
  if (ESP.getFreeHeap() < 8000) {
    lastError = "Low memory";
    return;
  }
  if (state == PAUSED && file) {
    state = PLAYING;
    return;
  }
  if (state == PLAYING) return;
  if (queue.empty()) loadQueue();
  playIndex(qpos);
}

static void pause() {
  if (state == PLAYING) state = PAUSED;
}

static void toggle() { state == PLAYING ? pause() : play(); }

static void next() {
  int i = nextIndex(1);
  if (i < 0) {
    closeFile();
    state = STOPPED;
    return;
  }
  playIndex(i, 1);
}

static void prev() {
  if (position() > 3 && file) {
    playIndex(qpos);
    return;
  }
  int i = nextIndex(-1);
  playIndex(i < 0 ? 0 : i, -1);
}

static void seek(uint32_t sec) {
  Guard g;
  if (!file || current.dur == 0) return;
  sec = min(sec, current.dur);
  uint32_t offset = (uint64_t)fileSize * sec / current.dur;
  file.seek(offset);
  eof = false;
  mp3.begin();  // reset the stream: clears stale bit-reservoir state for the new position
  ring.clear();
  framesPlayed = sec * SAMPLE_RATE;
}

static void setQueue(const std::vector<String> &ids, int index) {
  queue = ids;
  qpos = constrain(index, 0, max(0, (int)queue.size() - 1));
  saveQueue();
  playIndex(qpos);
}

static void setVolume(int v) {
  volume = constrain(v, 0, 100);
  prefs.putUChar("vol", volume);
}

// Stop using a file that is about to be overwritten or deleted
static void releaseFile(const String &path) {
  Guard g;
  if (file && Library::musicPath(current.id) == path) {
    closeFile();
    state = STOPPED;
  }
}

static void decodeTask(void *) {
  static uint8_t buf[256];  // small bites: one decoded frame at most, so the ring never overflows
  for (;;) {
    bool fed = false;
    // Wait for room for the largest burst mp3.write() can emit in one call
    // (helix decodes its whole 2 KB input buffer at once: ~4 MP3 frames,
    // ~104 ms of PCM). Below this, skip the write so onPcm never has to drop.
    if (state == PLAYING) {
      perfIter++;
      uint32_t tl = micros();
      bool got = xSemaphoreTakeRecursive(lock, pdMS_TO_TICKS(10)) == pdTRUE;
      perfLockWait += micros() - tl;
      if (!got) perfLockMiss++;
      if (got) {
        if (!(ring.space() >= RING_HIGH_WATER)) perfGate++;
        if (state == PLAYING && file && !eof && ring.space() >= RING_HIGH_WATER) {
          if (!mp3 && !mp3.begin()) {
            lastError = "Out of memory";
            state = PAUSED;
          } else {
            uint32_t t0 = micros();
            int n = file.read(buf, sizeof(buf));
            perfRead += micros() - t0;
            if (n <= 0) eof = true;
            else {
              // Don't crash if write does something unexpected
              try {
                uint32_t t1 = micros();
                mp3.write(buf, n);
                perfDecode += micros() - t1;
                perfBytes += n;
              } catch (...) {
                lastError = "Decode error";
                state = PAUSED;
              }
            }
            fed = n > 0;
          }
        }
        xSemaphoreGiveRecursive(lock);
      }
    }
    vTaskDelay(fed ? 1 : pdMS_TO_TICKS(4));  // always yield: the main loop (USB, screen, buttons) must run too
  }
}

static void begin() {
  lock = xSemaphoreCreateRecursiveMutex();
  ring.begin(RING_FRAMES);
  mp3.setDataCallback(onPcm);
  volume = prefs.getUChar("vol", 60);
  repeat = (RepeatMode)prefs.getUChar("repeat", REPEAT_ALL);
  shuffle = prefs.getBool("shuffle", false);
  loadQueue();
  if (!queue.empty()) loadTrack(qpos);  // show it paused, ready to go
  state = file ? PAUSED : STOPPED;
  // higher priority than loop() so audio never waits for the screen; it yields every pass
  xTaskCreatePinnedToCore(decodeTask, "decode", 4096, nullptr, 3, nullptr, 1);
}

// Advance at the end of a track (decoding itself happens in decodeTask)
static void loop() {
  if (state != PLAYING || !file) return;
  if (eof && ring.used() == 0) {
    if (repeat == REPEAT_ONE) playIndex(qpos);
    else next();
  }
}

static const char *stateName() {
  return state == PLAYING ? "playing" : state == PAUSED ? "paused" : "stopped";
}

}  // namespace Player
