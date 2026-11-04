# OllO on Windows — quick start

## 1. Install the build tools

Install these once:

1. Node.js 22 LTS or newer.
2. Rust stable (use `rustup` and install the MSVC toolchain).
3. Visual Studio Build Tools with **Desktop development with C++** selected.
4. Microsoft Edge WebView2 Runtime.

Restart VS Code after installation if it was already open.

## 2. Open the project

1. Extract `ollo-companion-starter.zip`.
2. In VS Code, choose **File → Open Folder** and select the extracted `ollo-app` folder.
3. Open **Terminal → New Terminal**.
4. Run:

```powershell
npm install
```

## 3. Run the Windows app

```powershell
npm run desktop:dev
```

This opens OllO in its own desktop window. The first Bluetooth connection is made from the Sync screen using **Connect**. Keep the glasses powered on and advertising as `Ollo`.

## 4. Build an installer

```powershell
npm run desktop:build
```

Look for the generated `.exe` (NSIS installer) and/or `.msi` under:

```text
src-tauri/target/release/bundle/
```

## 5. Test in this order

1. Launch the desktop app.
2. Open Sync and connect to OllO.
3. Check that device info and storage are displayed.
4. Create one text-only card and synchronize.
5. Confirm it appears on the glasses and can be flipped/navigated.
6. Test one small black-and-white image.
7. Test grayscale and color only after the first transfers are reliable.

Do not test with your only copy of important study cards. The app stores its library locally; the current glasses protocol replaces the full stored deck when a sync completes.
