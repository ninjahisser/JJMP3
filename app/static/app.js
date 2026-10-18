// JJMP3 desktop UI - vanilla JS, talks to the local server (server.py).
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtLong = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

async function api(path, { method, body } = {}) {
  const r = await fetch(path, {
    method: method || (body !== undefined ? "POST" : "GET"),
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}
const post = (path, body = {}) => api(path, { body });

// ---------- icons ----------
const P = {
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 6l9 6-9 6zM18 6v12"/>',
  prev: '<path d="M18 6l-9 6 9 6zM6 6v12"/>',
  shuffle: '<path d="M3 7h3c4 0 6 10 10 10h4M3 17h3c1.6 0 2.8-1.5 3.9-3.4M13.8 9.6C14.8 8.2 15.6 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  dots: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="2.6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  bt: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 15.8a4.8 4.8 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  usb: '<path d="M12 3v14M9 6l3-3 3 3M7 10v3l5 3M17 9v3l-5 3"/><circle cx="12" cy="19" r="2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M6.5 7l1 13h9l1-13"/>',
  list: '<path d="M4 6h16M4 12h10M4 18h7M17 15v6M14 18h6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  power: '<path d="M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0"/>',
};
const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24">${P[name]}</svg>`;

// ---------- state ----------
const S = { tracks: [], playlists: [], jobs: [], device: { connected: false, status: {} }, sync: {}, loaded: false };
const ui = { filter: "", btScanning: false, btDevices: [], wifiNets: null, sd: null, lastPoll: 0, sig: "" };
const byId = (id) => S.tracks.find((t) => t.id === id);
const status = () => S.device.status || {};
const coverStyle = (t) => (t && t.cover ? `style="background-image:url('/api/cover/${t.id}')"` : "");

function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3800);
}
const attempt = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- polling ----------
async function poll() {
  try {
    const d = await api("/api/state");
    Object.assign(S, d, { loaded: true });
    ui.lastPoll = performance.now();
    renderChrome();
    const sig = JSON.stringify([route().page, d.tracks, d.playlists, d.jobs, d.device.connected, d.device.status?.track,
      d.device.status?.state, d.device.status?.bt, d.device.status?.wifi, d.device.info, d.sync]);
    if (sig !== ui.sig) { ui.sig = sig; renderPage(); }
  } catch {
    // server restarting, try again shortly
  }
  clearTimeout(poll.t);
  poll.t = setTimeout(poll, S.jobs.some((j) => !["done", "error", "skipped"].includes(j.state)) || S.sync.busy ? 600 : 1000);
}

// ---------- chrome: sidebar + player ----------
function renderChrome() {
  const d = S.device, st = status();
  const onPlayer = S.tracks.filter((t) => t.on_device).length;
  $("#nav-lib").textContent = S.tracks.length || "";
  $("#nav-pl").textContent = S.playlists.length || "";
  const syncing = S.tracks.filter((t) => t.uploading != null);
  const rows = [];
  if (d.connected) {
    rows.push(`<div class="row"><span class="dot on"></span><span><b>Connected</b> · ${d.via === "usb" ? "USB " + esc(d.where) : "Wi-Fi " + esc(d.where)}</span></div>`);
    const bt = st.bt || {};
    if (st.mode === "wifi") rows.push(`<div class="row">${icon("bt")}<span class="muted">Bluetooth off in Wi-Fi mode</span></div>`);
    else rows.push(`<div class="row">${icon("bt")}<span>${bt.state === "connected" ? `<b>${esc(bt.name)}</b>` : bt.state === "off" ? "No headphones yet" : esc(bt.state || "…") + (bt.name ? " · " + esc(bt.name) : "")}</span></div>`);
    const w = st.wifi || {};
    const wifiText = st.mode === "wifi"
      ? (w.state === "connected" ? `<b>${esc(w.ssid)}</b> · Wi-Fi mode` : `Joining ${esc(w.ssid)}…`)
      : (w.ssid ? `${esc(w.ssid)} <span class="muted">· off while listening</span>` : "Wi-Fi not set up");
    rows.push(`<div class="row">${icon("wifi")}<span>${wifiText}</span></div>`);
    rows.push(`<div class="row">${icon("music")}<span>${syncing.length ? `<span class="dot busy" style="display:inline-block;margin-right:6px"></span>Sending ${syncing.length} song${syncing.length > 1 ? "s" : ""}…` : `${onPlayer} song${onPlayer === 1 ? "" : "s"} on the player`}</span></div>`);
  } else {
    rows.push(`<div class="row"><span class="dot"></span><span><b>Not connected</b></span></div>`);
    rows.push(`<div class="row muted">Plug the player in with USB, or keep it on the same Wi-Fi.</div>`);
  }
  $("#conn").innerHTML = rows.join("");
  $("#oled").hidden = !d.connected;
  $("#oled-off").hidden = d.connected;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === route().page.split("/")[0]));
  renderPlayer();
}

function renderPlayer() {
  const d = S.device, st = status(), t = byId(st.track);
  $("#player").classList.toggle("off", !d.connected);
  $("#p-play").innerHTML = icon(st.state === "playing" ? "pause" : "play");
  $("#p-prev").innerHTML = icon("prev");
  $("#p-next").innerHTML = icon("next");
  $("#p-shuffle").innerHTML = icon("shuffle");
  $("#p-shuffle").classList.toggle("on", !!st.shuffle);
  $("#p-repeat").innerHTML = icon("repeat") + (st.repeat === 2 ? '<span class="badge">1</span>' : "");
  $("#p-repeat").classList.toggle("on", st.repeat > 0);
  $("#p-repeat").title = ["Repeat off", "Repeat all", "Repeat one"][st.repeat || 0];
  $("#p-vol-icon").innerHTML = icon("vol");
  if (document.activeElement !== $("#p-vol") && st.vol != null) setVol(st.vol);
  if (!d.connected) {
    $("#p-title").textContent = "Nothing playing";
    $("#p-artist").textContent = "Connect your JJMP3 via USB";
    $("#p-cover").removeAttribute("style");
    $("#p-cover").innerHTML = icon("music");
  } else if (st.track) {
    $("#p-title").textContent = t?.title || st.title || "";
    $("#p-artist").textContent = t?.artist || st.artist || "";
    if (t?.cover) { $("#p-cover").style.backgroundImage = `url('/api/cover/${t.id}')`; $("#p-cover").innerHTML = ""; }
    else { $("#p-cover").removeAttribute("style"); $("#p-cover").innerHTML = icon("music"); }
  } else if (st.mode === "wifi") {
    $("#p-title").textContent = "Wi-Fi mode";
    $("#p-artist").textContent = "Switch to music mode to listen";
  } else {
    $("#p-title").textContent = "Ready";
    $("#p-artist").textContent = st.bt?.state === "connected" ? "Pick a song to play" : "Connect headphones under Player";
  }
  tick();
}

function tick() {
  const st = status();
  let pos = st.pos || 0;
  if (st.state === "playing" && st.bt?.state === "connected") pos += (performance.now() - ui.lastPoll) / 1000;
  pos = Math.min(pos, st.dur || pos);
  $("#p-pos").textContent = fmt(pos);
  $("#p-dur").textContent = fmt(st.dur);
  $("#p-fill").style.width = st.dur ? `${(pos / st.dur) * 100}%` : "0";
}
setInterval(tick, 250);

function setVol(v) {
  $("#p-vol").value = v;
  $("#p-vol").style.setProperty("--v", v + "%");
}

const control = attempt(async (cmd, params = {}) => {
  const r = await post(`/api/control/${cmd}`, params);
  poll();
  return r;
});

function wirePlayer() {
  $("#p-play").onclick = () => control("toggle");
  $("#p-next").onclick = () => control("next");
  $("#p-prev").onclick = () => control("prev");
  $("#p-shuffle").onclick = () => control("mode", { shuffle: !status().shuffle });
  $("#p-repeat").onclick = () => control("mode", { repeat: ((status().repeat || 0) + 1) % 3 });
  $("#p-rail").onclick = (e) => {
    const st = status();
    if (!st.dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    control("seek", { pos: Math.round(((e.clientX - r.left) / r.width) * st.dur) });
  };
  let vt;
  $("#p-vol").oninput = (e) => {
    setVol(e.target.value);
    clearTimeout(vt);
    vt = setTimeout(() => control("vol", { v: +e.target.value }), 120);
  };
}

// The OLED mirror: fetch a new frame whenever the last one has arrived
function oledLoop() {
  const img = $("#oled");
  const next = () => setTimeout(oledLoop, document.hidden ? 2000 : 450);
  if (!S.device.connected) return next();
  const probe = new Image();
  probe.onload = () => { img.src = probe.src; next(); };
  probe.onerror = next;
  probe.src = `/api/screen?t=${Date.now()}`;
}

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, "") || "library";
  return { page: h };
}
window.addEventListener("hashchange", () => { ui.sig = ""; renderPage(); renderChrome(); $("main").scrollTop = 0; });

function renderPage() {
  const { page } = route();
  const view = $("#view");
  const focused = document.activeElement;
  const keepFocus = focused && view.contains(focused) && focused.id;
  const caret = keepFocus && focused.selectionStart;
  if (page === "library") renderLibrary(view);
  else if (page === "playlists") renderPlaylists(view);
  else if (page.startsWith("playlists/")) renderPlaylist(view, page.split("/")[1]);
  else if (page === "device") renderDevice(view);
  else renderLibrary(view);
  if (keepFocus && $("#" + keepFocus)) {
    const el = $("#" + keepFocus);
    el.focus();
    if (el.setSelectionRange && caret != null) el.setSelectionRange(caret, caret);
  }
}
// ---------- shared track rows ----------
function trackState(t) {
  if (t.uploading != null) return `<div class="state"><span class="prog"><i style="width:${Math.round(t.uploading * 100)}%"></i></span><span class="mono">${Math.round(t.uploading * 100)}%</span></div>`;
  if (t.device_only) return `<div class="state"><span class="dot on"></span>Only on player</div>`;
  if (t.on_device) return `<div class="state"><span class="dot on"></span>On player</div>`;
  return `<div class="state"><span class="dot"></span>${S.device.connected ? "Queued" : "Not sent yet"}</div>`;
}

function trackRow(t, i, opts = {}) {
  const st = status();
  const playing = st.track === t.id;
  const num = playing ? `<span class="eq ${st.state === "playing" ? "" : "paused"}"><i></i><i></i><i></i></span>` : `<span class="mono">${i + 1}</span>`;
  return `<div class="track ${playing ? "playing" : ""}" data-id="${t.id}" ${opts.draggable ? 'draggable="true"' : ""}>
    <div class="n">${opts.draggable ? `<span class="grip">${icon("grip")}</span>` : num}<button class="icon-btn" data-act="play" title="Play">${icon("play")}</button></div>
    <div class="cover" ${coverStyle(t)}>${t.cover ? "" : icon("music")}</div>
    <div class="meta"><div class="title">${esc(t.title)}</div><div class="artist">${esc(t.artist || "Unknown artist")}</div></div>
    ${trackState(t)}
    <div class="dur mono">${fmt(t.duration)}</div>
    <button class="icon-btn" data-act="menu" title="${opts.removable ? "Take out of playlist" : "More"}">${icon(opts.removable ? "x" : "dots")}</button>
  </div>`;
}

const playTrack = attempt(async (trackId, playlistId) => {
  await post("/api/play", { track_id: trackId, playlist_id: playlistId || null });
  poll();
});

function wireRows(root, { playlistId, onTakeOut } = {}) {
  $$(".track", root).forEach((row) => {
    const id = row.dataset.id;
    row.ondblclick = () => playTrack(id, playlistId);
    $('[data-act="play"]', row).onclick = (e) => { e.stopPropagation(); playTrack(id, playlistId); };
    $('[data-act="menu"]', row).onclick = (e) => {
      e.stopPropagation();
      if (onTakeOut) return onTakeOut(id);
      trackMenu(id, e.currentTarget);
    };
  });
}

// ---------- menus & dialogs ----------
function openMenu(anchor, html, wire) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = html;
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 12);
  m.style.top = `${Math.max(12, top)}px`;
  m.style.left = `${Math.max(12, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 12))}px`;
  wire(m);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}
function closeMenu() { $$(".menu").forEach((m) => m.remove()); }

function trackMenu(id, anchor) {
  const t = byId(id);
  const pls = S.playlists.map((p) => `<button data-pl="${p.id}">${icon("list")}${esc(p.name)}</button>`).join("");
  openMenu(anchor, `
    <button data-a="play">${icon("play")}Play</button>
    <hr><div class="lbl">Add to playlist</div>${pls}
    <button data-a="newpl">${icon("plus")}New playlist…</button><hr>
    ${t.device_only ? "" : `<button data-a="edit">${icon("edit")}Edit details</button>`}
    ${t.url ? `<button data-a="src">${icon("link")}Open source</button>` : ""}
    <button data-a="trash" class="danger">${icon("trash")}Remove</button>`, (m) => {
    m.onclick = attempt(async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      closeMenu();
      if (b.dataset.pl) {
        const p = S.playlists.find((x) => x.id === b.dataset.pl);
        if (p.tracks.includes(id)) return toast(`Already in ${p.name}`);
        await api(`/api/playlists/${p.id}`, { method: "PATCH", body: { tracks: [...p.tracks, id] } });
        toast(`Added to ${p.name}`);
      } else if (b.dataset.a === "play") playTrack(id);
      else if (b.dataset.a === "newpl") newPlaylistDialog([id]);
      else if (b.dataset.a === "edit") editDialog(t);
      else if (b.dataset.a === "src") window.open(t.url, "_blank");
      else if (b.dataset.a === "trash") {
        if (!confirm(`Remove “${t.title}” from your library and the player?`)) return;
        await api(`/api/tracks/${id}`, { method: "DELETE" });
        toast("Removed");
      }
      poll();
    });
  });
}

function dialog(html, wire) {
  const d = $("#dialog");
  d.innerHTML = html;
  wire(d);
  d.showModal();
  const first = $("input", d);
  if (first) first.focus();
}

function editDialog(t) {
  dialog(`<h3>Edit details</h3>
    <label>Title</label><input class="field" id="e-title" value="${esc(t.title)}">
    <label>Artist</label><input class="field" id="e-artist" value="${esc(t.artist)}">
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`, (d) => {
    $("[data-x]", d).onclick = () => d.close();
    $("[data-ok]", d).onclick = attempt(async () => {
      await api(`/api/tracks/${t.id}`, { method: "PATCH", body: { title: $("#e-title").value, artist: $("#e-artist").value } });
      d.close();
      poll();
    });
  });
}

function newPlaylistDialog(tracks = []) {
  dialog(`<h3>New playlist</h3>
    <label>Name</label><input class="field" id="pl-name" placeholder="Late nights">
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Create</button></div>`, (d) => {
    $("[data-x]", d).onclick = () => d.close();
    const ok = attempt(async () => {
      const p = await post("/api/playlists", { name: $("#pl-name").value || "Untitled", tracks });
      d.close();
      location.hash = `#/playlists/${p.id}`;
      poll();
    });
    $("[data-ok]", d).onclick = ok;
    $("#pl-name").onkeydown = (e) => e.key === "Enter" && ok();
  });
}

function pickSongsDialog(p) {
  const options = S.tracks.filter((t) => !p.tracks.includes(t.id));
  const rows = options.map((t) => `
    <label class="pick" style="margin:0;color:var(--ink)"><input type="checkbox" value="${t.id}">
      <div class="cover" style="width:32px;height:32px;${t.cover ? `background-image:url('/api/cover/${t.id}')` : ""}"></div>
      <span class="nm">${esc(t.title)} <span class="muted">· ${esc(t.artist)}</span></span></label>`).join("");
  dialog(`<h3>Add songs</h3><div class="picklist">${rows || '<div class="empty" style="padding:30px">Everything is already here.</div>'}</div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Add</button></div>`, (d) => {
    $("[data-x]", d).onclick = () => d.close();
    $("[data-ok]", d).onclick = attempt(async () => {
      const add = $$("input:checked", d).map((c) => c.value);
      await api(`/api/playlists/${p.id}`, { method: "PATCH", body: { tracks: [...p.tracks, ...add] } });
      d.close();
      poll();
    });
  });
}

// ---------- library page ----------
function renderLibrary(view) {
  const total = S.tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const q = ui.filter.toLowerCase();
  const list = S.tracks.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q));
  const jobs = S.jobs;
  const prev = $("#import-url");
  const draft = prev ? prev.value : "";
  view.innerHTML = `<div class="page">
    <div class="head"><div><div class="eyebrow">Your music</div><h2>Library</h2>
      <div class="sub mono">${S.tracks.length} song${S.tracks.length === 1 ? "" : "s"}${total ? " · " + fmtLong(total) : ""}</div></div></div>
    <form class="import" id="import-form">${icon("link")}
      <input id="import-url" placeholder="Paste a YouTube or Spotify link…" autocomplete="off" spellcheck="false">
      <button class="btn" type="submit">${icon("plus")}Add</button></form>
    <div class="import-hint"><span><b>Songs, albums & playlists</b> work from both.</span><span>Albums and playlists become a playlist here too.</span></div>
    ${jobs.length ? `<div class="jobs"><header><span class="eyebrow" style="margin:0">Importing</span><button class="btn ghost small" id="clear-jobs">Clear finished</button></header>
      ${jobs.map(jobRow).join("")}</div>` : ""}
    ${S.tracks.length ? `<div class="list-tools"><span class="eyebrow" style="margin:0">All songs</span>
      <label class="search">${icon("search")}<input id="filter" placeholder="Filter" value="${esc(ui.filter)}"></label></div>
      <div class="tracks">${list.map((t, i) => trackRow(t, i)).join("")}</div>` :
      `<div class="empty"><h3>A blank page.</h3>Paste a link above, your first song will be on the player in about a minute.</div>`}
  </div>`;
  $("#import-url").value = draft;
  $("#import-form").onsubmit = attempt(async (e) => {
    e.preventDefault();
    const url = $("#import-url").value.trim();
    if (!url) return;
    await post("/api/import", { url });
    $("#import-url").value = "";
    toast("Looking up that link…");
    poll();
  });
  const cj = $("#clear-jobs");
  if (cj) cj.onclick = attempt(async () => { await post("/api/jobs/clear"); poll(); });
  const f = $("#filter");
  if (f) f.oninput = (e) => { ui.filter = e.target.value; renderPage(); };
  wireRows(view);
}

function jobRow(j) {
  const labels = { resolving: "Reading link", queued: "Waiting", matching: "Finding audio", downloading: "Downloading",
    converting: "Converting", artwork: "Artwork", done: "Added", error: "Failed", skipped: "Already added" };
  const pct = j.state === "downloading" ? ` ${Math.round(j.progress * 100)}%` : "";
  const cls = j.state === "error" ? "err" : j.state === "done" ? "done" : "";
  const busy = !["done", "error", "skipped"].includes(j.state);
  return `<div class="job"><div class="t">${esc(j.title)}${j.artist ? ` <span class="muted">· ${esc(j.artist)}</span>` : ""}</div>
    <div class="s mono ${cls}">${busy ? '<span class="dot busy" style="display:inline-block;margin-right:8px"></span>' : ""}${labels[j.state] || j.state}${pct}</div>
    ${j.error && j.state === "error" ? `<div class="e">${esc(j.error)}</div>` : ""}
    ${busy ? `<div class="bar" style="width:${Math.round((j.progress || 0) * 100)}%"></div>` : ""}</div>`;
}
// ---------- playlists ----------
function mosaic(p) {
  const covers = p.tracks.map(byId).filter((t) => t && t.cover).slice(0, 4);
  if (!covers.length) return `<div class="mosaic one"><div class="blank">${esc((p.name[0] || "·").toUpperCase())}</div></div>`;
  if (covers.length < 4) return `<div class="mosaic one"><div style="background-image:url('/api/cover/${covers[0].id}')"></div></div>`;
  return `<div class="mosaic">${covers.map((t) => `<div style="background-image:url('/api/cover/${t.id}')"></div>`).join("")}</div>`;
}

function renderPlaylists(view) {
  view.innerHTML = `<div class="page">
    <div class="head"><div><div class="eyebrow">Collections</div><h2>Playlists</h2>
      <div class="sub mono">${S.playlists.length} playlist${S.playlists.length === 1 ? "" : "s"}</div></div>
      <button class="btn" id="new-pl">${icon("plus")}New playlist</button></div>
    <div class="grid">${S.playlists.map((p) => `<div class="pl-card" data-id="${p.id}">${mosaic(p)}<h4>${esc(p.name)}</h4>
      <div class="mono">${p.tracks.length} song${p.tracks.length === 1 ? "" : "s"}</div></div>`).join("")}
      <div class="pl-card new" id="new-pl-2"><div style="text-align:center">${icon("plus")}<div style="font:italic 24px var(--serif);margin-top:6px">New playlist</div></div></div>
    </div></div>`;
  $("#new-pl").onclick = () => newPlaylistDialog();
  $("#new-pl-2").onclick = () => newPlaylistDialog();
  $$(".pl-card[data-id]", view).forEach((c) => (c.onclick = () => (location.hash = `#/playlists/${c.dataset.id}`)));
}

function renderPlaylist(view, pid) {
  const p = S.playlists.find((x) => x.id === pid);
  if (!p) {
    view.innerHTML = `<div class="page"><button class="back" id="back">${icon("back")}Playlists</button><div class="empty"><h3>Not found.</h3></div></div>`;
    $("#back").onclick = () => (location.hash = "#/playlists");
    return;
  }
  if (document.activeElement && document.activeElement.id === "pl-title") return;  // keep an edit in progress
  const tracks = p.tracks.map(byId).filter(Boolean);
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  view.innerHTML = `<div class="page">
    <button class="back" id="back">${icon("back")}Playlists</button>
    <div class="head"><div style="min-width:0"><div class="eyebrow">Playlist</div>
      <h2 class="pl-title" id="pl-title" contenteditable="true" spellcheck="false">${esc(p.name)}</h2>
      <div class="sub mono">${tracks.length} song${tracks.length === 1 ? "" : "s"}${total ? " · " + fmtLong(total) : ""}</div></div>
      <div class="actions"><button class="btn" id="pl-play" ${tracks.length ? "" : "disabled"}>${icon("play")}Play</button>
      <button class="btn ghost" id="pl-shuffle" ${tracks.length ? "" : "disabled"}>${icon("shuffle")}Shuffle</button>
      <button class="icon-btn" id="pl-more" title="More">${icon("dots")}</button></div></div>
    <div class="list-tools"><span class="eyebrow" style="margin:0">Drag to reorder</span><button class="btn ghost small" id="pl-add">${icon("plus")}Add songs</button></div>
    <div class="tracks" id="pl-tracks">${tracks.map((t, i) => trackRow(t, i, { draggable: true, removable: true })).join("") ||
      '<div class="empty"><h3>Empty for now.</h3>Add songs from your library, or paste a playlist link on the Library page.</div>'}</div></div>`;
  $("#back").onclick = () => (location.hash = "#/playlists");
  $("#pl-play").onclick = attempt(async () => { await post("/api/control/mode", { shuffle: false }); playTrack(tracks[0].id, pid); });
  $("#pl-shuffle").onclick = attempt(async () => {
    await post("/api/control/mode", { shuffle: true });
    playTrack(tracks[Math.floor(Math.random() * tracks.length)].id, pid);
  });
  $("#pl-add").onclick = () => pickSongsDialog(p);
  const title = $("#pl-title");
  title.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } };
  title.onblur = attempt(async () => {
    const name = title.textContent.trim();
    if (name && name !== p.name) { await api(`/api/playlists/${pid}`, { method: "PATCH", body: { name } }); poll(); }
  });
  $("#pl-more").onclick = (e) => {
    e.stopPropagation();
    openMenu(e.currentTarget, `<button data-a="trash" class="danger">${icon("trash")}Delete playlist</button>`, (m) => {
      m.onclick = attempt(async () => {
        closeMenu();
        if (!confirm(`Delete the playlist “${p.name}”? The songs stay in your library.`)) return;
        await api(`/api/playlists/${pid}`, { method: "DELETE" });
        location.hash = "#/playlists";
        poll();
      });
    });
  };
  wireRows(view, {
    playlistId: pid,
    onTakeOut: attempt(async (id) => {
      await api(`/api/playlists/${pid}`, { method: "PATCH", body: { tracks: p.tracks.filter((t) => t !== id) } });
      poll();
    }),
  });
  let dragId = null;
  $$("#pl-tracks .track").forEach((row) => {
    row.ondragstart = () => { dragId = row.dataset.id; row.classList.add("dragging"); };
    row.ondragend = () => row.classList.toggle("dragging", false);
    row.ondragover = (e) => { e.preventDefault(); $$(".drop-before").forEach((r) => r.classList.toggle("drop-before", false)); row.classList.add("drop-before"); };
    row.ondragleave = () => row.classList.toggle("drop-before", false);
    row.ondrop = attempt(async (e) => {
      e.preventDefault();
      row.classList.toggle("drop-before", false);
      if (!dragId || dragId === row.dataset.id) return;
      const order = p.tracks.filter((t) => t !== dragId);
      order.splice(order.indexOf(row.dataset.id), 0, dragId);
      await api(`/api/playlists/${pid}`, { method: "PATCH", body: { tracks: order } });
      poll();
    });
  });
}

// ---------- player / device page ----------
function signal(rssi) {
  const n = rssi > -55 ? 4 : rssi > -67 ? 3 : rssi > -78 ? 2 : 1;
  return `<span class="signal">${[4, 7, 10, 13].map((h, i) => `<i class="${i < n ? "on" : ""}" style="height:${h}px"></i>`).join("")}</span>`;
}

function renderDevice(view) {
  const d = S.device, st = status(), bt = st.bt || {}, w = st.wifi || {};
  if (!d.connected) {
    view.innerHTML = `<div class="page"><div class="head"><div><div class="eyebrow">Hardware</div><h2>Player</h2></div></div>
      <div class="card wide"><h3>${icon("usb")} Not connected</h3><p class="lead">Plug your JJMP3 into this computer with its USB cable. It's picked up automatically, no setup needed.</p>
      <p class="note">Once it's on Wi-Fi it also connects wirelessly, as long as it's on the same network as this computer.</p></div></div>`;
    return;
  }
  const btList = ui.btDevices.map((x) => `<div class="pick">${icon("bt")}<span class="nm">${esc(x.name)}</span>${signal(x.rssi)}
    <button class="btn small" data-bt="${esc(x.name)}">Connect</button></div>`).join("");
  const nets = (ui.wifiNets || []).map((n) => `<div class="pick">${icon("wifi")}<span class="nm">${esc(n.ssid)}</span>${n.lock ? icon("lock") : ""}${signal(n.rssi)}
    <button class="btn ghost small" data-net="${esc(n.ssid)}" data-lock="${n.lock ? 1 : 0}">Join</button></div>`).join("");
  view.innerHTML = `<div class="page">
    <div class="head"><div><div class="eyebrow">Hardware</div><h2>Player</h2>
      <div class="sub mono">JJMP3 firmware ${esc(d.info?.fw || "?")} · connected by ${d.via === "usb" ? "USB" : "Wi-Fi"}</div></div></div>
    <div class="card wide" style="margin-bottom:26px;display:flex;align-items:center;justify-content:space-between;gap:20px">
      <div><div class="eyebrow" style="margin-bottom:6px">Mode</div>
        <h3 style="margin:0">${st.mode === "wifi" ? `${icon("wifi")} Wi-Fi mode` : `${icon("music")} Music mode`}</h3>
        <p class="lead" style="margin:6px 0 0">${st.mode === "wifi"
          ? "Adding music and control work without a cable. Bluetooth audio is off."
          : "Bluetooth audio is on. Wi-Fi is off, because this chip has room for only one of the two."}</p></div>
      <button class="btn ${st.mode === "wifi" ? "" : "ghost"}" id="mode-switch" ${st.mode !== "wifi" && !w.ssid ? "disabled title='Set up a Wi-Fi network first'" : ""}>
        ${st.mode === "wifi" ? "Back to music mode" : "Switch to Wi-Fi mode"}</button>
    </div>
    <div class="cards">
      <div class="card"><h3>${icon("bt")} Headphones</h3>
        <p class="lead">${bt.state === "connected" ? `Playing through <b>${esc(bt.name)}</b>.` : bt.name ? `Looking for <b>${esc(bt.name)}</b>. Turn it on and it connects by itself.` : "The player sends its sound to Bluetooth headphones or a speaker."}${st.mode === "wifi" ? " Bluetooth is off in Wi-Fi mode." : ""}</p>
        <div class="actions">
          <button class="btn" id="bt-scan" ${st.mode === "wifi" ? "disabled" : ""}>${ui.btScanning ? '<span class="dot busy"></span>Searching…' : (bt.name ? "Use other headphones" : "Find headphones")}</button>
          ${bt.name ? '<button class="btn ghost danger" id="bt-forget">Forget</button>' : ""}
        </div>
        ${ui.btScanning ? `<div class="picklist">${btList || '<div class="note" style="padding:6px 4px">Put your headphones in pairing mode…</div>'}</div>` : ""}
        <p class="note">Connecting to a new pair restarts the player (a few seconds).</p></div>
      <div class="card"><h3>${icon("wifi")} Wi-Fi</h3>
        <p class="lead">${w.state === "connected" ? `On <b>${esc(w.ssid)}</b> · <span class="mono">${esc(w.ip)}</span>`
          : w.state === "connecting" ? `Trying to join <b>${esc(w.ssid)}</b>…`
          : w.ssid ? `Saved network: <b>${esc(w.ssid)}</b>. Used in Wi-Fi mode.`
          : "Join Wi-Fi to add music and control the player without a cable."}</p>
        <div class="actions">${st.mode === "wifi"
          ? `<button class="btn ${w.state === "connected" ? "ghost" : ""}" id="wifi-scan">${ui.wifiNets === undefined ? '<span class="dot busy"></span>Scanning…' : "Choose network"}</button>`
          : `<button class="btn ${w.ssid ? "ghost" : ""}" id="wifi-manual">${w.ssid ? "Change network" : "Set up Wi-Fi"}</button>`}
          ${w.state && w.state !== "off" ? '<button class="btn ghost danger" id="wifi-forget">Forget</button>' : ""}</div>
        ${ui.wifiNets ? `<div class="picklist">${nets || '<div class="note" style="padding:6px 4px">No networks found.</div>'}</div>` : ""}
        <p class="note">2.4 GHz networks only.</p></div>
      <div class="card wide"><h3>${icon("music")} About this player</h3>
        <dl class="kv">
          <dt>Songs on card</dt><dd>${st.tracks ?? "?"}</dd>
          <dt>Storage</dt><dd>${ui.sd ? `${(ui.sd.used / 1e9).toFixed(2)} GB of ${(ui.sd.total / 1e9).toFixed(1)} GB used` : `<button class="btn ghost small" id="sd-check">Check</button>`}</dd>
          <dt>Free memory</dt><dd class="mono">${st.heap ? Math.round(st.heap / 1024) + " KB" : "?"}</dd>
          <dt>Connection</dt><dd>${d.via === "usb" ? "USB · " : "Wi-Fi · "}<span class="mono">${esc(d.where)}</span></dd>
          <dt>Button</dt><dd>Click play/pause · double-click next · hold previous · triple-click switch mode</dd>
        </dl>
        <div class="actions"><button class="btn ghost" id="reboot">${icon("power")}Restart player</button></div></div>
    </div></div>`;

  $("#bt-scan").onclick = attempt(async () => {
    ui.btScanning = true;
    ui.btDevices = [];
    await post("/api/bt/scan");
    renderDevice(view);
    btPoll();
  });
  const bf = $("#bt-forget");
  if (bf) bf.onclick = attempt(async () => { if (!confirm("Forget these headphones?")) return; await post("/api/bt/forget"); toast("Restarting the player…"); });
  $$("[data-bt]", view).forEach((b) => (b.onclick = attempt(async () => {
    ui.btScanning = false;
    await post("/api/bt/connect", { name: b.dataset.bt });
    toast(`Connecting to ${b.dataset.bt}, the player restarts…`);
  })));
  $("#mode-switch").onclick = attempt(async () => {
    await post("/api/mode");
    toast(st.mode === "wifi" ? "Switching to music mode…" : "Switching to Wi-Fi mode…");
  });
  const wm = $("#wifi-manual");
  if (wm) wm.onclick = () => wifiDialog(w.ssid || "", true, true);
  const ws = $("#wifi-scan");
  if (ws) ws.onclick = attempt(async () => {
    ui.wifiNets = undefined;
    renderDevice(view);
    try { ui.wifiNets = (await post("/api/wifi/scan")).networks || []; } catch (e) { ui.wifiNets = null; throw e; } finally { renderDevice(view); }
  });
  const wf = $("#wifi-forget");
  if (wf) wf.onclick = attempt(async () => { await post("/api/wifi/forget"); poll(); });
  $$("[data-net]", view).forEach((b) => (b.onclick = () => wifiDialog(b.dataset.net, b.dataset.lock === "1")));
  const sc = $("#sd-check");
  if (sc) sc.onclick = attempt(async () => { sc.textContent = "Checking…"; ui.sd = await api("/api/sd"); renderDevice(view); });
  $("#reboot").onclick = attempt(async () => { await post("/api/reboot"); toast("Restarting the player…"); });
}

async function btPoll() {
  if (!ui.btScanning || route().page !== "device") { ui.btScanning = false; return; }
  try {
    const r = await api("/api/bt/devices");
    if (JSON.stringify(r.devices) !== JSON.stringify(ui.btDevices)) { ui.btDevices = r.devices; renderDevice($("#view")); }
  } catch {
    // keep polling
  }
  setTimeout(btPoll, 1500);
}

function wifiDialog(ssid, locked, manual = false) {
  dialog(`<h3>${manual ? "Wi-Fi network" : `Join “${esc(ssid)}”`}</h3>
    ${manual ? `<label>Network name</label><input class="field" id="w-ssid" value="${esc(ssid)}" autocomplete="off">` : ""}
    ${locked ? `<label>Password</label><input class="field" id="w-pass" type="password" autocomplete="off">` : `<p class="lead">This is an open network.</p>`}
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Join</button></div>`, (d) => {
    $("[data-x]", d).onclick = () => d.close();
    const ok = attempt(async () => {
      const name = manual ? $("#w-ssid").value.trim() : ssid;
      if (!name) return;
      await post("/api/wifi", { ssid: name, password: locked ? $("#w-pass").value : "" });
      d.close();
      ui.wifiNets = null;
      toast(status().mode === "wifi" ? `Joining ${name}…` : `Saved. Switch to Wi-Fi mode to use ${name}.`);
      poll();
    });
    $("[data-ok]", d).onclick = ok;
    const pw = $("#w-pass");
    if (pw) pw.onkeydown = (e) => e.key === "Enter" && ok();
  });
}

// ---------- boot ----------
wirePlayer();
poll();
oledLoop();
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, [contenteditable], dialog")) return;
  if (e.code === "Space") { e.preventDefault(); control("toggle"); }
  if (e.key === "ArrowRight" && e.shiftKey) control("next");
  if (e.key === "ArrowLeft" && e.shiftKey) control("prev");
});