# island Live Activity wrapper

Build in place:

```sh
make -C ~/.local/share/gnome-shell/extensions/dynamic-bar@william-marci/tools
```

Expose the extension-owned executable on `PATH` with a symbolic link:

```sh
mkdir -p ~/.local/bin
ln -s ~/.local/share/gnome-shell/extensions/dynamic-bar@william-marci/tools/island ~/.local/bin/island
```

Examples:

```sh
island --title "Building app" npm run build
island cmake --build build
island --title "System upgrade" sudo apt upgrade
island list
island help
```

`run` is optional, so `island npm run build` and `island run npm run build`
are equivalent. Use the explicit form to execute a command literally named
`help` or `list`. Running bare `island` prints the same usage overview as
`island help`, because there is no command to wrap yet.

The wrapper executes the command directly, preserves its exit status and
forwards combined output. Progress adapters only observe output. Unknown
formats remain indeterminate until completion.
If the extension is temporarily unavailable, the command still runs normally;
only Live Activity reporting is skipped.
