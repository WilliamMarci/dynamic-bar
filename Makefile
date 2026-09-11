.PHONY: all schemas tools check

all: schemas tools

schemas:
	glib-compile-schemas schemas

tools:
	$(MAKE) -C tools

check:
	glib-compile-schemas --strict --dry-run schemas
	@for file in *.js providers/*.js services/*.js; do node --check "$$file" || exit; done
	$(MAKE) -C tools clean all

