# Live Activity protocol v2

The session-bus service is `org.gnome.Shell.Extensions.DynamicBar.LiveActivity`
at `/org/gnome/Shell/Extensions/DynamicBar/LiveActivity`. JSON payloads are
versioned independently from D-Bus transport. Call `GetCapabilities` before
using optional fields. Unknown JSON properties must be ignored.

Actions are callbacks: the Shell emits `ActionRequested(activityId, actionId)`.
It never executes a command string supplied by a client. Destructive actions
require confirmation in the Shell. Clients should heartbeat at a low rate
below their declared `heartbeatTimeout`; missed heartbeats become `orphaned`,
not failed. Provider-owned activities (in-process tasks such as timers, print
jobs or mounts) set `"heartbeat": false` so they never expire on heartbeat; the
Shell still restores them as `orphaned` after a restart.

`island run` publishes a `retry` action when the command fails. A detached
instance of the wrapper keeps listening for `ActionRequested(id, "retry")` and
re-runs the original argument vector itself within a bounded window; the Shell
only forwards the ids and never sees the command string.

Use `island inspect` and `island demo` for diagnostics. The legacy
Start/Update/Complete methods remain available for v1 clients.

Lifecycle metadata is cached under `~/.cache/dynamic-bar/`; a non-terminal
activity restored after Shell restart is marked `orphaned`. Clients should
send `Heartbeat` less often than their chosen timeout (the bundled wrapper
uses 15 seconds). Progress kinds are `determinate`, `indeterminate`, `steps`,
and `elapsed`.

Examples are available in `../sdk/live-activity.sh` and
`../sdk/live_activity.cpp`. The latter builds with:

```sh
c++ -std=c++17 live_activity.cpp -o live_activity $(pkg-config --cflags --libs gio-2.0)
```
