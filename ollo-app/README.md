# OllO Companion — first application foundation

This project is a first implementation of the OllO companion application based on the five design screens and the supplied ESP32-S3 firmware.

## Study design (v4 redesign)

- **Sessions, not browsing.** The home screen's main button builds a session from cards that are due plus a few new ones, mixed across folders. Each card is question first, then *Show answer*, then you grade yourself: Again / Hard / Good / Easy. Each button shows when the card will come back.
- **Scheduler** lives in `src/study/scheduler.ts` (SM-2 family with learning steps). Every number is a named constant at the top of the file. Practice runs (Shuffle / Where I left off) never change the schedule.
- **Streaks are low-bar.** Any single graded card keeps the streak; the daily goal ring is separate. One missed day per week is forgiven (the "rest day").
- **Glasses nudge.** The Glasses tab shows a dot when you have edits the glasses haven't received yet. Review schedules are local to the app and are not sent to the glasses.
- **Keyboard (desktop):** Space reveals, 1-4 grades, Z undoes, Esc leaves.
- **Fonts** are bundled with the app through `@fontsource` (Bricolage Grotesque for headings, Atkinson Hyperlegible for text), so they work offline in the Windows and mobile builds. Run `npm install` after applying the patch.

## Platform strategy

The React + TypeScript interface and the OllO data/protocol layer are shared. The native shell differs by platform because standard Chromium Web Bluetooth does not offer reliable saved-device retrieval for hands-free reconnect on Windows.

- **Windows:** Tauri 2 desktop app with the native `tauri-plugin-blec` BLE client. The app is packaged as a normal Windows installer (NSIS and MSI). On launch it scans for the previously selected OllO BLE address and reconnects when the glasses are advertising.
- **Android:** Capacitor native app using `@capacitor-community/bluetooth-le`.
- **iOS:** Capacitor native app using `@capacitor-community/bluetooth-le` and CoreBluetooth permissions.
- **Browser/PWA:** Kept as an optional web preview and basic browser experience. It is not the recommended Windows production app because Web Bluetooth saved-device retrieval is not dependable in standard Chromium.

The Windows desktop path is included in `src-tauri/`. Tauri uses the system WebView2 runtime on Windows; it does not embed a full Chromium browser.

## What is included

- React + TypeScript UI styled around the supplied OllO dark/cream/yellow/green design.
- Home/library, folder, study, card editor, synchronization and settings screens.
- Local-first folder/card/settings storage using IndexedDB.
- Image conversion to formats understood by the supplied firmware:
  - **Black & white:** 1-bit packed monochrome (format `0`).
  - **Grayscale:** 2-bit packed grayscale, four tones (format `2`).
  - **Color:** RGB565 little-endian (format `1`), downscaled to fit 640 × 480 (same as the other modes).
- BLE UUIDs and packet layout matching the supplied ESP32-S3 protocol v2.
- First-time device selection and saved-device reconnection attempt on application startup / foreground.
- Full-library synchronization using the current firmware's `BEGIN_SYNC → CARD → IMG_BEGIN/IMG_CHUNK/IMG_END → END_SYNC` flow.
- Tauri 2 Windows desktop project and Capacitor Android/iOS project configuration.
- Five supplied design screenshots retained in `public/reference/`.

## Important compatibility notes

### Local library is the source of truth

The supplied firmware protocol accepts a complete deck upload and atomically replaces `/cards.txt` at the end. It does not currently expose commands to list or download cards/images from the glasses. The app therefore stores the editable library on the computer/phone and sends it to the glasses. This is one-way app-to-glasses synchronization, not two-way sync.

### Folders and ratings

Folders are encoded as a folder name on every card; the firmware has no separate folder object. The firmware limits folder names to 20 UTF-8 bytes, and card text to 8,192 UTF-8 bytes per side when the firmware reports chunked-text support (older firmware: about 200 bytes combined). The app validates those limits.

The four-level difficulty rating is local to the app. The current card structure and BLE card packet do not include a rating field, so a rating is not sent to the glasses.

### Image mode reality

The firmware receives and stores all three encodings. The app keeps your original picture for its own use and sends a second, glasses-sized copy (at most 640 × 480, never enlarged) in the mode you choose.

The firmware's grayscale format is `IMAGE_FORMAT_GRAY2`: **2 bits per pixel / four grayscale tones**. It is not 4-bit grayscale.

### Automatic Bluetooth reconnection

The user must pair/select OllO once and allow Bluetooth access. The app saves the device identifier/address and attempts to reconnect on launch and when a native mobile app returns to the foreground. The glasses must be powered on and advertising.

- Android/iOS: the Capacitor BLE plugin reconnects to the saved platform device identifier.
- Windows: the Tauri BLE plugin scans briefly for the saved address, then reconnects. This is a best-effort automatic reconnection; the OS, Bluetooth adapter, range and peripheral advertising state still apply.
- Browser/PWA: users should expect to press Connect. Browser Web Bluetooth does not provide the same dependable saved-peripheral access as the native Windows app.

### Transfer behaviour

The firmware characteristic uses Write Without Response. Browser transfers use a conservative 15-byte image payload. Native builds query the MTU and use a larger payload where available, capped at 239 bytes. Actual transfer throughput, Windows adapter behaviour, negotiated MTU and reconnect stability still require testing with the real glasses.

## Requirements

- Node.js 22 or newer.
- **Windows desktop:** Windows 10/11, Rust stable, Microsoft C++ Build Tools (Desktop development with C++), and Microsoft Edge WebView2 Runtime.
- **Android:** Android Studio, Android SDK and a physical Android phone for BLE tests.
- **iOS:** macOS + Xcode and signing setup. You cannot produce an iOS native build on Windows alone.

## Run the shared interface in a browser

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Browser Bluetooth is only a fallback for supported browsers and secure contexts. This is useful for previewing the interface, not the recommended Windows shipping app.

## Run the installable Windows desktop app

Install Rust stable and the Windows C++/WebView2 prerequisites first. Then, from the project folder:

```bash
npm install
npm run desktop:dev
```

To create the Windows installers:

```bash
npm run desktop:build
```

Tauri outputs the installers under `src-tauri/target/release/bundle/` (the exact subfolder depends on the selected bundler). The Tauri desktop BLE implementation is in `src/ble/BleManager.ts` and uses `@mnlphlp/plugin-blec`.

## Build Android

After `npm install`:

```bash
npx cap add android
npm run build
npx cap sync android
npx cap open android
```

Build and run from Android Studio on a physical Android phone. The Android emulator is not a useful test of the glasses' BLE peripheral connection.

## Build iOS

On a Mac with Xcode:

```bash
npm install
npx cap add ios
npm run build
npx cap sync ios
npx cap open ios
```

Ensure `NSBluetoothAlwaysUsageDescription` is present in `ios/App/App/Info.plist`. Test on a physical iPhone; do not rely on the iOS simulator for the glasses' BLE connection.

## BLE protocol implemented

- Service: `6f6c6c6f-0001-4000-8000-00805f9b34fb`
- Write characteristic: `6f6c6c6f-0002-4000-8000-00805f9b34fb`
- Notify characteristic: `6f6c6c6f-0003-4000-8000-00805f9b34fb`
- Commands: `0x01` begin sync, `0x02` card, `0x03` image begin, `0x04` image chunk, `0x05` image end, `0x06` end sync, `0x07` storage query, `0x08` device info query.
- Notifications: `0x80` command status, `0x81` storage information, `0x82` device information.

There is no firmware-update functionality in this application.

## Current validation status

The front-end, image encoders and protocol serializer were created from the supplied design and firmware. The BLE plugin integration and platform project files are scaffolded, but they have **not yet been compiled with the npm/Cargo dependencies or tested against physical glasses** in this environment. You should treat this as the first development build, not a production-ready release. The next validation step is to install dependencies, launch the Windows desktop app, and test scan/connect, info/storage notifications, then a one-card sync before testing images.
