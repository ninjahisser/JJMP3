#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <sys/time.h>
#include <time.h>

extern Preferences prefs;

// The owner's name (for the splash and Washington Zen) and the time of day.
// The desktop app sets the clock whenever it connects; in Wi-Fi mode it also comes from NTP.
namespace Profile {

static String user;
static int tzMinutes = 0;  // local time = UTC + this

static void begin() {
  user = prefs.getString("user", "");
  tzMinutes = prefs.getInt("tz", 0);
}

static void setUser(const String &name) {
  user = name.substring(0, 20);
  user.trim();
  prefs.putString("user", user);
}

/** The name to say, or a friendly fallback. */
static String who() { return user.length() ? user : String("you"); }

static void setTime(uint32_t epoch, int tz) {
  struct timeval tv = {(time_t)epoch, 0};
  settimeofday(&tv, nullptr);
  if (tz != tzMinutes) {
    tzMinutes = tz;
    prefs.putInt("tz", tz);
  }
}

static bool timeKnown() { return time(nullptr) > 1700000000; }

static String hhmm() {
  time_t t = time(nullptr) + tzMinutes * 60;
  struct tm tm;
  gmtime_r(&t, &tm);
  char b[6];
  snprintf(b, sizeof(b), "%02d:%02d", tm.tm_hour, tm.tm_min);
  return b;
}

}  // namespace Profile