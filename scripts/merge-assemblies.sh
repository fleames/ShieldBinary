#!/bin/bash
# ShieldBinary - merge managed assemblies with ILRepack
# Usage:
#   ./scripts/merge-assemblies.sh ./bin/merged/App.merged.dll ./bin/publish/MyApp.dll ./bin/publish/Dep1.dll

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <output-assembly> <input1.dll> <input2.dll> [more inputs...]"
  exit 1
fi

OUTPUT="$1"
shift
INPUTS=("$@")

for asm in "${INPUTS[@]}"; do
  if [[ ! -f "$asm" ]]; then
    echo "Input assembly not found: $asm"
    exit 1
  fi
done

mkdir -p "$(dirname "$OUTPUT")"

if [[ ! -f ".config/dotnet-tools.json" ]]; then
  dotnet new tool-manifest >/dev/null
fi

if ! dotnet tool list --local | grep -q "dotnet-ilrepack"; then
  dotnet tool install dotnet-ilrepack --local >/dev/null
fi

echo "[merge] ILRepack -> $OUTPUT"
dotnet tool run ilrepack -- /out:"$OUTPUT" /targetplatform:v4 "${INPUTS[@]}"
echo "[merge] done"
