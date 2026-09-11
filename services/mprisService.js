import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {logError} from '../log.js';

const DBUS = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';
const PREFIX = 'org.mpris.MediaPlayer2.';
const ROOT_IFACE = 'org.mpris.MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PATH = '/org/mpris/MediaPlayer2';
const PROPERTIES = 'org.freedesktop.DBus.Properties';

function normalize(value) {
    let unpacked = value;
    while (unpacked && typeof unpacked.recursiveUnpack === 'function')
        unpacked = unpacked.recursiveUnpack();
    if (Array.isArray(unpacked))
        return unpacked.map(normalize);
    if (unpacked && typeof unpacked === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(unpacked))
            result[key] = normalize(item);
        return result;
    }
    return unpacked;
}

export class MprisService {
    constructor() {
        this._bus = Gio.DBus.session;
        this._players = new Map();
        this._listeners = new Set();
        this._loggedErrors = new Set();
        this._activeName = null;
        this._destroyed = false;
        this._lastLogKey = null;
        this._state = this._emptyState();
        this._positionTimerId = 0;
        this._watchProxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE, null, DBUS, DBUS_PATH, DBUS, null);
        this._watchSignalId = this._watchProxy.connect('g-signal',
            (_proxy, _sender, signalName, parameters) => {
                if (signalName !== 'NameOwnerChanged')
                    return;
                const [name, oldOwner, newOwner] = parameters.recursiveUnpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (!oldOwner && newOwner)
                    this._add(name);
                else if (oldOwner && !newOwner)
                    this._remove(name);
            });
        this._discover();
    }

    subscribe(callback) {
        this._listeners.add(callback);
        callback(this._state);
        return () => this._listeners.delete(callback);
    }

    call(method) {
        const endpoint = this._players.get(this._activeName);
        try {
            endpoint?.player.call_sync(method, null,
                Gio.DBusCallFlags.NONE, 500, null);
        } catch (error) {
            this._logOnce(`call:${method}`, error);
        }
    }

    seekTo(fraction) {
        const endpoint = this._players.get(this._activeName);
        const trackId = this._state.metadata['mpris:trackid'];
        if (!endpoint || !this._state.canSeek || !trackId ||
            this._state.length <= 0)
            return false;
        const position = Math.round(Math.min(Math.max(fraction, 0), 1) *
            this._state.length * 1e6);
        try {
            endpoint.player.call_sync('SetPosition',
                new GLib.Variant('(ox)', [trackId, position]),
                Gio.DBusCallFlags.NONE, 500, null);
            this._state.position = position / 1e6;
            for (const listener of this._listeners)
                listener(this._state);
            return true;
        } catch (error) {
            console.error(`[Dynamic Bar][MPRIS] seek failed: ${error}`);
            return false;
        }
    }

    destroy() {
        this._destroyed = true;
        this._stopPositionTimer();
        if (this._watchSignalId)
            this._watchProxy.disconnect(this._watchSignalId);
        this._watchSignalId = 0;
        this._watchProxy = null;
        for (const endpoint of this._players.values()) {
            if (endpoint.changedId)
                endpoint.player.disconnect(endpoint.changedId);
        }
        this._players.clear();
        this._listeners.clear();
    }

    _emptyState() {
        return {name: null, identity: '', metadata: {}, playing: false,
            position: 0, length: 0, canSeek: false};
    }

    _discover() {
        try {
            const result = this._bus.call_sync(DBUS, DBUS_PATH, DBUS,
                'ListNames', null, new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE, 1000, null);
            const names = result.recursiveUnpack()[0];
            for (const name of names) {
                if (name.startsWith(PREFIX))
                    this._add(name);
            }
            for (const name of [...this._players.keys()]) {
                if (!names.includes(name))
                    this._remove(name);
            }
        } catch (error) {
            this._logOnce('discover', error);
        }
    }

    _proxy(name, iface) {
        try {
            return Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE, null, name, PATH, iface, null);
        } catch (error) {
            this._logOnce(`proxy:${name}:${iface}`, error);
            return null;
        }
    }

    _add(name) {
        if (this._players.has(name))
            return;
        const endpoint = {
            player: this._proxy(name, PLAYER_IFACE),
            root: this._proxy(name, ROOT_IFACE),
        };
        if (!endpoint.player)
            return;
        endpoint.changedId = endpoint.player.connect('g-properties-changed',
            () => this._selectAndPublish());
        this._players.set(name, endpoint);
        console.log(`[Dynamic Bar][MPRIS] discovered ${name}`);
        this._selectAndPublish();
    }

    _remove(name) {
        const endpoint = this._players.get(name);
        if (endpoint?.changedId)
            endpoint.player.disconnect(endpoint.changedId);
        this._players.delete(name);
        if (this._activeName === name)
            this._activeName = null;
        this._selectAndPublish();
    }

    _selectAndPublish() {
        let fallback = null;
        let selected = null;
        for (const [name, endpoint] of this._players) {
            const status = endpoint.player.get_cached_property(
                'PlaybackStatus')?.unpack();
            fallback ??= name;
            if (status === 'Playing') {
                selected = name;
                break;
            }
        }
        this._activeName = selected ?? (this._players.has(this._activeName)
            ? this._activeName : fallback);
        this._publish();
        this._syncPositionTimer();
    }

    _syncPositionTimer() {
        if (this._state.playing) {
            if (this._positionTimerId)
                return;
            this._positionTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, 2000, () => {
                    this._publish();
                    return GLib.SOURCE_CONTINUE;
                });
        } else {
            this._stopPositionTimer();
        }
    }

    _stopPositionTimer() {
        if (!this._positionTimerId)
            return;
        GLib.source_remove(this._positionTimerId);
        this._positionTimerId = 0;
    }

    _position(name) {
        if (!name)
            return 0;
        try {
            const reply = this._bus.call_sync(name, PATH, PROPERTIES, 'Get',
                new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
                new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 300, null);
            return Number(reply.recursiveUnpack()[0]) / 1e6;
        } catch (error) {
            this._logOnce(`position:${name}`, error);
            return 0;
        }
    }

    _logOnce(key, error) {
        if (this._loggedErrors.has(key))
            return;
        this._loggedErrors.add(key);
        logError('MPRIS', error, key);
    }

    _publish() {
        if (this._destroyed)
            return;
        const endpoint = this._players.get(this._activeName);
        if (!endpoint) {
            this._state = this._emptyState();
        } else {
            const metadata = normalize(endpoint.player.get_cached_property(
                'Metadata')) ?? {};
            this._state = {
                name: this._activeName,
                identity: endpoint.root?.get_cached_property('Identity')?.unpack() ??
                    this._activeName.replace(PREFIX, ''),
                metadata,
                playing: endpoint.player.get_cached_property(
                    'PlaybackStatus')?.unpack() === 'Playing',
                position: this._position(this._activeName),
                length: (Number(metadata['mpris:length']) || 0) / 1e6,
                canSeek: endpoint.player.get_cached_property('CanSeek')
                    ?.unpack() === true,
            };
        }
        const logKey = `${this._state.name}|${this._state.playing}|` +
            `${this._state.metadata['mpris:trackid'] ?? ''}|${this._state.length}`;
        if (logKey !== this._lastLogKey) {
            this._lastLogKey = logKey;
            console.log(`[Dynamic Bar][MPRIS] active=${this._state.name ?? 'none'} ` +
                `playing=${this._state.playing} ` +
                `title=${this._state.metadata['xesam:title'] ?? '(none)'} ` +
                `length=${this._state.length || 'unknown'}`);
        }
        for (const listener of this._listeners)
            listener(this._state);
    }
}
