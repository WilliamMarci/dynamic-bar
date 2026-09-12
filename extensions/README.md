# Dynamic Bar extensions

Each extension lives in its own directory and provides a `manifest.ini` plus
its source/build files. Extensions are out-of-process clients: they use the
versioned API in `sdk/` and never import GNOME Shell implementation modules.
This keeps a failed helper from taking down the Shell process.

`island list` discovers bundled manifests next to this repository. The same
directory layout can later be installed under the extension's data directory.
