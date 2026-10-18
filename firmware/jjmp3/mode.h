#pragma once
#include <Arduino.h>
#include <esp_ota_ops.h>
#include "config.h"

// The music and Wi-Fi firmwares live in the two app partitions; switching
// mode means booting the other one.
namespace Mode {

static const char *name() { return JJ_WIFI ? "wifi" : "music"; }

static const esp_partition_t *other() {
  const esp_partition_t *running = esp_ota_get_running_partition();
  return esp_ota_get_next_update_partition(running);
}

// Returns an error message, or nullptr once the switch is armed
static const char *prepareSwitch() {
  const esp_partition_t *p = other();
  if (!p) return "no second firmware slot";
  esp_app_desc_t desc;
  if (esp_ota_get_partition_description(p, &desc) != ESP_OK) return "other mode is not installed";
  if (esp_ota_set_boot_partition(p) != ESP_OK) return "other mode is not installed";
  return nullptr;
}

static void restart() {
  delay(150);
  ESP.restart();
}

}  // namespace Mode
