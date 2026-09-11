import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

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

    _add(mount, initial) {
        if (mount.is_shadowed()) return;
        const volume = mount.get_volume();
        const drive = volume?.get_drive();
        if (!volume && !drive) return;
        const id = this._id(mount);
        this._mounts.set(id, mount);
        this._activities.registerInternal({id, title: mount.get_name(), source: 'gio-volume',
            type: 'removable', group: 'removable', status: 'paused', silentStart: true,
            progress: {kind: 'indeterminate'}, actions: [
                {id: 'open', label: 'Open', icon: 'folder-open-symbolic'},
                {id: 'eject', label: drive?.can_eject() ? 'Eject' : 'Unmount',
                    icon: 'media-eject-symbolic', dangerous: true},
            ]}, {open: () => this._open(mount), eject: () => this._eject(id, mount)});
        if (!initial) this._small(`${mount.get_name()} mounted`);
    }

    _remove(mount) {
        const id = this._id(mount);
        if (!this._mounts.delete(id)) return;
        if (this._requested.delete(id))
            this._activities.finishInternal(id, {status: 'success', summary: 'Safely unmounted'});
        else
            this._activities.Dismiss(id);
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
                        this._activities.updateInternal(id, {status: 'error', summary: String(error)}); }
                });
        } else {
            mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, operation, null,
                (object, result) => {
                    try { object.unmount_with_operation_finish(result); }
                    catch (error) { this._requested.delete(id);
                        this._activities.updateInternal(id, {status: 'error', summary: String(error)}); }
                });
        }
    }

    _small(text) {
        this.bar.notification({createIslandActor: () => new St.Label({text,
            style_class: 'dynamic-bar-track-notification-label'}), destroyIslandActor() {}},
        {timeout: 1200, passive: true, height: 10, paddingX: 8, paddingY: 0});
    }

    destroy() {
        this._monitor.disconnectObject(this);
        for (const id of this._mounts.keys()) this._activities.Dismiss(id);
        this._mounts.clear();
    }
}
