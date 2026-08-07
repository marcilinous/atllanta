#!/usr/bin/env bash
# One-command setup for the Atllanta Android shell.
#
# `flutter create` generates the Android project scaffolding but overwrites
# lib/main.dart and pubspec.yaml with its templates — so we run it first, then
# drop our tracked source (in template/) on top. Re-runnable any time.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter isn't installed. Get it at https://docs.flutter.dev/get-started/install" >&2
  exit 1
fi

echo "→ Generating Android scaffolding…"
flutter create --org com.rtcompu --project-name atllanta --platforms=android .

echo "→ Applying Atllanta shell source…"
cp template/pubspec.yaml pubspec.yaml
mkdir -p lib
cp template/main.dart lib/main.dart
cp template/AndroidManifest.xml android/app/src/main/AndroidManifest.xml

echo "→ Fetching packages…"
flutter pub get

echo ""
echo "Done. Next:"
echo "  1. Set kAppUrl in lib/main.dart to your production URL (default: https://atllanta.vercel.app)"
echo "  2. Debug on a device:   flutter run"
echo "  3. Build a release APK: flutter build apk --release"
echo "     (output: build/app/outputs/flutter-apk/app-release.apk)"
