# Mobile Simulator

Free Chrome extension to preview websites in realistic phone and tablet frames. See [SPEC.md](SPEC.md) for the full feature list.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin the extension (puzzle icon → pin) so its icon stays in the toolbar.

After editing the code, click the reload arrow on the extension's card in `chrome://extensions`, then reopen the simulator tab.

## Use

- Click the icon on any site (or press `Alt+Shift+M`) to open it in a phone.
- Right-click a page or a link → **Open in Mobile Simulator**.
- Shortcuts: `R` rotate, `C` compare, `D` devices, `S` screenshot, `V` record, `Esc` close menus.

## Files

- `manifest.json` – extension configuration
- `background.js` – toolbar icon, right-click menu, cleanup when the tab closes
- `simulator.html` / `.css` / `.js` – the simulator page
- `frame.js` – runs inside the previewed site: touch scrolling, page info for the status bar and island
- `lib/devices.js` – device list and frame geometry
- `lib/rules.js` – per-tab header rules (lets sites load in the frame, sets the mobile user agent)
- `lib/export.js` – screenshot/video look: background, padding, shadow, ratio, caption; image formats
- `lib/recorder.js` – video recording to a standard MP4 (WebCodecs + mp4-muxer)
- `vendor/mp4-muxer.mjs` – [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.2, MIT
