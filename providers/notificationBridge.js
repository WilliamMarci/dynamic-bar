import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BarProvider} from '../provider.js';

export class NotificationBridgeProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._sources = new Set();
        for (const source of Main.messageTray.getSources()) this._watch(source);
        Main.messageTray.connectObject('source-added', (_tray, source) =>
            this._watch(source), this);
    }

    _watch(source) {
        if (this._sources.has(source)) return;
        this._sources.add(source);
        source.connectObject('notification-added', (_source, notification) =>
            this._forward(source, notification), 'destroy', () =>
            this._sources.delete(source), this);
    }

    _forward(source, notification) {
        if (!this._settings.get_boolean('notification-forwarding-enabled')) return;
        const appId = source.app?.get_id?.() ?? source.title ?? '';
        if (this._settings.get_strv('notification-filter').includes(appId)) return;
        const title = notification.title ?? source.title ?? appId;
        if (!title) return;
        const provider = {createIslandActor: () => {
            const viewport = new St.Widget({layout_manager: new Clutter.BinLayout(),
                clip_to_allocation: true, width: 176, height: 10});
            const label = new St.Label({text: title,
                style_class: 'dynamic-bar-track-notification-label'});
            viewport.add_child(label);
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!label.get_parent()) return GLib.SOURCE_REMOVE;
                const [, width] = label.get_preferred_width(-1);
                const overflow = Math.max(0, width - viewport.width);
                if (overflow) label.ease({translation_x: -overflow,
                    duration: Math.max(1800, overflow * 35),
                    mode: Clutter.AnimationMode.LINEAR, repeatCount: -1, autoReverse: true});
                return GLib.SOURCE_REMOVE;
            });
            return viewport;
        }, destroyIslandActor() {}};
        this.bar.notification(provider, {timeout: 1400, passive: true,
            width: 192, height: 10, paddingX: 8, paddingY: 0});
    }

    destroy() {
        Main.messageTray.disconnectObject(this);
        for (const source of this._sources) source.disconnectObject(this);
        this._sources.clear();
    }
}
