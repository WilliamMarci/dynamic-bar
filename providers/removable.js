import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarProvider} from '../provider.js';
import {logError} from '../log.js';

export class RemovableProvider extends BarProvider {
    constructor(bar, settings, activities) {
        super(bar);
        this._settings = settings;
        this._activities = activities;
        this._monitor = Gio.VolumeMonitor.get();
        this._mounts = new Map();
        this._requested = new Set();
        for (const mount of this._monitor.get_mounts()) this._add(mount, true);
        this._monitor.connectObject('mount-added', (_monitor, mount) => this._add(mount, false),
            'mount-removed', (_monitor, mount) => this._remove(mount), this);
    }

    _id(mount) { return `mount:${mount.get_uuid() || mount.get_root().get_uri()}`; }

    _mountedRing() {
        return this._settings.get_string('removable-mounted-color');
    }

    _unmountedRing() {
        return this._settings.get_string('removable-unmounted-color');
    }

    _add(mount, initial) {
        if (mount.is_shadowed()) return;
        const volume = mount.get_volume();
        const drive = volume?.get_drive();
        if (!volume && !drive) return;
        const id = this._id(mount);
        this._mounts.set(id, mount);
        this._activities.registerInternal({id, title: mount.get_name(), source: 'gio-volume',
            type: 'removable', group: 'removable', status: 'paused', silentStart: true,
            heartbeat: false, ring: this._mountedRing(),
            progress: {kind: 'indeterminate'}, actions: [
                {id: 'open', label: 'Open', icon: 'folder-open-symbolic'},
                {id: 'eject', label: drive?.can_eject() ? 'Eject' : 'Unmount',
                    icon: 'media-eject-symbolic', dangerous: true},
            ]}, {open: () => this._open(mount), eject: () => this._eject(id, mount)});
        if (!initial)
            this._notify(`${mount.get_name()} connected`, 'Removable volume',
                drive?.can_eject() ? 'drive-removable-media-symbolic'
                    : 'drive-harddisk-usb-symbolic');
    }

    _remove(mount) {
        const id = this._id(mount);
        if (!this._mounts.delete(id)) return;
        const name = mount.get_name();
        if (this._requested.delete(id)) {
            this._activities.finishInternal(id, {status: 'success',
                summary: 'Safely removed', ring: this._unmountedRing()});
            this._notify(`${name} safely removed`, 'You can unplug it now',
                'media-eject-symbolic');
        } else {
            this._notify(`${name} removed`, 'Volume disconnected',
                'drive-removable-media-symbolic');
            this._activities.Dismiss(id);
        }
    }

    _open(mount) {
        Gio.AppInfo.launch_default_for_uri(mount.get_root().get_uri(), null);
    }

    _eject(id, mount) {
        this._requested.add(id);
        const drive = mount.get_volume()?.get_drive();
        const operation = new Gio.MountOperation();
        if (drive?.can_eject()) {
            drive.eject_with_operation(Gio.MountUnmountFlags.NONE, operation, null,
                (object, result) => {
                    try { object.eject_with_operation_finish(result); }
                    catch (error) { this._requested.delete(id);
                        logError('Removable', error, `eject ${id}`);
                        this._activities.updateInternal(id, {status: 'error', summary: String(error)}); }
                });
        } else {
            mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, operation, null,
                (object, result) => {
                    try { object.unmount_with_operation_finish(result); }
                    catch (error) { this._requested.delete(id);
                        logError('Removable', error, `unmount ${id}`);
                        this._activities.updateInternal(id, {status: 'error', summary: String(error)}); }
                });
        }
    }

    _notify(title, subtitle, iconName) {
        this.bar.notification({createIslandActor: () => {
            const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
            box.add_child(new St.Icon({icon_name: iconName, icon_size: 22}));
            const labels = new St.BoxLayout({vertical: true});
            labels.add_child(new St.Label({text: title,
                style_class: 'dynamic-bar-notice-title'}));
            if (subtitle) {
                labels.add_child(new St.Label({text: subtitle,
                    style_class: 'dynamic-bar-notice-label'}));
            }
            box.add_child(labels);
            return box;
        }, destroyIslandActor() {}}, {timeout: 2600, passive: true,
            paddingX: 16, paddingY: 10});
    }

    destroy() {
        this._monitor.disconnectObject(this);
        for (const id of this._mounts.keys()) this._activities.Dismiss(id);
        this._mounts.clear();
    }
}
