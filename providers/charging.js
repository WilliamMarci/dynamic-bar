import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

const BUS_NAME = 'org.freedesktop.UPower';
const OBJECT_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const INTERFACE = 'org.freedesktop.UPower.Device';

const STATE_CHARGING = 1;
const STATE_DISCHARGING = 2;
const STATE_FULLY_CHARGED = 4;

export class ChargingProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._wasCharging = null;
        this._lastPercentage = null;
        this._noticeLabel = 'Battery';
        this._lowNotified = false;
        this._proxy = null;

        try {
            this._proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES, null,
                BUS_NAME, OBJECT_PATH, INTERFACE, null);
            this._proxy.connectObject('g-properties-changed',
                () => this._onChanged(), this);
        } catch {
            this._proxy = null;
        }

        this._onChanged(true);
    }

    getLayoutOptions() {
        return {paddingX: 20, paddingY: 10};
    }

    _prop(name) {
        return this._proxy?.get_cached_property(name)?.unpack() ?? null;
    }

    _isCharging() {
        const state = this._prop('State');
        return state === STATE_CHARGING || state === STATE_FULLY_CHARGED;
    }

    _onChanged(initial = false) {
        if (!this._proxy)
            return;
        if (this._prop('IsPresent') === false)
            return;

        const charging = this._isCharging();
        const percentage = Math.round(this._prop('Percentage') ?? 0);
        const threshold = this._settings.get_int('battery-low-threshold');
        const decay = this._settings.get_int('notification-decay');

        if (!initial) {
            if (charging !== this._wasCharging) {
                this._noticeLabel = charging ? 'Charging' : 'Discharging';
                this.pushNotification({timeout: decay, passive: true});
            } else if (!charging && percentage <= threshold &&
                (this._lastPercentage === null || this._lastPercentage > threshold) &&
                !this._lowNotified) {
                this._lowNotified = true;
                this._noticeLabel = 'Battery low';
                this.pushNotification({
                    timeout: decay,
                    passive: true,
                    pulse: true,
                });
            }
        }

        if (percentage > threshold + 5)
            this._lowNotified = false;
        this._wasCharging = charging;
        this._lastPercentage = percentage;

        const presentation = this.bar.presentation;
        if (presentation.expanded && presentation.provider === this)
            this.bar.refresh();
    }

    createIslandActor() {
        const charging = this._isCharging();
        const percentage = Math.round(this._prop('Percentage') ?? 0);
        const level = Math.max(0, Math.min(100, 10 * Math.floor(percentage / 10)));
        const iconName = `battery-level-${level}${charging ? '-charging' : ''}-symbolic`;

        const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
        box.add_child(new St.Icon({icon_name: iconName, icon_size: 28}));

        const info = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-notice-info',
        });
        info.add_child(new St.Label({
            text: `${percentage}%`,
            style_class: 'dynamic-bar-notice-title',
        }));
        info.add_child(new St.Label({
            text: this._noticeLabel,
            style_class: 'dynamic-bar-notice-label',
        }));
        box.add_child(info);

        return box;
    }

    destroy() {
        this._proxy?.disconnectObject(this);
        this._proxy = null;
    }
}
