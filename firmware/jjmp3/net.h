#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "config.h"

#if JJ_WIFI
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

extern Preferences prefs;

// Joins the saved Wi-Fi network and serves the app protocol over HTTP
namespace Net {

static WebServer server(80);
static bool serverUp = false;
static bool wasConnected = false;
static String ssid;

static void connect() {
  String pass = prefs.getString("wifi_pass", "");
  ssid = prefs.getString("wifi_ssid", "");
  if (!ssid.length()) return;
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.setSleep(true);  // required when sharing the radio with Bluetooth
  WiFi.begin(ssid.c_str(), pass.c_str());
}

static void begin() { connect(); }

static void setCredentials(const String &newSsid, const String &pass) {
  prefs.putString("wifi_ssid", newSsid);
  prefs.putString("wifi_pass", pass);
  WiFi.disconnect(true);
  delay(100);
  connect();
}

static void forget() {
  prefs.remove("wifi_ssid");
  prefs.remove("wifi_pass");
  ssid = "";
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

static bool connected() { return WiFi.status() == WL_CONNECTED; }

static const char *stateName() {
  if (!ssid.length()) return "off";
  return connected() ? "connected" : "connecting";
}

static String ip() { return connected() ? WiFi.localIP().toString() : String(""); }

// Returns true once, when a connection has just been established
static bool loop() {
  bool now = connected();
  bool justConnected = now && !wasConnected;
  wasConnected = now;
  if (justConnected) {
    if (!serverUp) {
      server.begin();
      serverUp = true;
    }
    MDNS.end();
    if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", 80);
  }
  if (serverUp && now) server.handleClient();
  return justConnected;
}

}  // namespace Net

#else

// Wi-Fi compiled out: same interface, nothing happens
namespace Net {
static String ssid;
static void begin() { ssid = prefs.getString("wifi_ssid", ""); }
static void setCredentials(const String &newSsid, const String &pass) {
  prefs.putString("wifi_ssid", newSsid);
  prefs.putString("wifi_pass", pass);
  ssid = newSsid;
}
static void forget() {
  prefs.remove("wifi_ssid");
  prefs.remove("wifi_pass");
  ssid = "";
}
static bool connected() { return false; }
static const char *stateName() { return ssid.length() ? "standby" : "off"; }
static String ip() { return String(""); }
static bool loop() { return false; }
}  // namespace Net

#endif
