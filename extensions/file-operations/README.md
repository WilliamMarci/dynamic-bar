# File operations extension

Build with `make`, then optionally link `island-file` into `~/.local/bin`.

```sh
island-file copy SOURCE DESTINATION
island-file move SOURCE DESTINATION
```

Files are copied in chunks and directories recursively. Progress is calculated
from total regular-file bytes. A move first attempts an atomic rename; across
filesystems it copies completely before removing the source. If Dynamic Bar is
not running, the file operation still completes and only presentation is lost.
