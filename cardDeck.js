import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {logError} from './log.js';

function makeChevron() {
    const area = new St.DrawingArea();
    area.set_size(16, 16);
    area._up = false;
    area.connect('repaint', () => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineWidth(2.4);
        cr.setSourceRGBA(1, 1, 1, 0.85);
        const cx = width / 2;
        const cy = height / 2;
        if (area._up) {
            cr.moveTo(cx - 5, cy + 2.5);
            cr.lineTo(cx, cy - 2.5);
            cr.lineTo(cx + 5, cy + 2.5);
        } else {
            cr.moveTo(cx - 5, cy - 2.5);
            cr.lineTo(cx, cy + 2.5);
            cr.lineTo(cx + 5, cy - 2.5);
        }
        cr.stroke();
        cr.$dispose();
    });
    area.connect('notify::allocation', () => area.queue_repaint());
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        area.queue_repaint();
        return GLib.SOURCE_REMOVE;
    });
    return area;
}

/**
 * Unified container for island content.
 *
 * Features register *cards* (peer, switchable pages) and one optional
 * *attached* page that expands below the active card with a disclosure
 * toggle. The deck owns navigation, measurement and interaction; callers only
 * provide an actor factory per card, so no feature re-implements tabs,
 * dots or the control strip.
 */
export class IslandCardDeck {
    constructor(settings, {onLayoutChanged = null, onInteraction = null,
        onCardSelected = null, onAttachedToggled = null} = {}) {
        this._settings = settings;
        this._onLayoutChanged = onLayoutChanged;
        this._onInteraction = onInteraction;
        this._onCardSelected = onCardSelected;
        this._onAttachedToggled = onAttachedToggled;
        this._cards = [];
        this._activeIndex = 0;
        this._displayedIndex = undefined;
        this._attached = null;
        this._attachedExpanded = false;
        this._root = null;
        this._cardHolder = null;
        this._attachedHolder = null;
        this._strip = null;
        this._cardActor = null;
        this._attachedActor = null;
        this._navigation = null;
        this._toggle = null;
        this._toggleIcon = null;
    }

    addCard({id, createActor, onDestroy = null, layout = null}) {
        this._cards.push({id, createActor, onDestroy, layout});
        if (this._root)
            this._showCard(this._activeIndex);
        return this;
    }

    removeCard(id) {
        const index = this._cards.findIndex(card => card.id === id);
        if (index < 0)
            return;
        if (index === this._activeIndex) {
            this._destroyCard();
            this._cards.splice(index, 1);
            this._activeIndex = Math.min(this._activeIndex,
                Math.max(this._cards.length - 1, 0));
            if (this._root)
                this._showCard(this._activeIndex);
        } else {
            this._cards.splice(index, 1);
        }
        if (this._root)
            this._rebuildStrip();
    }

    setAttached({id, createActor, onDestroy = null, layout = null} = {}) {
        this._attached = id ? {id, createActor, onDestroy, layout} : null;
        if (this._root && !this._attached && this._attachedExpanded) {
            this._attachedExpanded = false;
            this._destroyAttached();
        }
        if (this._root)
            this._rebuildStrip();
        return this;
    }

    get activeId() {
        return this._cards[this._activeIndex]?.id ?? null;
    }

    get attachedExpanded() {
        return this._attachedExpanded;
    }

    getLayoutOptions() {
        // Horizontal padding is applied to each card actor as a margin so the
        // control strip can span the island edge to edge.
        const base = this._cards[this._activeIndex]?.layout ?? {};
        return {
            paddingX: 0,
            paddingY: Math.max(base.paddingY ?? 10,
                this._attachedExpanded ? 10 : 0),
            minWidth: base.minWidth,
            minHeight: base.minHeight,
        };
    }

    createActor() {
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-deck',
            x_expand: true,
        });
        this._cardHolder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            clip_to_allocation: true,
        });
        this._root.add_child(this._cardHolder);

        this._strip = new St.BoxLayout({
            style_class: 'dynamic-bar-deck-strip',
            orientation: Clutter.Orientation.HORIZONTAL,
            reactive: true,
            track_hover: true,
            x_expand: true,
            height: this._controlHeight(),
        });
        this._strip.connect('scroll-event', (_actor, event) =>
            this._onScroll(event));
        this._root.add_child(this._strip);

        // The attached page expands below the control strip, i.e. under the
        // disclosure button that toggles it.
        this._attachedHolder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            visible: false,
        });
        this._root.add_child(this._attachedHolder);

        this._showCard(this._activeIndex);
        this._rebuildStrip();
        return this._root;
    }

    selectCard(idOrIndex) {
        const index = typeof idOrIndex === 'number'
            ? idOrIndex
            : this._cards.findIndex(card => card.id === idOrIndex);
        if (index < 0 || index >= this._cards.length)
            return;
        this._activeIndex = index;
        this._showCard(index);
        this._rebuildStrip();
        this._onCardSelected?.(this.activeId);
        this._changed();
    }

    toggleAttached() {
        if (!this._attached)
            return;
        this._attachedExpanded = !this._attachedExpanded;
        if (this._attachedExpanded) {
            try {
                this._attachedActor = this._attached.createActor();
            } catch (error) {
                logError('CardDeck', error, `attached ${this._attached.id}`);
                this._attachedActor = null;
            }
            if (this._attachedActor) {
                const paddingX = this._attached.layout?.paddingX ?? 0;
                if (paddingX > 0) {
                    this._attachedActor.set_style(
                        `margin-left: ${paddingX}px; margin-right: ${paddingX}px;`);
                }
                this._attachedActor.x_align = Clutter.ActorAlign.CENTER;
                this._attachedHolder.add_child(this._attachedActor);
            }
            this._attachedHolder.visible = Boolean(this._attachedActor);
        } else {
            this._destroyAttached();
        }
        this._syncToggleIcon();
        this._onAttachedToggled?.(this._attachedExpanded);
        this._changed();
    }

    syncHeight() {
        const height = this._controlHeight();
        this._strip?.set_height(height);
        this._toggle?.set_height(height);
        this._changed();
    }

    _controlHeight() {
        return Math.max(16, this._settings.get_int('compact-control-height'));
    }

    _pageWidth() {
        return Math.min(500, Math.max(200,
            this._settings.get_int('card-page-width')));
    }

    destroy() {
        this._destroyCard();
        this._destroyAttached();
        this._root = null;
        this._cardHolder = null;
        this._attachedHolder = null;
        this._strip = null;
        this._navigation = null;
        this._toggle = null;
        this._toggleIcon = null;
    }

    _showCard(index) {
        if (!this._cardHolder || !this._cards[index])
            return;
        this._destroyCard();
        this._displayedIndex = index;
        try {
            this._cardActor = this._cards[index].createActor?.() ?? null;
        } catch (error) {
            logError('CardDeck', error, `card ${this._cards[index].id}`);
            this._cardActor = new St.Label({
                text: `Failed to load ${this._cards[index].id}`,
                style_class: 'dynamic-bar-live-summary',
            });
        }
        if (this._cardActor) {
            const cardActor = this._cardActor;
            cardActor.connect('destroy', () => {
                if (this._cardActor === cardActor)
                    this._cardActor = null;
            });
            cardActor.set_width(this._pageWidth());
            // Cards keep their compact feature-specific natural width.
            const paddingX = this._cards[index].layout?.paddingX ?? 0;
            if (paddingX > 0) {
                this._cardActor.set_style(
                    `margin-left: ${paddingX}px; margin-right: ${paddingX}px;`);
            }
            this._cardActor.x_align = Clutter.ActorAlign.CENTER;
            this._cardHolder.add_child(this._cardActor);
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._cardActor !== cardActor)
                    return GLib.SOURCE_REMOVE;
                const [, naturalWidth] = cardActor.get_preferred_width(-1);
                if (this._cardHolder.width > 0 &&
                    naturalWidth > this._cardHolder.width + 1)
                    logError('CardDeck', `natural width ${naturalWidth}px exceeds ` +
                        `holder ${this._cardHolder.width}px`, this._cards[index].id);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _destroyCard() {
        if (this._cardActor) {
            const actor = this._cardActor;
            this._cardActor = null;
            actor.destroy();
        }
        if (this._displayedIndex !== undefined) {
            this._cards[this._displayedIndex]?.onDestroy?.();
            this._displayedIndex = undefined;
        }
    }

    _destroyAttached() {
        if (this._attachedActor) {
            const actor = this._attachedActor;
            this._attachedActor = null;
            actor.destroy();
        }
        this._attached?.onDestroy?.();
        if (this._attachedHolder)
            this._attachedHolder.visible = false;
    }

    _rebuildStrip() {
        if (!this._strip)
            return;
        this._strip.remove_all_children();
        this._navigation = null;
        this._toggle = null;
        this._toggleIcon = null;

        const showToggle = Boolean(this._attached) || this._cards.length > 1;
        this._toggleIcon = makeChevron();
        this._toggleIcon._up = this._attachedExpanded;
        this._toggle = new St.Button({
            style_class: 'dynamic-bar-control-toggle',
            child: this._toggleIcon,
            width: 38,
            height: this._controlHeight(),
            can_focus: true,
            visible: showToggle,
        });
        this._toggle.connect('clicked', () => {
            this._onInteraction?.();
            if (this._attached)
                this.toggleAttached();
            else
                this.selectCard((this._activeIndex + 1) % this._cards.length);
        });

        // Fixed 38px side cells keep the navigation exactly centered while the
        // disclosure button is pinned to the trailing edge.
        if (this._cards.length > 1) {
            this._strip.add_child(new St.Widget({width: 38}));
            this._strip.add_child(this._centerCell(this._buildNavigation()));
            const right = new St.Widget({
                width: 38,
                layout_manager: new Clutter.BinLayout(),
            });
            right.add_child(this._toggle);
            this._strip.add_child(right);
        } else {
            this._strip.add_child(new St.Widget({width: 38}));
            this._strip.add_child(this._centerCell(this._toggle));
            this._strip.add_child(new St.Widget({width: 38}));
        }
    }

    _centerCell(child) {
        const cell = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        child.x_align = Clutter.ActorAlign.CENTER;
        child.y_align = Clutter.ActorAlign.CENTER;
        cell.add_child(child);
        return cell;
    }

    _buildNavigation() {
        this._navigation = new St.BoxLayout({
            style_class: 'dynamic-bar-control-pages',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._cards.forEach((card, index) => {
            const dot = new St.Button({
                style_class: index === this._activeIndex
                    ? 'dynamic-bar-control-dot active'
                    : 'dynamic-bar-control-dot',
                can_focus: true,
            });
            dot.connect('clicked', () => {
                this._onInteraction?.();
                this.selectCard(index);
            });
            this._navigation.add_child(dot);
        });
        return this._navigation;
    }

    _syncToggleIcon() {
        if (this._toggleIcon) {
            this._toggleIcon._up = this._attachedExpanded;
            this._toggleIcon.queue_repaint();
        }
    }

    _onScroll(event) {
        if (this._cards.length <= 1)
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
        this._onInteraction?.();
        this.selectCard((this._activeIndex + step + this._cards.length) %
            this._cards.length);
        return Clutter.EVENT_STOP;
    }

    _changed() {
        this._root?.queue_relayout();
        this._onLayoutChanged?.();
    }
}
