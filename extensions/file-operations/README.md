# File operations extension

Build with `make`. The executable is an internal extension entry and is
dispatched through the common `island` command; it should not be linked into
`PATH` separately.

```sh
island -e file copy SOURCE DESTINATION
island -e file copy -r DIRECTORY DESTINATION
island -e file move SOURCE DESTINATION
island -e file remove PATH
island -e file remove -r DIRECTORY
island -e file help
```

As with the standard Linux tools, copying or removing a directory requires
`-r` (or `--recursive`). Moving a directory does not.

Files are copied in chunks and directories recursively. Progress is calculated
from total regular-file bytes. A move first attempts an atomic rename; across
filesystems it copies completely before removing the source. If Dynamic Bar is
not running, the file operation still completes and only presentation is lost.
