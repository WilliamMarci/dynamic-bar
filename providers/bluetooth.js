import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

const BLUEZ = 'org.bluez';
const DEVICE_IFACE = 'org.bluez.Device1';
const BATTERY_IFACE = 'org.bluez.Battery1';

export class BluetoothProvider extends BarProvider {
    constructor(bar, settings, activities = null) {
        super(bar);
        this._settings = settings;
        this._activities = activities;
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
                this._untrack(object), 'interface-added', (_manager, object, iface) =>
                this._interfaceAdded(object, iface), this);
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
            battery: object.get_interface(BATTERY_IFACE),
            activityRegistered: false,
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
            this._syncActivity(path, state);
        }, this);
        state.battery?.connectObject('g-properties-changed', () =>
            this._syncActivity(path, state), this);
        this._devices.set(path, state);
        this._syncActivity(path, state);
        if (!initial && state.connected)
            this._notify(state.name, true);
    }

    _untrack(object) {
        const path = object.get_object_path();
        const state = this._devices.get(path);
        if (!state)
            return;
        state.proxy.disconnectObject(this);
        state.battery?.disconnectObject(this);
        this._devices.delete(path);
        if (state.activityRegistered)
            this._activities?.Dismiss(this._activityId(path));
        if (state.connected)
            this._notify(state.name, false);
    }

    _interfaceAdded(object, iface) {
        if (iface.g_interface_name !== BATTERY_IFACE)
            return;
        const path = object.get_object_path();
        const state = this._devices.get(path);
        if (!state || state.battery)
            return;
        state.battery = iface;
        iface.connectObject('g-properties-changed', () =>
            this._syncActivity(path, state), this);
        this._syncActivity(path, state);
    }

    _activityId(path) {
        return `bluetooth:${path}`;
    }

    _syncActivity(path, state) {
        if (!this._activities || !state.connected || !state.battery) {
            if (state.activityRegistered) {
                this._activities?.Dismiss(this._activityId(path));
                state.activityRegistered = false;
            }
            return;
        }
        const percentage = Number(this._property(state.battery, 'Percentage', 0));
        const color = percentage <= 20 ? '#ed333b'
            : percentage <= 50 ? '#ff9f0a' : '#33d17a';
        const id = this._activityId(path);
        const update = {progress: {kind: 'determinate', value: percentage / 100},
            indicator: {kind: 'battery', icon: 'battery-symbolic', color},
            summary: `${Math.round(percentage)}% battery`};
        if (state.activityRegistered) {
            this._activities.updateInternal(id, update);
            return;
        }
        this._activities.registerInternal({id, title: state.name,
            source: 'bluez', type: 'device', group: 'device', status: 'paused',
            silentStart: true, heartbeat: false,
            ...update, actions: []});
        state.activityRegistered = true;
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
        for (const [path, state] of this._devices) {
            state.battery?.disconnectObject(this);
            if (state.activityRegistered)
                this._activities?.Dismiss(this._activityId(path));
        }
        this._devices.clear();
        this._manager = null;
        this._activities = null;
    }
}
