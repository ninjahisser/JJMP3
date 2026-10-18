#pragma once
#include <Arduino.h>

// Single-producer / single-consumer ring of stereo 16-bit frames packed as uint32.
// Producer: MP3 decoder in loop(). Consumer: Bluetooth A2DP task.
class PcmRing {
 public:
  bool begin(uint32_t frames) {
    buf = (uint32_t *)heap_caps_malloc(frames * sizeof(uint32_t), MALLOC_CAP_8BIT);
    size = frames;
    mask = frames - 1;
    head = tail = 0;
    return buf != nullptr;
  }

  uint32_t used() const { return head - tail; }
  uint32_t space() const { return size - used(); }

  // Producer only
  uint32_t push(const uint32_t *frames, uint32_t n) {
    n = min(n, space());
    for (uint32_t i = 0; i < n; i++) buf[(head + i) & mask] = frames[i];
    head += n;
    return n;
  }

  // Producer only: interleaved 16-bit samples, mono is duplicated
  uint32_t pushSamples(const int16_t *pcm, uint32_t samples, int channels) {
    uint32_t frames = channels == 2 ? samples / 2 : samples;
    frames = min(frames, space());
    for (uint32_t i = 0; i < frames; i++) {
      int16_t l = channels == 2 ? pcm[2 * i] : pcm[i];
      int16_t r = channels == 2 ? pcm[2 * i + 1] : pcm[i];
      buf[(head + i) & mask] = (uint16_t)l | ((uint32_t)(uint16_t)r << 16);
    }
    head += frames;
    return frames;
  }

  // Consumer only
  uint32_t pop(uint32_t *out, uint32_t n) {
    portENTER_CRITICAL(&lock);
    n = min(n, used());
    for (uint32_t i = 0; i < n; i++) out[i] = buf[(tail + i) & mask];
    tail += n;
    portEXIT_CRITICAL(&lock);
    return n;
  }

  void clear() {
    portENTER_CRITICAL(&lock);
    tail = head;
    portEXIT_CRITICAL(&lock);
  }

 private:
  uint32_t *buf = nullptr;
  uint32_t size = 0, mask = 0;
  volatile uint32_t head = 0, tail = 0;
  portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
};
