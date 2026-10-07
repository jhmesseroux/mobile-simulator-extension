# Mobile Simulator – Spec

A free Chrome extension (Manifest V3) to preview any website inside realistic phone and tablet frames, to test responsive design.
Inspired by "Simulateur téléphone mobile - test site responsive", without the paid features locked.

Status: **v1–v7 built.**

## v1.0 cleanup (2026-10-07, quality check)
- Security: the simulator page only applies its site rules in full screen when it runs in that very tab and the extension opened full screen there (any website could embed the page and pass a tab number before).
- Performance: scroll sync no longer sets up listeners/observers on every website you visit (only once a side panel starts syncing); cheaper section matching; no 400 ms polling in phone pages; the background stops waking up for tabs without rules; settings saves are batched; screenshot sliders only redraw the preview; recording measures device positions once; lighter blur effects (fewer backdrop layers, gradients instead of blurred blobs).
- Robustness: side panel rules are cleaned up even after the extension idles; the recorder always releases the encoder and frames on errors; startup and settings failures are reported; a double Start can't open two recordings; scroll sync replies so it doesn't switch itself off.
- Code: dead code removed (old capture styles, compare chip, zoom cycling, unused messages), duplicated helpers merged, stylesheet rewritten in clean sections.

## v7.10 (2026-10-07)
- Side panel Settings: **Address bar**, **Device label**, **Label position** and **Toolbar position** are greyed out with "Full screen and new tab only" (they have no effect in the side panel).

## v7.9 (2026-10-07)
- Frame menu: the selected finish's name sits **in the header**, centred between "Frame" and ×.
- Status bar off also hides the **Dynamic Island / notch / camera hole**.
- Screenshots **start from the screen's settings**: the frame option follows the live phone (no frame on screen → no frame in the screenshot); status bar and home indicator are captured as shown. The frame can still be changed in the dialog.

## v7.8 (2026-10-07)
- Toolbar zoom button: **hover or click opens a zoom menu** (Fit with its current %, 200%, 150%, 125%, 100%, 90%, 75%, 67%, 50%, 33%, 25%; current one ticked); **double-click → Fit**. The +/Fit/− control stays as it is.
- Frame menu: the selected finish's **name sits on top, centred**.

## v7.7 (2026-10-07)
- Zoom control buttons are perfect circles (40×40).
- Smoother zoom (0.55 s ease-out) and rotation (0.8 s soft spring).
- The recording pill (● timer · Stop) moved to the **top-left corner**: at the top centre it sat over the phone and appeared in the video.
- Record menu: the look option is back, as two cards: **Phone only** (default: just the device, cropped tight, no added background) and **Screenshot style** (background, padding, shadow, caption from the screenshot dialog, with an "Edit style" link).
- Menus hide their scrollbar; a soft fade at the bottom shows there is more to scroll.

## v7.6 (2026-10-07)
- Toolbar, zoom control and their buttons are **fully rounded** (pill containers, round buttons, round Record button).
- The zoom control sits at the **bottom of the toolbar's column**, 60px from the bottom (clear of the bottom edge blur); a bottom-right device label moves to its left so they don't overlap.

## v7.5 (2026-10-07)
- ~~Double-click the extension icon → full screen~~ — removed (Chrome doesn't reliably report a quick second click on a toolbar icon). Full screen directly: right-click the icon → "Open full screen", or Alt+Shift+F.

## v7.4 (2026-10-07)
- Record menu: the "Style: uses your screenshot look" row is removed. **Videos show the devices as they are on screen** (current frame, or no frame), on the stage colour with a small margin; no gradient, padding, shadow or caption from the screenshot dialog.
- **Smooth rotation**: the device turns a quarter-turn into its new orientation (with a slight spring) instead of snapping.
- **Smooth zoom**: +/− glide to the new size.

## v7.3 (2026-10-07, during the QA walkthrough)
- Removed the thin light line between the status bar and the page (the page area had a white background that blended into a seam at zoomed-out sizes).
- Slim, see-through scrollbars everywhere in the simulator (menus, dialogs, stage) instead of the grey system track.
- **Zoom control, map style**: vertical **+ / Fit / −**, in the toolbar's column right under it (a row next to it when the toolbar is at the top or bottom). Steps 25%–200% from the current zoom with a smooth zoom animation; clicking the value goes back to Fit. Keys: + / − / 0.

## v7.2 (2026-10-07)
- Turning compare mode on switches zoom to **Fit**; Fit always shows every device whole (labels included), however many or large they are.
- Compare: opening a page in one device opens it in **all devices** (their own redirects, e.g. to a mobile site, are not sent back).
- Menus never go past the window: their height comes from where they open, capped at 640px; they scroll inside.
- Chrome's refresh button: the full-screen simulator comes back **as soon as the new page starts** (not after it has loaded), so a refresh looks like the website reloading under the simulator. (Chrome doesn't let an extension intercept its refresh button; Cmd+R / F5 inside full screen reload only the page in the phone.)
- Removed the "N devices · synced URL / Edit" chip.

## v7.1 (2026-10-07)
- Device label in a corner sits higher (60px), clear of the bottom edge blur; new **bottom centre** position.
- Menus (devices, frame, settings, record, scroll sync): always fit the free space next to the toolbar and **scroll inside**; their **header stays pinned** while scrolling, with a progressive blur under it and a **close button**. Fixes the side panel where the device menu was pushed down and couldn't scroll.
- Toolbar tooltips show **above** open menus (they were hidden behind them in the side panel).
- Full screen: a **Side panel** button in the toolbar opens the side panel and leaves full screen.

## v7 (built)

### Device name & size label
- Single device: the label (e.g. "iPhone 17 Pro Max · 440 × 956") moves to the **bottom-right corner** of the window (fixed position), instead of under the phone.
- Compare mode: labels stay under each device, a bit **smaller**.
- Compare mode: each device's label gets a small **× button to remove that device** in one click (appears on hover; disabled when only 2 devices are left, the minimum). Adding devices stays in the device picker.
- Settings: **Device label** on/off, and **position**: Bottom right (default) · Bottom left · Top left · Under the device. (Compare mode always uses "under the device" so each label stays with its device.)

### Refresh only the website in the phone (full screen)
- **Cmd+R / Ctrl+R / F5** inside full screen reloads only the page in the phone: instant, no flicker, the simulator stays.
- A **Reload** button comes back in the dock (full screen and new tab).
- Chrome's own toolbar refresh button still reloads the whole tab (an extension cannot intercept it); the simulator then reopens on the same page.

### Desktop templates (new "Desktop" tab in the device picker)
- **MacBook Pro 14"**: 1512 × 982, silver aluminium laptop with a camera notch in the black bezel and the keyboard base below.
- **Windows laptop 15"**: 1536 × 864, dark laptop with thin bezels, webcam dot and base.
- **Desktop monitor**: 1920 × 1080, iMac-style screen with a chin and a stand.
- The site loads at the real desktop width (desktop user agent), scaled down to fit. Rotation is disabled for desktops. No status bar, island, home indicator or on-screen keyboard on desktops.
- Frame colour finishes apply to laptops and the monitor too.

### Toolbar position (added during v7)
- Settings → **Toolbar position**: Right (default) · Left · Top · Bottom, for full screen and the new tab. Tooltips and menus open on the free side. The side panel keeps its bottom bar.

### More frame colours
- New finishes: Red, Crimson, Green, Mint, Pink, Rose Gold, Yellow, Sky Blue, Midnight Green, Lavender (in addition to the current ones and the custom gradient).

### Screen details in Settings
- **Status bar** on/off (time, signal, wifi, battery). Off: the page starts at the top of the screen (the island/notch still shows on phones that have one).
- **Home indicator** on/off (the bar at the bottom).
- Both apply to the live phone, screenshots and recordings.

## 0000000. v6.3 (2026-10-07)
- Fixed: in full screen, reloading the phone or changing page in it made the simulator flicker, reset its URL and settle after 5–6 s (pages loading inside the phone were mistaken for the website reloading). Now only the website's own reloads count.
- Refreshing the website in full screen brings the simulator back **on the page the phone was showing**; going to another website in that tab ends full screen.
- Our address bar (back, forward, reload, URL) is **hidden by default**: use Chrome's buttons. Settings → "Address bar" shows it again. It always shows on the start screen (no page yet).
- Full screen: a **close button (×) in the top-right corner**, always visible; Esc still works; the Exit pill stays in the address bar when it is shown.

## 000000. v6.2 (2026-10-07)
- Screenshot dialog: changing the frame colour or turning the frame on/off is **instant** (no closing/reopening). The screenshot captures only the screen; the device frame is drawn into the image in the chosen finish.
- Screenshot dialog: the **Sharpness** option is removed (always captured as shown on screen).
- Full screen **survives a page refresh**: the simulator comes back after the page reloads, until you exit. (After a reload Chrome withdraws the click permission, so recording may ask once; press Alt+Shift+F or use the icon menu again to avoid it.)
- A clear **Exit** button (gradient pill, top bar) returns to the page; Esc still works. A short hint appears when full screen opens.

## 00000. v6.1 (2026-10-07)
- Scroll sync: **Same percentage is the default method** (applied once to existing installs); "Follow the section" stays available in the sync menu.
- Opening full screen from the side panel **closes the side panel**.
- **Open full screen directly**, without the side panel: right-click the extension icon → "Open full screen", or press **Alt+Shift+F** (changeable in chrome://extensions/shortcuts). Both give the click permission, so recording works without Chrome's prompt. Pages that can't host it (chrome://…) open the new-tab simulator instead.

## 0000. v6: phone keyboard (built)

### Done already (v5.1, 2026-10-07)
- **Smoother scroll sync**: the follower is placed between the two nearest sections that exist on both pages, so it moves continuously, even when a section is much longer on mobile. Sticky/fixed elements are ignored as landmarks; the side you are scrolling never gets pulled by the other one.
- **Scroll sync options**: the sync button in the side panel opens a menu: on/off, method (Follow the section / Same percentage), direction (Both ways / Website → phone). Remembered.
- **Instant screenshot**: the phone is captured exactly where it is, with no zoom or movement. "Resolution 1x/2x/3x" becomes **Sharpness: Screen** (default, as shown) **/ Max** (the phone is shown at 100% for one frame when it fits on screen). Picking a frame finish in the dialog turns the live frame on if it was off.

### Keyboard on focus
- When you tap (click) a text field in the phone, a **keyboard slides up** from the bottom of the screen, like on the real device; it slides down when the field loses focus, on Done/return, or when you click outside the field.
- **Per device**: iOS-style keyboard on iPhones, Gboard-style on Android phones, the larger iPad keyboard on iPads. Real proportions, so you see the real space left.
- **Realistic page reaction**: the visible page area shrinks to the space above the keyboard and the focused field is scrolled into view, so sticky footers, bottom buttons and chat inputs behave as on a phone.
- **Typing**: type with your computer keyboard as usual (the on-screen keys light up as you type), or click the on-screen keys (letters, shift, numbers/symbols, space, delete, return).
- **Adapts to the field**, like a real phone:
  - email → keyboard with @ and .
  - number, phone (tel), one-time code, inputmode numeric/decimal → number pad
  - URL → / and .com
  - search → blue "Search" key
  - enterkeyhint is honoured (Go, Send, Next, Done, Search)
  - password → normal layout
- Works in the side panel, the full-screen simulator and the new tab; visible in screenshots and recordings.
- A setting "Keyboard on focus" (on by default) in Settings.

### Out of scope for v6
- Autocorrect suggestions bar, emoji keyboard, dictation, other languages' layouts (AZERTY etc.).

## 000. v5: scroll sync + leaner side panel (built)

### Done already (v4.1)
- Side panel: no address bar (the panel follows the website's tab).
- Side panel: Screenshot and Record buttons removed (they live in the full-screen simulator). The panel keeps: device, frame colour, rotate, zoom, scroll sync, left/right, **Full screen** (re-added 2026-10-07: opens the full-screen simulator over the tab), settings.
- Side panel: no edge blur at the bottom (it made the phone's bottom corners look grey).

### Scroll sync between the website and the side panel
- **On by default**, both ways:
  - scroll the website → the phone in the panel follows;
  - scroll the phone → the website follows.
- **Follows the section, not the pixel**: the phone scrolls to the same heading or section you are looking at on the website (you reach "Pricing" on the website → the phone shows "Pricing"), because the mobile layout is usually much taller. Sections are matched by their id, then by heading text. When nothing can be matched, it falls back to the same scroll percentage.
- Smooth: the side being followed glides to its position. No back-and-forth loop: a scroll caused by sync never triggers a sync back.
- A **sync button** (two arrows) in the panel's bottom bar turns it off/on; the choice is remembered. It shows as active (violet/pink) when on.
- Works on the active tab; switching tabs follows the new tab.
- Scroll containers: the main page scroll is synced. Pages that scroll inside their own box (some apps) are synced when that box is the page's main scroller.

### Out of scope for v5
- Syncing clicks, typing or hover between the website and the phone.

## 00. v4: side panel + recording without prompt (built)

### Fixed already (v3.1, 2026-10-07)
- Screenshot dialog now appears smoothly from the centre (fade + gentle scale). It no longer slides in from the top-left: the preview image had a size animation that made it grow from its default size.
- The dialog's Cancel / Copy / Save bar is opaque: the options scrolling underneath no longer show through.

### Why Chrome still asks "Autoriser … à voir cet onglet ?"
Chrome only lets an extension record a tab without asking when the user clicked the extension's icon **on that same tab**. Today the simulator opens in a new tab that was never "clicked", so Chrome falls back to its prompt. The other extension avoids it by drawing its phone over the website in the same tab. v4 does the same.

### New way of opening
- **Clicking the icon opens the side panel** (Chrome's real side panel, like Claude's): the website stays in your tab, the phone preview appears in a panel next to it.
- **Right side by default.** A "Move to left/right" button in the panel opens Chrome's own setting (Appearance › Side panel position) so you can flip it in one click. This setting is Chrome-wide and applies to all side panels (Chrome does not let an extension change it itself).
- The panel is resizable (Chrome lets you drag its edge) and stays open while you browse.

### Side panel content: "Preview + quick tools"
- The phone shows the **same page as your tab, and follows it**: when you navigate in the tab or switch tabs, the phone loads the new page.
- Quick tools in a compact glass bar: device picker, rotate, frame colour, zoom (Fit / 100% / 75% / 50%), reload.
- **Screenshot** and **Record** buttons in the panel open the **full-screen simulator over the same tab** and start the action there.
- A **Full screen** button opens the full-screen simulator over the tab without starting anything.

### Full-screen simulator (over the same tab)
- The v3 "Floating glass" simulator appears **on top of the current website, in the same tab** (instead of a new tab). An × button (and Esc when nothing else is open) closes it and shows the website again, exactly where you left it.
- **Recording starts without any Chrome prompt** (countdown → recording), because you clicked the icon on that tab.
- Limit: if you navigate the tab to another page after opening the panel, Chrome withdraws that permission. Recording then asks once, or you can click the extension icon again to avoid the prompt.
- Everything else from v3 works the same (devices, compare, frames, screenshot dialog, record menu, review).

### Other ways to open
- Right-click menu: "Open page in Mobile Simulator" (full screen over the tab), "Open link in Mobile Simulator" (new tab, as in v3, Chrome may ask before recording there).
- Keyboard shortcut Alt+Shift+M: opens the side panel.

### Technical notes
- New permissions: side panel, scripting (to show the full-screen simulator over the page).
- Header rules (frame loading, mobile identity) also apply to the side panel's phone; they are removed when the panel and the full-screen simulator are closed.

### Out of scope for v4
- Scroll sync between the tab and the phone.
- Our own in-page panel with an instant left/right switch (Chrome's real side panel chosen instead).

## 0. v3: redesign + recording flow (built)

Design mockups: https://claude.ai/artifact/N81c8gHVfHJXLeEdC5cUT8

### Fixed already (v2.1, 2026-10-07)
- "No frame" option in both frame pickers (toolbar and screenshot dialog).
- Screenshot capture no longer jumps from the top-left corner: the phone zooms smoothly to the centre, is captured, and zooms back; the dialog opens only once the capture is done. Switching back to a resolution already captured is instant.
- The page no longer spills outside the rounded screen while scrolling.

### Look: "Floating glass"
- Full-window immersive stage: near-black background, soft violet and pink glow behind the phone, faint dot grid.
- **Progressive blur** at the top and bottom edges of the stage, so content fades under the controls.
- Frosted-glass panels (blurred, translucent, thin light border) for every bar, menu and dialog.
- Font: Geist (numbers in Geist Mono). Violet → pink gradient kept for the icon, Record and primary buttons.
- Device name and size shown in a small glass pill under the phone.

### Layout
- **Top bar** (floating glass, centred): app icon, Back / Forward / Reload, address bar.
- **Side dock** (floating glass, vertical, right edge): Device, Frame, Rotate, Compare, Zoom, then Screenshot, Record, then Settings. Tooltips with the keyboard shortcut.
- Menus (devices, frame, record, settings) open as glass panels next to the dock.
- **Device picker** becomes a larger glass panel: search field, tabs (iPhone / Android / Tablets / Custom), device cards with a small silhouette and size.

### Screens in the design (9)
1. **Start screen**: no site yet; address bar focused; inside the phone, suggestion chips (localhost:3000, current tab, recent site); tip card for right-click and Alt+Shift+M.
2. **Browsing**: phone centred on the glow, top bar, side dock, shortcut hints at the bottom.
3. **Device picker**: search, tabs, device cards, "Compare" switch, "+ Add a custom size".
4. **Frame colour**: finish dots (No frame, Black, real finishes, custom) and the custom gradient editor (2 colours + angle).
5. **Settings**: Theme, Touch cursor, Device frame, Mobile user agent, 🆕 **Ambient glow** on/off, shortcuts.
6. **Compare**: 3 devices side by side with name pills, a "3 devices · synced URL" chip.
7. **Record menu + countdown + recording pill**.
8. **Screenshot export**: same options as v2 in the glass style.
9. **Recording review**: see below.

### Recording flow
- Clicking Record opens a **record menu** (glass panel): Start button, 3-second countdown on/off (on by default), microphone on/off (off by default), quality Good / High / Max (High by default). It reminds you that the video uses the screenshot style.
- **No Chrome "share this tab" prompt**: the extension records its own tab directly, like the other extension (new permission: tab capture).
- Start → large **3 · 2 · 1** countdown over the stage → recording starts.
- While recording, a small glass pill at the top shows ● timer and Stop; the dock's Record button turns into Stop.
- Microphone: Chrome asks for microphone permission the first time it is switched on; the sound is added to the MP4.

### Review after recording (instead of saving straight away)
- When you stop, a **Review** glass dialog opens with the video playing in a loop (play/pause, scrub bar, duration).
- Shows file details: duration, size in MB, resolution, MP4.
- Actions: **Save MP4** (primary), **Record again** (discards and reopens the record menu), **Discard** (with a short "Discard this video?" confirmation inside the dialog, no browser popup).
- Nothing is downloaded until you click Save. Closing the dialog (×, Esc) asks the same discard confirmation.

### Out of scope for v3
- Webcam bubble in recordings (maybe later).

## 1. Opening

- Clicking the extension icon opens a **new tab** next to the current one, showing the current site inside the default phone.
- Also available: right-click → "Open page in Mobile Simulator" / "Open link in Mobile Simulator".
- Keyboard shortcut: `Alt+Shift+M`.
- On pages that cannot be previewed (`chrome://`, Web Store), the simulator opens empty and you type a URL.

## 2. Simulator screen

Toolbar (top), left to right:
- Back / Forward / Reload
- Address bar (type a URL, press Enter)
- Device picker
- 🆕 Frame colour (small swatch showing the current finish)
- Rotate (portrait / landscape)
- Compare devices
- Zoom: Fit, 100%, 75%, 50%, 33%
- Screenshot (opens the export dialog)
- Record (shows a timer while recording)
- Settings

Below: the device(s), centered, with the device name and size underneath (e.g. `iPhone 17 Pro · 402 × 874`).

## 3. Devices

About 18 devices, grouped:
- **Apple iPhone**: 17 Pro Max, 17 Pro, Air, 17, 16 Plus, 16e, 15, 13 mini, SE
- **Android**: Pixel 10 Pro, Pixel 8, Galaxy S25 Ultra, Galaxy S25, Galaxy A54
- **Tablets**: iPad mini, iPad Air 11", iPad Pro 13", Galaxy Tab S9
- **Custom**: add your own (name, width, height, style: iPhone / Android / tablet), saved, can be deleted

Default device: iPhone 17 Pro. The last used device is remembered.

## 4. 🆕 Device frame (redesign)

The frames must look like real devices (reference: the purple iPhone screenshot shared on 2026-10-07).

- **iPhone**: thin black bezel, thin glossy metal rim with a soft gradient and highlight, rounded corners matching the real phone, realistic side buttons (action, volume up/down, power). Dynamic Island with a visible camera lens on its right.
- **Android**: thin rim, punch-hole camera, single power + volume rocker on the right.
- **Tablets**: even bezel, thin rim.
- **Status bar**: takes the site's colour (like Safari), with light or dark text depending on the colour.
- **Home indicator**: **transparent bottom area**: the site's content goes all the way down under the home bar, and the bar floats on top of it (today there is a solid strip).

### Frame colour

- Default: **Black**: black body with a thin grey metal rim (reference screenshot, 2026-10-07).
- Real finishes: Black Titanium, Natural Titanium, White/Silver, Deep Purple, Desert Titanium, Cosmic Orange, Deep Blue, plus Android Obsidian and Porcelain.
- **Custom gradient border**: pick 2 colours and the angle.
- Chosen from the toolbar swatch button, and also inside the screenshot dialog.
- Remembered between sessions.

## 5. Browsing inside the phone

- The site loads at the real width of the device, so CSS media queries behave like on the phone.
- **Mobile user agent** (on by default, toggle in settings): sites receive an iPhone or Android identity and serve their mobile version.
- **Touch cursor** (on by default, toggle in settings): the cursor is a grey circle, and dragging the page scrolls it like a finger, with momentum. Mouse wheel still works.
- Scrollbars are hidden, like on a phone.
- Links, forms and back/forward work normally.

## 6. Dynamic Island animation (iPhones with an island)

Smooth spring animations, like on a real iPhone:
- **Loading**: the island widens and shows a spinner and the site's icon.
- **Screenshot**: the island does a small bounce, and the screen flashes white.
- **Click on the island**: it expands into a large card with the site's icon, title and domain, then closes after 3 seconds.
- In landscape the island sits on the left side, without animation.
- 🆕 **No recording indicator in the phone.** The island stays normal while recording, so videos look clean. The timer is shown only on the toolbar's Record button. (Replaces the v1 "red dot + timer" state and the red pill on other phones.)

## 7. Rotation

- Switch between portrait and landscape (button or `R`).
- The site is not reloaded; it resizes like a real phone.

## 8. Compare side by side

- Button or `C` turns compare mode on or off.
- Show 2 to 5 devices at once (default: iPhone 17 Pro, Pixel 10 Pro, iPad Air 11"), chosen with checkboxes in the device picker.
- Typing a URL loads it on all devices. Back / Forward / Reload apply to all.
- Limit: all devices share the user agent of the first device.

## 9. 🆕 Screenshot export dialog

Clicking Screenshot (or `S`) captures the phone and opens a dialog, similar to Arc's capture:

- **Large live preview** of the final image. Every change updates it instantly.
- **Format**: PNG, JPEG, WebP at the best quality possible (PNG lossless; JPEG/WebP at maximum quality). AVIF is offered only if Chrome can produce it natively; otherwise it is hidden (no extra encoder is added).
- **Resolution**: 1x, 2x (default), 3x. The phone is re-rendered at that size before capture, so text stays sharp even when the phone looks small on screen. 3x can take 1–2 seconds.
- **Background**:
  - About 10 gradient presets (violet/pink first, then others similar to Arc's)
  - Custom gradient: 2 colours + angle
  - Solid colour
  - None (transparent, phone only; JPEG has no transparency, so it falls back to white)
- **Padding**: slider from 0 to large.
- **Shadow** under the phone: on/off + strength.
- **Image size / ratio**: Auto (fits the phone), 1:1, 9:16 (story), 4:5 (post), 16:9.
- **Caption**: optional text under the phone, **"JHM" by default**, editable, on/off.
- **Frame**: on/off (screen only) and frame colour.
- Buttons: **Save** (downloads the file), **Copy** (copies the image to the clipboard), Cancel.
- All choices are remembered for the next screenshot.
- In compare mode, all devices are placed side by side on the same background.
- File name: `screenshot-<site>-<device>-<date>.<format>`.

## 10. 🆕 Video recording (rebuilt)

**Bug found in v1:** the 18 s test video plays as a frozen first frame. Analysis of the file: the video data is corrupted (decode errors), and the MP4 is saved in a fragmented form that QuickTime/Mac preview can't play properly. Likely cause: when Chrome's "Sharing this tab" bar appears, the page shrinks, the phone is resized, and the video size changes during the recording.

New behaviour:
- One click (or `V`) starts recording; click again (or Chrome's "Stop sharing") to stop.
- Chrome asks once to allow sharing the tab (browser security, cannot be skipped).
- The video keeps **one fixed size** from start to end, even if the page resizes.
- Saved as a **standard MP4** (H.264) that plays in QuickTime, Mac preview, WhatsApp, YouTube. 60 fps when possible.
- **Same look as screenshots**: the background, padding, shadow, ratio, caption and frame colour chosen in the screenshot dialog are drawn into the video.
- **Touch circle**: a grey circle appears where you press, so taps and swipes are visible.
- No recording indicator inside the phone (see section 6).
- File name: `recording-<site>-<device>-<date>.mp4`.

## 11. Settings (remembered)

- Theme: Dark (default) / Light / Auto
- Touch cursor: on / off
- Device frame: on / off (off = screen only, no phone body)
- Mobile user agent: on / off
- Also remembered: last device, orientation, zoom, compare devices, custom devices, 🆕 frame colour, 🆕 all screenshot/video export options
- (The v1 setting "Frame in screenshots" moves into the screenshot dialog.)

## 12. Interface

- Language: **English**.
- Colours: **violet and pink**. Violet (`#7c3aed`) for main buttons, selected items and toggles; pink (`#ec4899`) as the second colour, for highlights and the loading bar. The icon, the record button and the large buttons use a violet → pink gradient.
- Keyboard shortcuts: `R` rotate, `C` compare, `D` devices, `S` screenshot, `V` record, `Esc` close menus and dialogs.

## 13. Out of scope

- GIF export
- Your own image as a screenshot background
- Large catalog (60+ devices), smartwatches, desktop screens
- French interface
- PWA mode, simulated native keyboard
- Firefox version
- Publishing on the Chrome Web Store

## 14. Known limits

- Some sites refuse to run inside another page (e.g. Google sign-in pages, some banking sites) and may not load.
- Being logged in on a site in your normal tab may not carry over inside the simulator for every site.
- Real phone rendering engines differ (Safari on iPhone): this shows the layout, not every Safari-specific bug.
- During a 2x/3x screenshot the phone briefly grows on screen while it is captured.

## 15. Technical choices (short)

- Plain JavaScript, HTML and CSS, no build step: load the folder with "Load unpacked".
- 🆕 One small open-source library is copied into the extension (no internet needed at runtime): an MP4 writer (mp4-muxer, MIT) for a standard, playable MP4.
- 🆕 Video is encoded frame by frame with Chrome's built-in video encoder (WebCodecs) instead of the built-in recorder.
- Permissions: change headers only inside the simulator tab (so sites can load in the frame and receive a mobile identity), tabs, storage, right-click menu, site icons, 🆕 clipboard write (for Copy).
- Nothing is sent anywhere: no account, no server, no tracking.
