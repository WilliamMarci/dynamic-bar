import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {BarProvider} from '../provider.js';
import {getLauncherItems} from '../launcherConfig.js';
import {logError, logWarning} from '../log.js';

export class LauncherProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._settings.connectObject('changed::launcher-items', () =>
            this._refreshVisible(), 'changed::launcher-apps', () =>
            this._refreshVisible(), this);
    }

    _refreshVisible() {
        if (this.bar.isShown(this))
            this.bar.cardsChanged();
    }

    getLayoutOptions() {
        return {paddingX: 16, paddingY: 10};
    }

    getAttachedPage() {
        return {
            id: 'launcher',
            createActor: () => this.createIslandActor(),
            onDestroy: () => this.destroyIslandActor?.(),
        };
    }

    _resolveDesktop(desktopId) {
        if (!desktopId)
            return {app: null, info: null};
        const appSystem = Shell.AppSystem.get_default();
        let app = appSystem.lookup_app(desktopId);
        if (!app) {
            const wanted = desktopId.toLowerCase();
            app = appSystem.get_installed().find(candidate => {
                const id = candidate.get_id().toLowerCase();
                return id === wanted || id.endsWith(`.${wanted}`) ||
                    id.endsWith(`_${wanted}`);
            }) ?? null;
        }
        let info = null;
        try {
            info = Gio.DesktopAppInfo.new(app?.get_id() ?? desktopId);
        } catch (error) {
            logError('Launcher', error, `desktop info ${desktopId}`);
        }
        return {app, info};
    }

    createIslandActor() {
        const box = new St.BoxLayout({
            style_class: 'dynamic-bar-launcher',
            x_align: 1,
            y_align: 1,
        });

        for (const item of getLauncherItems(this._settings)) {
            const {app, info} = this._resolveDesktop(item.desktopId);
            if (!app && !info && !item.command) {
                logWarning('Launcher', 'Desktop application was not found',
                    item.desktopId || item.name || 'unnamed item');
                continue;
            }

            let icon;
            if (item.iconMode === 'theme' && item.icon) {
                icon = new St.Icon({icon_name: item.icon, icon_size: 26});
            } else if (item.iconMode === 'custom' && item.icon) {
                try {
                    const file = item.icon.startsWith('file://')
                        ? Gio.File.new_for_uri(item.icon)
                        : Gio.File.new_for_path(item.icon);
                    icon = new St.Icon({
                        gicon: new Gio.FileIcon({file}),
                        icon_size: 26,
                    });
                } catch (error) {
                    logError('Launcher', error, `custom icon ${item.icon}`);
                    icon = null;
                }
            }
            icon ??= app?.create_icon_texture(26);
            if (!icon && info?.get_icon())
                icon = new St.Icon({gicon: info.get_icon(), icon_size: 26});
            icon ??= new St.Icon({icon_name: 'application-x-executable-symbolic',
                icon_size: 26});
            let child = icon;
            if (item.showName) {
                child = new St.BoxLayout({vertical: true});
                child.add_child(icon);
                child.add_child(new St.Label({
                    text: item.name || app?.get_name() || info?.get_name() || item.command,
                    style_class: 'dynamic-bar-launcher-label',
                }));
            }

            const button = new St.Button({
                style_class: 'dynamic-bar-launcher-button',
                child,
                can_focus: true,
            });
            button.connect('clicked', () => {
                this.bar.collapse();
                try {
                    if (item.command) {
                        const info = Gio.AppInfo.create_from_commandline(item.command,
                            item.name || null, Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION);
                        info.launch([], null);
                    } else if (item.action) {
                        if (app)
                            app.launch_action(item.action, global.get_current_time(), -1);
                        else
                            info.launch_action(item.action, null);
                    } else if (app) {
                        app.open_new_window(-1);
                    } else {
                        info.launch([], null);
                    }
                } catch (error) {
                    logError('Launcher', error,
                        item.desktopId || item.command || item.name);
                }
            });
            box.add_child(button);
        }

        const dndIcon = new St.Icon({
            icon_name: this._settings.get_boolean('notifications-enabled')
                ? 'preferences-system-notifications-symbolic'
                : 'notifications-disabled-symbolic',
            icon_size: 18,
        });
        const dndButton = new St.Button({
            style_class: 'dynamic-bar-launcher-button',
            child: dndIcon,
            can_focus: true,
        });
        dndButton.connect('clicked', () => {
            const enabled = !this._settings.get_boolean('notifications-enabled');
            this._settings.set_boolean('notifications-enabled', enabled);
            dndIcon.icon_name = enabled
                ? 'preferences-system-notifications-symbolic'
                : 'notifications-disabled-symbolic';
            this.bar.holdOpen(1800);
        });
        box.add_child(dndButton);

        const settingsButton = new St.Button({
            style_class: 'dynamic-bar-launcher-button',
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                icon_size: 18,
            }),
            can_focus: true,
        });
        settingsButton.connect('clicked', () => {
            this.bar.collapse();
            this.bar.openPreferences();
        });
        box.add_child(settingsButton);

        return box;
    }

    destroy() {
        this._settings.disconnectObject(this);
    }
}
