import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

const LOCKS = [
    {getter: 'get_caps_lock_state', short: 'Cap', badge: 'A', label: 'Caps Lock'},
    {getter: 'get_num_lock_state', short: 'Num', badge: '1', label: 'Num Lock'},
    {getter: 'get_scroll_lock_state', short: 'Scr', badge: '↕', label: 'Scroll Lock'},
];

const LockBadge = GObject.registerClass(
class LockBadge extends St.DrawingArea {
    _init(glyph) {
        super._init({width: 6, height: 7});
        this._glyph = glyph;
        this._collapsed = false;
        this.connect('repaint', () => this._paint());
    }

    setCollapsed(collapsed, diameter, animate = false, duration = 0) {
        if (this._collapsed === collapsed && (!collapsed || this.width === diameter))
            return;
        const apply = () => {
            this._collapsed = collapsed;
            this.set_size(collapsed ? diameter : 6, collapsed ? diameter : 7);
            this.queue_repaint();
        };
        if (!animate || duration <= 0) {
            apply();
            this.opacity = 255;
            return;
        }
        this.ease({opacity: 0, duration: Math.floor(duration / 2),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => {
                apply();
                this.ease({opacity: 255, duration: Math.ceil(duration / 2),
                    mode: Clutter.AnimationMode.EASE_IN_QUAD});
            }});
    }

    _paint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        cr.setSourceRGBA(1, 1, 1, 0.92);
        if (this._collapsed) {
            cr.arc(width / 2, height / 2, Math.min(width, height) / 2,
                0, Math.PI * 2);
            cr.fill();
            cr.$dispose();
            return;
        }
        cr.setLineWidth(0.55);

        // Hollow shackle and body, drawn rather than theme-dependent icons.
        cr.arc(width / 2, 2.5, 1.5, Math.PI, 0);
        cr.lineTo(width / 2 + 1.5, 3.5);
        cr.moveTo(width / 2 - 1.5, 3.5);
        cr.lineTo(width / 2 - 1.5, 2.5);
        cr.stroke();
        cr.rectangle(1, 3.5, width - 2, height - 4);
        cr.stroke();

        cr.setLineWidth(0.4);
        if (this._glyph === 'A') {
            cr.moveTo(2.1, 6.2);
            cr.lineTo(3, 4.4);
            cr.lineTo(3.9, 6.2);
            cr.moveTo(2.5, 5.5);
            cr.lineTo(3.5, 5.5);
        } else if (this._glyph === '1') {
            cr.moveTo(2.5, 4.8);
            cr.lineTo(3.1, 4.4);
            cr.lineTo(3.1, 6.2);
            cr.moveTo(2.5, 6.2);
            cr.lineTo(3.7, 6.2);
        } else {
            cr.moveTo(3, 4.3);
            cr.lineTo(3, 6.2);
            cr.moveTo(2.4, 4.9);
            cr.lineTo(3, 4.3);
            cr.lineTo(3.6, 4.9);
            cr.moveTo(2.4, 5.6);
            cr.lineTo(3, 6.2);
            cr.lineTo(3.6, 5.6);
        }
        cr.stroke();
        cr.$dispose();
    }
});

export class LockKeysProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        const seat = global.stage.context.get_backend()?.get_default_seat?.();
        this._keymap = seat?.get_keymap?.() ?? null;
        this._insertState = false;
        this._lastChange = null;
        this._state = this._readState();
        this._keymap?.connectObject('state-changed',
            () => this._onStateChanged(), this);
        this._stageEventId = global.stage.connect('captured-event',
            (_stage, event) => this._onCapturedEvent(event));
        this._syncIndicator();
    }

    getLayoutOptions() {
        return {paddingX: 16, paddingY: 8};
    }

    _readState() {
        const state = new Map();
        for (const lock of LOCKS) {
            state.set(lock.short,
                this._keymap?.[lock.getter]?.() ?? false);
        }
        state.set('Ins', this._insertState);
        return state;
    }

    _onStateChanged() {
        const next = this._readState();
        const changed = LOCKS.find(lock =>
            next.get(lock.short) !== this._state.get(lock.short));
        this._state = next;
        if (!changed)
            return;

        this._lastChange = {
            label: changed.label,
            on: next.get(changed.short),
        };
        this._syncIndicator();
        this.pushNotification({
            timeout: this._settings.get_int('notification-decay'),
            passive: true,
        });
    }

    _onCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.KEY_PRESS ||
            event.get_key_symbol() !== Clutter.KEY_Insert)
            return Clutter.EVENT_PROPAGATE;

        this._insertState = !this._insertState;
        this._state = this._readState();
        this._lastChange = {label: 'Insert', on: this._insertState};
        this._syncIndicator();
        this.pushNotification({
            timeout: this._settings.get_int('notification-decay'),
            passive: true,
        });
        return Clutter.EVENT_PROPAGATE;
    }

    _syncIndicator() {
        const state = this._state;
        const active = LOCKS.filter(lock => state.get(lock.short));

        if (active.length === 0) {
            this.setStatus('locks', null);
            return;
        }

        const box = new St.BoxLayout({style_class: 'dynamic-bar-zone'});
        for (const lock of active)
            box.add_child(this._createBadge(lock.badge ?? 'I'));
        this.setStatus('locks', box);
    }

    _createBadge(glyph) {
        return new LockBadge(glyph);
    }

    createIslandActor() {
        const box = new St.BoxLayout({
            style_class: 'dynamic-bar-notice',
        });
        const change = this._lastChange ?? {label: 'Lock key', on: false};
        const lock = LOCKS.find(item => item.label === change.label);
        if (change.on && lock)
            box.add_child(new St.Icon({
                icon_name: 'changes-prevent-symbolic',
                icon_size: 18,
            }));
        else if (!change.on)
            box.add_child(new St.Icon({
                icon_name: 'changes-allow-symbolic',
                icon_size: 18,
            }));
        box.add_child(new St.Label({
            text: `${change.label}: ${change.on ? 'On' : 'Off'}`,
            style_class: 'dynamic-bar-notice-label',
        }));

        return box;
    }

    destroy() {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }
        this._keymap?.disconnectObject(this);
        this._keymap = null;
    }
}
