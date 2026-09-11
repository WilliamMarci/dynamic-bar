import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

const BLUEZ = 'org.bluez';
const DEVICE_IFACE = 'org.bluez.Device1';

export class BluetoothProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._devices = new Map();
        this._noticeName = '';
        this._noticeConnected = false;
        this._manager = null;
        try {
            this._manager = Gio.DBusObjectManagerClient.new_for_bus_sync(
                Gio.BusType.SYSTEM, Gio.DBusObjectManagerClientFlags.NONE,
                BLUEZ, '/', null, null, null, null);
            for (const object of this._manager.get_objects())
                this._track(object, true);
            this._manager.connectObject('object-added', (_manager, object) =>
                this._track(object, true), 'object-removed', (_manager, object) =>
                this._untrack(object), this);
        } catch (error) {
            console.error(`Dynamic Bar Bluetooth unavailable: ${error}`);
        }
    }

    getLayoutOptions() {
        return {paddingX: 18, paddingY: 10};
    }

    _property(proxy, name, fallback = null) {
        return proxy.get_cached_property(name)?.unpack() ?? fallback;
    }

    _track(object, initial) {
        const proxy = object.get_interface(DEVICE_IFACE);
        if (!proxy)
            return;
        const path = object.get_object_path();
        const state = {
            proxy,
            name: this._property(proxy, 'Alias', this._property(proxy, 'Name', 'Bluetooth device')),
            connected: this._property(proxy, 'Connected', false),
        };
        proxy.connectObject('g-properties-changed', () => {
            const connected = this._property(proxy, 'Connected', false);
            state.name = this._property(proxy, 'Alias', state.name);
            if (connected === state.connected)
                return;
            state.connected = connected;
            this._notify(state.name, connected);
        }, this);
        this._devices.set(path, state);
        if (!initial && state.connected)
            this._notify(state.name, true);
    }

    _untrack(object) {
        const path = object.get_object_path();
        const state = this._devices.get(path);
        if (!state)
            return;
        state.proxy.disconnectObject(this);
        this._devices.delete(path);
        if (state.connected)
            this._notify(state.name, false);
    }

    _notify(name, connected) {
        if (!this._settings.get_boolean('bluetooth-enabled'))
            return;
        this._noticeName = name;
        this._noticeConnected = connected;
        this.pushNotification({
            timeout: this._settings.get_int('notification-decay'),
            passive: true,
            paddingX: 16,
            paddingY: 10,
        });
    }

    createIslandActor() {
        const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
        box.add_child(new St.Icon({
            icon_name: this._noticeConnected
                ? 'bluetooth-active-symbolic'
                : 'bluetooth-disabled-symbolic',
            icon_size: 24,
        }));
        const text = new St.BoxLayout({vertical: true});
        text.add_child(new St.Label({
            text: this._noticeName,
            style_class: 'dynamic-bar-notice-title',
        }));
        text.add_child(new St.Label({
            text: this._noticeConnected ? 'Connected' : 'Disconnected',
            style_class: 'dynamic-bar-notice-label',
        }));
        box.add_child(text);
        return box;
    }

    destroy() {
        this._manager?.disconnectObject(this);
        for (const state of this._devices.values())
            state.proxy.disconnectObject(this);
        this._devices.clear();
        this._manager = null;
    }
}
