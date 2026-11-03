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
static volatile uint32_t perfGaps = 0, perfGapFrames = 0;  // pulls the ring could not fill while playing (audible dropouts)
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
//
// A decoded MP3 frame (1152 stereo frames) waits in the decoder's own PCM buffer (the "stage")
// and is moved into the ring as room appears; the next frame is only decoded once it is all in.
// Without this a frame could only be decoded once the ring had room for all of it, and
// Bluetooth drains the ring in bursts of ~1300 frames: then only one MP3 frame got in per
// burst, ~87% of real time, heard as ~45 tiny dropouts a second. Pointing into the decoder's
// buffer instead of copying saves 4.6 KB, which Bluetooth needs: it allocates a 4 KB block per
// packet, and with room for only one at a time it sends ~58% of the stream (stutter).
static volatile bool ringOverflow = false;
static const int16_t *stagePcm = nullptr;
static int stageCh = 2;
static uint32_t stageLen = 0, stagePos = 0;  // in frames

static void onPcm(MP3FrameInfo &info, short *pcm, size_t samples, void *) {
  if (info.samprate != SAMPLE_RATE) lastError = "Unsupported sample rate";
  if (stageLen > stagePos) {  // not expected: one write() decodes at most one frame
    ringOverflow = true;
    return;
  }
  stagePcm = pcm;
  stageCh = info.nChans == 2 ? 2 : 1;
  stageLen = samples / stageCh;
  stagePos = 0;
}

// decodeTask only: move what fits from the stage into the ring
static void drainStage() {
  if (stagePos < stageLen)
    stagePos += ring.pushSamples(stagePcm + stagePos * stageCh, (stageLen - stagePos) * stageCh, stageCh);
  if (stagePos >= stageLen) stageLen = stagePos = 0;
}

static void clearAudio() {
  Guard g;
  ring.clear();
  stageLen = stagePos = 0;
}

static bool audioQueued() { return ring.used() > 0 || stagePos < stageLen; }

// The ring is only big (RING_FRAMES) while Bluetooth needs it; the speaker gets by with half,
// and the memory that saves is what lets the headphones connect while the speaker plays.
static bool resizeRing(uint32_t frames) {
  Guard g;
  if (ring.capacity() == frames) return true;
  bool ok = ring.resize(frames);
  stageLen = stagePos = 0;
  return ok;
}

// Called from the Bluetooth task: fill `len` stereo frames
// Loudness history for the visualiser: one value per ~46 ms, 0..255
static volatile uint8_t level[32];
static volatile uint8_t levelPos = 0;
static uint32_t levelSum = 0, levelCount = 0;

static void pushLevel(uint32_t frames, uint32_t sumAbs) {
  levelSum += sumAbs;
  levelCount += frames;
  if (levelCount >= 2048) {
    uint32_t avg = levelSum / levelCount;  // 0..32767
    level[levelPos] = (uint8_t)min<uint32_t>(255, avg / 24);
    levelPos = (levelPos + 1) & 31;
    levelSum = levelCount = 0;
  }
}

static volatile uint32_t perfBurst = 0, perfPullGapMax = 0, perfGapStage = 0;  // pull timing, for diagnosing dropouts
static uint32_t lastPullUs = 0;

static int32_t fillFrames(uint32_t *out, int32_t len) {
  uint32_t n = 0;
  perfPulls++; perfPullFrames += len; if ((uint32_t)len > perfPullMax) perfPullMax = len;
  uint32_t nowUs = micros(), dt = nowUs - lastPullUs;
  lastPullUs = nowUs;
  if (dt < 500) perfBurst++;
  if (dt > perfPullGapMax && dt < 1000000) perfPullGapMax = dt;
  if (state == PLAYING) {
    n = ring.pop(out, len);
    if (n < (uint32_t)len && stageLen > stagePos) perfGapStage++;
    uint32_t sum = 0;
    for (uint32_t i = 0; i < n; i++) {
      int16_t l = (int16_t)(out[i] & 0xFFFF), r = (int16_t)(out[i] >> 16);
      sum += (abs((int)l) + abs((int)r)) >> 1;
    }
    pushLevel(n, sum);
    if (n < (uint32_t)len && !eof) {
      perfGaps++;
      perfGapFrames += len - n;
    }
  }
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
  clearAudio();
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
  clearAudio();
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
    // Decode the next frame only once the previous one has fully moved into the ring,
    // so onPcm always has an empty stage to write into.
    if (state == PLAYING) {
      perfIter++;
      uint32_t tl = micros();
      bool got = xSemaphoreTakeRecursive(lock, pdMS_TO_TICKS(10)) == pdTRUE;
      perfLockWait += micros() - tl;
      if (!got) perfLockMiss++;
      if (got) {
        drainStage();
        if (stageLen) perfGate++;
        if (state == PLAYING && file && !eof && !stageLen) {
          if (!mp3 && !mp3.begin()) {
            lastError = "Out of memory";
            state = PAUSED;
          } else {
            // Feed until the next frame is decoded (an MP3 frame is ~420 bytes, so 2-3 bites),
            // in one go: napping a tick between bites left the ring to run dry under a burst.
            for (int bite = 0; bite < 6 && !stageLen && !eof && state == PLAYING; bite++) {
              uint32_t t0 = micros();
              int n = file.read(buf, sizeof(buf));
              perfRead += micros() - t0;
              if (n <= 0) {
                eof = true;
                break;
              }
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
            drainStage();  // start filling the ring with the new frame right away
          }
        }
        xSemaphoreGiveRecursive(lock);
      }
    }
    vTaskDelay(1);  // always yield: the main loop (USB, screen, buttons) must run too
  }
}

static void begin() {
  lock = xSemaphoreCreateRecursiveMutex();
  ring.begin(RING_FRAMES / 2);  // grows when headphones connect, see resizeRing()
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
  if (eof && !audioQueued()) {
    if (repeat == REPEAT_ONE) playIndex(qpos);
    else next();
  }
}

static const char *stateName() {
  return state == PLAYING ? "playing" : state == PAUSED ? "paused" : "stopped";
}

}  // namespace Player
