# Rolixa

Rolixa is an offline-first dice roller by Stahpps. The current MVP provides Quick Roll and ordered Formula Roll for D4, D6, D8, D10, D12, D20, and D100.

Copyright © 2026 Stahpps. This project is licensed under the GNU General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE).

## Download

Android APKs are published as downloadable assets in [GitHub Releases](https://github.com/Stahpps/Rolixa/releases). Each release includes a SHA-256 checksum file. Install the APK directly on Android; updates must be signed with the same Rolixa release key.

## Run the web app

```powershell
cd Z:\APP\Rolixa
npm install
npm run dev
```

Open the local URL printed by Vite.

## Android

```powershell
npm install
npm run cap:sync
npm run android:open
```

The chosen application ID is `com.stahpps.rolixa`. Android Studio supplies a compatible JDK; install/open the project with a current Android Studio and Android SDK.

## Formula behavior

- Repeated adjacent dice of the same size and sign group together.
- Order is preserved; returning to an earlier dice type creates a new group.
- Dice and signed numeric modifiers are evaluated as displayed.
- Tap a formula term to decrement or remove it. Undo and Clear affect the current draft only.
- Formula draft and selected mode are saved locally on the device.
- Saved formulas support naming, search, favorites, rename, duplicate, load, and delete.
- Roll history stores up to 500 results; choosing an entry restores its formula without rerolling.
- Settings include system/dark/light appearance, haptic feedback, and 2D Dice, Number Shuffle, or None animations with Slow/Medium/Fast timing.
- Results are calculated before animation; shuffle frames are decorative, and Formula Roll reveals its total after every die settles.
- Quick Roll supports tap, drag into the central area, and upward flick gestures.

Rolls use `crypto.getRandomValues` with rejection sampling when available. No network service is used for dice results.
