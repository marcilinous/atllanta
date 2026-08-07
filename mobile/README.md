# Atllanta — Android app (Flutter WebView shell)

A thin native Android app that hosts the Atllanta web app in a WebView. You get
a real, installable app with its own icon — while **reusing 100% of the web
codebase** and keeping **instant auto-updates**: ship a web change to Vercel and
the app reflects it on next open, with no Play Store re-review.

The shell only handles what a browser tab can't: being an installed app,
granting the WebView the OS permissions a PWA needs (camera for selfies,
location for GPS), hiding browser chrome, and the hardware back button. Login,
offline check-in/visits, and every feature come from the web app.

## What's tracked here

Only the source of truth — the generated Flutter/Android project is `.gitignore`d
and rebuilt on demand:

```
mobile/
├── README.md
├── setup.sh                 # generates the Android project + applies our source
└── template/
    ├── main.dart            # the WebView shell  → becomes lib/main.dart
    ├── pubspec.yaml         # dependencies        → becomes pubspec.yaml
    └── AndroidManifest.xml  # permissions + label → android/app/src/main/…
```

## Build it (on your machine or CI — needs Flutter, not this repo's server)

1. **Install Flutter** (includes the Android toolchain):
   https://docs.flutter.dev/get-started/install — then `flutter doctor` until Android is green.

2. **Generate + apply the shell:**
   ```bash
   cd mobile
   ./setup.sh
   ```
   This runs `flutter create` (scaffolding) and copies `template/` over it.

3. **Point it at your site** — edit `kAppUrl` in `lib/main.dart` if your
   production URL isn't `https://atllanta.vercel.app`.

4. **Run / build:**
   ```bash
   flutter run                  # live on a connected phone or emulator
   flutter build apk --release  # → build/app/outputs/flutter-apk/app-release.apk
   ```
   Sideload the APK to test, or `flutter build appbundle` for a Play Store upload.

## Publishing to the Play Store (later)

- One-time **$25** Google Play developer registration.
- Create a signing key (`keytool`) and wire it into `android/app/build.gradle` +
  `key.properties` (see the [Flutter Android signing guide](https://docs.flutter.dev/deployment/android#signing-the-app)).
- Upload the `.aab` from `flutter build appbundle`.
- Because the UI is web-served, most updates ship straight through Vercel — you
  only re-submit to the store when the **native shell** itself changes (icon,
  permissions, plugin upgrades).

## Notes & known limits

- **Offline:** the web app's service worker + IndexedDB run inside the WebView,
  so once the app has been opened online, it opens and works offline (queued
  check-ins/visits sync on reconnect). The "Can't reach Atllanta" screen only
  appears if the very first launch is offline.
- **Google sign-in:** Google blocks OAuth inside embedded WebViews. Email +
  password login works normally; if you need Google OAuth in the app, that's a
  follow-up (system-browser auth flow). Field staff typically use email login.
- **Native push / background GPS:** not wired yet — the shell is the foundation.
  These are added later via Flutter plugins (FCM, background geolocation) without
  touching the web app.
- **iOS:** this shell is Android-only for now. iOS needs a Mac (or CI) to build
  and a $99/year Apple Developer account; the same `main.dart` works when you add
  the iOS platform.

## App identity

- Application id: `com.rtcompu.atllanta` (change via the `--org` flag in `setup.sh`)
- Display name: **Atllanta** (set in `template/AndroidManifest.xml`)
- Launcher icon: replace the generated `android/app/src/main/res/mipmap-*` icons,
  or use [`flutter_launcher_icons`](https://pub.dev/packages/flutter_launcher_icons).
