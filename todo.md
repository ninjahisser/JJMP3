# Todo

Legend: ✅ checked by you and it works · 🔍 done, waiting for your review · ⬜ not done yet (reason in italics)

we moeten hebben: music player mode (normaal), spotify mode (spotify sync), en speaker mode (werkt als externe speaker met pc bv verbonden).

Als we dit inpluggen in de pc, moet het als drive verschijnen zodat we aan de sd kaart kunnen en daar een software installer hebben ook voor de main software voor pc frontend.

zorg dat er veel meer themas zijn, maar steek ze achter een menu 

🔍 First of all, I made opencode make changes but I like none of these, so fix them. *Fixed what was broken: the playlist pages crashed, the Games tab was a placeholder. Tell me which other changes you want undone.*

🔍 Rebrand it to the Z0Ɛ instead of JJSMP3. *App title, window and OLED splash use Z0Ɛ (the OLED font has no Ɛ, so it is drawn as a mirrored E). Folder, repo and installer are still called JJMP3.*

🔍 show the time of the world. *Home > World time: 11 cities, with summer time. Needs the app to have set the clock once.*

🔍 show battery percentage when playing on bluetooth. *Bottom right of Now Playing, when a battery is wired.*


⬜ I can't add some CHIP-8 games because it says limit is 3.5kb. but they are saved on the SD card so fix this. *CHIP-8 has 3.5 KB of program memory by design; bigger games are SCHIP/XO-CHIP and need more RAM than the ESP32 has left with Bluetooth on.* and the dinorun game on the device plays a bit strange. *Needs the SD card and the game file to look at.*

🔍 add some audiovisualisation. *Home > Visualiser: loudness bars of what is playing.*

🔍 Add a sidescrolling game where you have to save Seth from Steffe by fighting Steffe's goons in Kinepolis as Zoé. Steffe constantly makes little animated text like "*snort*" "*fart*" "*burp*", Seth is kidnapped by him because steffe wants to "m-preg him". but Zoé must defeat him to save her lover Seth. *Games > Save Seth.*

⬜ Add audio even if its simple to all the games and UI. *Needs the speaker amplifier (ordered?) and the I2S audio code.*

🔍 Allow searching for songs when adding them. *Type a name in Add songs.*

🔍 Games should be on the pc frontend app its own tab like library, player, playlists.

🔍 Spotify mode: the app shows what Spotify is playing (artwork, title, progress), controls it, and mirrors it on the player's screen, with the player's buttons controlling Spotify. *Replaces the Spotify login idea. Works with the Spotify desktop app through Windows media controls.*

🔍 add theme support to the frontend, by default now its like this mokka-brown but it should be a nice calm green. *Settings > Theme: 6 light and 7 dark themes (Sage is the default, Paper is the old brown).*

🔍 the icon for the app should be a heart.

⬜ on the device I should be able to add music to playlists and rename playlists etc like pc. *Not started.*

🔍 When clicking anywhere on the frontend that isn't a clickable thing so clicking on the background, the logo (pixelated heart) should appear. with some nice spritework and particles. simple clean.

⬜ music playing should sync with the device, so playing a song, timeline etc is always the same and controls control both on both devices. *The app shows the player's state and the output switch hands over; full two-way sync is not done.*

🔍 make it so you can check for updates on the frontend and it can update the device too. *Player page > "Update firmware" updates the player over Wi-Fi, no cable (needs Wi-Fi mode, and the firmware files built next to the app). Not done: the app itself checking for a new version, there is no release channel for it yet.*

🔍 the exe in bin should be renamed to the new zoé themed branding. *Now bin\Z0E.exe (the file name is plain ASCII, the window and installer shortcut say Z0Ɛ). Re-pin it to the taskbar.*

🔍 there is bloat: now next to the title in the frontend it says "pocket player, that is bloat remove that", "Bluetooth audio is on. Wi-Fi is off, because this chip has room for only one of the two." is bloat, "Pibble Catch and Snake are built in. Add CHIP-8 games (.ch8 files) and they show up under games on the player." is bloat, it should say it can play CHIP-8 games tho., Play: Games on the player. ‹ › and P are the game's keys 4, 6 and 5, – + are 8 and 2. Hold P to quit. is also bloat. in add music "Songs, albums and playlists work. You'll see what's in it before anything downloads." is bloat.

🔍 when adding music after entering a link it loads, but show a progress bar.

🔍 when adding music and it shows a playlist, make it so I can select individual songs to add like a checkbox.

🔍 I will make an extended dock that has a speaker and two pins using jumper cables to connect the speaker to the device, so add pins for that basically 2 pins to use the speaker. *Pins D26 (BCLK), D25 (LRC) and D27 (DIN) go to an I2S amplifier, in the wiring PDF. The amplifier code is not written yet.*

🔍 when I hover over teh app in the taskbar it should havce those controls like spotify does.

🔍 add karaoke mode in a tab. *Karaoke tab with synced lyrics, a saved timing offset per song, and a live search ("Wrong or missing lyrics? Search") to pick the right lyrics when the title doesn't match.* the device should also show the lyrics of the song. *Not done: needs the SD card.*
