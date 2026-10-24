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

// ---- world clock: fixed standard offsets plus the usual summer-time rules ----
enum SummerRule : uint8_t { SUMMER_NONE, SUMMER_EU, SUMMER_US, SUMMER_AU };
struct City {
  const char *name;
  int16_t stdMin;  // minutes east of UTC in winter
  SummerRule rule;
};
static const City CITIES[] = {
    {"Brussels", 60, SUMMER_EU},    {"London", 0, SUMMER_EU},       {"New York", -300, SUMMER_US},
    {"Los Angeles", -480, SUMMER_US}, {"Sao Paulo", -180, SUMMER_NONE}, {"Dubai", 240, SUMMER_NONE},
    {"Delhi", 330, SUMMER_NONE},    {"Beijing", 480, SUMMER_NONE},  {"Tokyo", 540, SUMMER_NONE},
    {"Sydney", 600, SUMMER_AU},     {"Cape Town", 120, SUMMER_NONE}};
static const int CITY_COUNT = sizeof(CITIES) / sizeof(CITIES[0]);

static int dow(int y, int m, int d) {  // 0 = Sunday
  static const int t[] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
  if (m < 3) y -= 1;
  return (y + y / 4 - y / 100 + y / 400 + t[m - 1] + d) % 7;
}
static int daysInMonth(int y, int m) {
  static const int d[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  return m == 2 && ((y % 4 == 0 && y % 100) || y % 400 == 0) ? 29 : d[m - 1];
}
static int nthSunday(int y, int m, int n) { return 1 + (7 - dow(y, m, 1)) % 7 + 7 * (n - 1); }
static int lastSunday(int y, int m) { int dim = daysInMonth(y, m); return dim - dow(y, m, dim); }
static int64_t epochAt(int y, int m, int d, int hour) {  // UTC seconds of y-m-d hour:00
  y -= m <= 2;
  int era = (y >= 0 ? y : y - 399) / 400, yoe = y - era * 400;
  int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1, doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return ((int64_t)(era * 146097 + doe - 719468)) * 86400 + hour * 3600;
}

static bool inSummerTime(const City &c, time_t utc) {
  struct tm tm;
  time_t local = utc + c.stdMin * 60;
  gmtime_r(&local, &tm);
  int y = tm.tm_year + 1900;
  switch (c.rule) {
    case SUMMER_EU: return utc >= epochAt(y, 3, lastSunday(y, 3), 1) && utc < epochAt(y, 10, lastSunday(y, 10), 1);
    case SUMMER_US: return utc >= epochAt(y, 3, nthSunday(y, 3, 2), 2) - c.stdMin * 60 && utc < epochAt(y, 11, nthSunday(y, 11, 1), 2) - (c.stdMin + 60) * 60;
    case SUMMER_AU: return utc >= epochAt(y, 10, nthSunday(y, 10, 1), 2) - c.stdMin * 60 || utc < epochAt(y, 4, nthSunday(y, 4, 1), 2) - c.stdMin * 60;
    default: return false;
  }
}

/** hh:mm in a city, plus a day marker when it isn't the same date as here ("+1", "-1") */
static String cityTime(const City &c) {
  time_t utc = time(nullptr);
  time_t there = utc + (c.stdMin + (inSummerTime(c, utc) ? 60 : 0)) * 60, here = utc + tzMinutes * 60;
  struct tm a, b;
  gmtime_r(&there, &a);
  gmtime_r(&here, &b);
  char buf[12];
  int diff = (a.tm_yday - b.tm_yday) + (a.tm_year - b.tm_year) * 366;
  snprintf(buf, sizeof(buf), "%02d:%02d%s", a.tm_hour, a.tm_min, diff > 0 ? "+1" : diff < 0 ? "-1" : "");
  return buf;
}

}  // namespace Profile