#!/usr/bin/env bash
# Minimal v2 SDK example; use island(1) for normal shell scripts.
set -euo pipefail
id="${1:-bash-demo}"
bus=org.gnome.Shell.Extensions.DynamicBar.LiveActivity
path=/org/gnome/Shell/Extensions/DynamicBar/LiveActivity
gdbus call --session --dest "$bus" --object-path "$path" --method "$bus.StartV2" \
  "{\"id\":\"$id\",\"title\":\"Bash SDK demo\",\"source\":\"bash\",\"progress\":{\"kind\":\"indeterminate\"}}"
gdbus call --session --dest "$bus" --object-path "$path" --method "$bus.UpdateV2" \
  "$id" '{"progress":{"kind":"determinate","value":0.5}}'
gdbus call --session --dest "$bus" --object-path "$path" --method "$bus.FinishV2" \
  "$id" '{"status":"success"}'
