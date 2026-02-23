#!/bin/bash
# ShieldBinary - .NET publish profiles helper
# Usage:
#   ./scripts/publish-dotnet-profiles.sh ./testdata/dotnet-fixture/TestApp.csproj linux-x64 Release ./bin/publish-profiles

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-}"
RUNTIME="${2:-linux-x64}"
CONFIG="${3:-Release}"
OUT_DIR="${4:-bin/publish-profiles}"

if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 <project.csproj> [runtime] [configuration] [output-dir]"
  exit 1
fi
if [[ ! -f "$PROJECT" ]]; then
  echo "Project not found: $PROJECT"
  exit 1
fi

publish_profile() {
  local name="$1"
  shift
  local out="$OUT_DIR/$name"
  mkdir -p "$out"
  echo "[publish] $name -> $out"
  dotnet publish "$PROJECT" -c "$CONFIG" -r "$RUNTIME" --self-contained true -o "$out" "$@"
}

mkdir -p "$OUT_DIR"

publish_profile baseline
publish_profile r2r -p:PublishReadyToRun=true
publish_profile singlefile -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
publish_profile trimmed -p:PublishTrimmed=true -p:TrimMode=partial
publish_profile singlefile-r2r-trimmed \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:PublishReadyToRun=true \
  -p:PublishTrimmed=true \
  -p:TrimMode=partial

if ! publish_profile nativeaot -p:PublishAot=true -p:InvariantGlobalization=true; then
  echo "[publish] nativeaot skipped due to compatibility/toolchain limits"
fi

echo ""
echo "Publish profiles completed under: $OUT_DIR"
