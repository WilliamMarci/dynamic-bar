import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * A reusable, very thin shelf for optional persistent island controls.
 * One registered page uses a centered disclosure glyph. Multiple pages add
 * workspace-like dots in the center and move disclosure to the right.
 */
export class IslandControlContainer {
    constructor(settings, onLayoutChanged) {
        this._settings = settings;
        this._onLayoutChanged = onLayoutChanged;
        this._pages = [];
        this._activeIndex = 0;
        this._expanded = false;
        this._pageActor = null;
        this._root = null;
        this._holder = null;
        this._strip = null;
        this._navigation = null;
        this._toggle = null;
        this._toggleIcon = null;
    }

    addPage(id, createActor) {
        this._pages.push({id, createActor});
        this._rebuildNavigation();
    }

    createActor() {
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-control-container',
            x_expand: true,
        });
        this._holder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            visible: false,
        });
        this._root.add_child(this._holder);

        this._strip = new St.Widget({
            style_class: 'dynamic-bar-control-strip',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            x_expand: true,
            height: this._settings.get_int('compact-control-height'),
        });
        this._strip.connect('scroll-event', (_actor, event) =>
            this._onScroll(event));
        this._root.add_child(this._strip);
        this._rebuildNavigation();
        return this._root;
    }

    rebuildActivePage() {
        if (this._expanded)
            this._showPage(this._activeIndex);
    }

    syncHeight() {
        const height = this._settings.get_int('compact-control-height');
        this._strip?.set_height(height);
        this._toggle?.set_height(height);
        this._changed();
    }

    destroy() {
        this._pageActor = null;
        this._root = null;
        this._holder = null;
        this._strip = null;
        this._navigation = null;
        this._toggle = null;
        this._toggleIcon = null;
    }

    _makeToggle() {
        this._toggleIcon = new St.Icon({
            icon_name: this._expanded
                ? 'pan-up-symbolic'
                : 'pan-down-symbolic',
            icon_size: 11,
        });
        this._toggle = new St.Button({
            style_class: 'dynamic-bar-control-toggle',
            child: this._toggleIcon,
            width: 38,
            height: this._settings.get_int('compact-control-height'),
            x_align: this._pages.length > 1
                ? Clutter.ActorAlign.END
                : Clutter.ActorAlign.CENTER,
            can_focus: true,
        });
        this._toggle.connect('clicked', () => {
            this._expanded = !this._expanded;
            if (this._expanded)
                this._showPage(this._activeIndex);
            else
                this._clearPage();
            this._toggleIcon.icon_name = this._expanded
                ? 'pan-up-symbolic'
                : 'pan-down-symbolic';
            this._changed();
        });
        this._strip.add_child(this._toggle);
    }

    _rebuildNavigation() {
        if (!this._strip)
            return;
        this._strip.remove_all_children();
        this._navigation = null;
        this._makeToggle();
        if (this._pages.length <= 1)
            return;

        this._navigation = new St.BoxLayout({
            style_class: 'dynamic-bar-control-pages',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pages.forEach((_page, index) => {
            const dot = new St.Button({
                style_class: index === this._activeIndex
                    ? 'dynamic-bar-control-dot active'
                    : 'dynamic-bar-control-dot',
                can_focus: true,
            });
            dot.connect('clicked', () => this._select(index));
            this._navigation.add_child(dot);
        });
        this._strip.add_child(this._navigation);
    }

    _select(index) {
        if (index < 0 || index >= this._pages.length)
            return;
        this._activeIndex = index;
        this._expanded = true;
        this._showPage(index);
        this._rebuildNavigation();
        this._changed();
    }

    _onScroll(event) {
        if (this._pages.length <= 1)
            return Clutter.EVENT_PROPAGATE;
        const direction = event.get_scroll_direction();
        let step = 0;
        if (direction === Clutter.ScrollDirection.DOWN ||
            direction === Clutter.ScrollDirection.RIGHT)
            step = 1;
        else if (direction === Clutter.ScrollDirection.UP ||
            direction === Clutter.ScrollDirection.LEFT)
            step = -1;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
            step = Math.sign(delta);
        }
        if (!step)
            return Clutter.EVENT_PROPAGATE;
        this._select((this._activeIndex + step + this._pages.length) %
            this._pages.length);
        return Clutter.EVENT_STOP;
    }

    _showPage(index) {
        this._clearPage();
        this._pageActor = this._pages[index]?.createActor?.() ?? null;
        if (this._pageActor) {
            this._pageActor.x_align = Clutter.ActorAlign.CENTER;
            this._holder.add_child(this._pageActor);
        }
        this._holder.visible = Boolean(this._pageActor);
    }

    _clearPage() {
        if (this._pageActor) {
            this._holder.remove_child(this._pageActor);
            this._pageActor.destroy();
            this._pageActor = null;
        }
        if (this._holder)
            this._holder.visible = false;
    }

    _changed() {
        this._root?.queue_relayout();
        this._onLayoutChanged?.();
    }
}
