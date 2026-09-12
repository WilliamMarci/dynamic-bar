.PHONY: all schemas tools extensions check

all: schemas tools extensions

schemas:
	glib-compile-schemas schemas

tools:
	$(MAKE) -C tools

extensions:
	$(MAKE) -C extensions/file-operations

check:
	glib-compile-schemas --strict --dry-run schemas
	@for file in *.js providers/*.js services/*.js; do node --check "$$file" || exit; done
	$(MAKE) -C tools clean all
	$(MAKE) -C extensions/file-operations clean all
