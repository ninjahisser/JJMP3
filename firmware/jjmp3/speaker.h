#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "config.h"
#include "player.h"
#include "bt.h"

extern Preferences prefs;

#if JJ_BT
#include "driver/i2s_std.h"

// The built-in speaker (MAX98357 I2S amplifier): plays the music whenever no Bluetooth
// headphones are linked. It pulls from the same PCM ring as the Bluetooth task; it stops as
// soon as a headset connects (before that one starts pulling), so only one drains it at a time.
namespace Speaker {

static bool enabled = true;  // Settings > Speaker
static i2s_chan_handle_t tx = nullptr;
static bool running = false;          // clocks on; with them off the amplifier shuts itself down (no hiss)
static volatile bool active = false;  // playing through the speaker right now

static bool failed = false;  // the I2S channel could not be set up

static bool wanted() { return enabled && !BT::connected() && Player::isPlaying(); }

// The channel's DMA buffers are only allocated while the speaker may play: a Bluetooth
// stream needs nearly all the heap there is, so with headphones linked it is freed again.
static bool open() {
  i2s_chan_config_t cc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  cc.dma_desc_num = 4;
  cc.dma_frame_num = 240;  // 4 x 240 frames: ~22 ms of buffer, ~4 KB
  cc.auto_clear = true;    // an underrun plays silence, not the last buffer again
  if (i2s_new_channel(&cc, &tx, nullptr) != ESP_OK) {
    tx = nullptr;
    return false;
  }
  i2s_std_config_t sc = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {.mclk = I2S_GPIO_UNUSED,
                   .bclk = (gpio_num_t)PIN_I2S_BCLK,
                   .ws = (gpio_num_t)PIN_I2S_LRC,
                   .dout = (gpio_num_t)PIN_I2S_DIN,
                   .din = I2S_GPIO_UNUSED,
                   .invert_flags = {false, false, false}},
  };
  if (i2s_channel_init_std_mode(tx, &sc) != ESP_OK) {
    i2s_del_channel(tx);
    tx = nullptr;
    return false;
  }
  return true;
}

static void close() {
  if (!tx) return;
  if (running) i2s_channel_disable(tx);
  i2s_del_channel(tx);
  tx = nullptr;
  running = false;
}

static TaskHandle_t handle = nullptr;

static void task(void *) {
  static uint32_t buf[256];  // stereo frames, ~6 ms
  for (;;) {
    if (!enabled || BT::connected()) {  // off, or headphones: give the task's stack back too (loop() restarts it)
      close();
      active = false;
      handle = nullptr;
      vTaskDelete(nullptr);
    }
    if (!wanted()) {
      if (!enabled || BT::connected()) close();
      else if (running) {  // just paused: keep the buffers, stop the clocks
        i2s_channel_disable(tx);
        running = false;
      }
      active = false;
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    if (!tx && (failed = !open())) {
      vTaskDelay(pdMS_TO_TICKS(500));  // no memory for the buffers right now: try again shortly
      continue;
    }
    if (!running) running = i2s_channel_enable(tx) == ESP_OK;
    active = true;
    Player::fillFrames(buf, 256);
    // volume follows a square law, which sounds even across the scale; 0..100 -> 0..32768
    int32_t gain = (int32_t)Player::volume * Player::volume * 32768 / 10000;
    for (uint32_t &f : buf) {
      int32_t l = (int16_t)(f & 0xFFFF) * gain >> 15, r = (int16_t)(f >> 16) * gain >> 15;
      f = (uint16_t)l | ((uint32_t)(uint16_t)r << 16);
    }
    size_t written;
    i2s_channel_write(tx, buf, sizeof(buf), &written, portMAX_DELAY);  // blocks until the DMA has room: this paces the task
  }
}

static void start() {
  if (enabled && !handle && !BT::connected()) xTaskCreatePinnedToCore(task, "speaker", 2560, nullptr, 4, &handle, 1);
}

static void loop() {
  start();  // back on once the headphones are gone
  // Bluetooth pulls ~1200 frames per burst, so it needs the full ring; grow it only once this
  // task has handed its memory back, and shrink it again before the speaker plays
  static uint32_t lastTry = 0;
  bool bt = BT::connected() && !handle;
  uint32_t want = bt ? RING_FRAMES : RING_FRAMES / 2;
  if (Player::ring.capacity() != want && millis() - lastTry > 1000) {
    lastTry = millis();
    Player::resizeRing(want);
  }
}

static void begin() {
  enabled = prefs.getBool("spk", true);
  start();
}

static void set(bool on) {
  enabled = on;
  prefs.putBool("spk", on);
  start();
}

static const char *stateName() {
  if (!enabled) return "off";
  if (failed) return "error";
  if (BT::connected()) return "headphones";
  return active ? "playing" : "ready";
}

}  // namespace Speaker

#else

// Wi-Fi mode has no audio: same interface, nothing plays
namespace Speaker {
static bool enabled = true;
static void begin() { enabled = prefs.getBool("spk", true); }
static void loop() {}
static void set(bool on) {
  enabled = on;
  prefs.putBool("spk", on);
}
static const char *stateName() { return enabled ? "music mode only" : "off"; }
}  // namespace Speaker

#endif
