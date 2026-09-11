import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {BarProvider} from '../provider.js';
import {getLauncherItems} from '../launcherConfig.js';

export class LauncherProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._settings.connectObject('changed::launcher-items', () =>
            this._refreshVisible(), 'changed::launcher-apps', () =>
            this._refreshVisible(), this);
    }

    _refreshVisible() {
        const presentation = this.bar.presentation;
        if (presentation.expanded && presentation.provider === this)
            this.bar.rebuild(this);
    }

    getLayoutOptions() {
        return {paddingX: 16, paddingY: 10};
    }

    createIslandActor() {
        const box = new St.BoxLayout({
            style_class: 'dynamic-bar-launcher',
            x_align: 1,
            y_align: 1,
        });

        for (const item of getLauncherItems(this._settings)) {
            const app = item.desktopId
                ? Shell.AppSystem.get_default().lookup_app(item.desktopId)
                : null;
            if (!app && !item.command)
                continue;

            let icon;
            if (item.iconMode === 'theme' && item.icon) {
                icon = new St.Icon({icon_name: item.icon, icon_size: 26});
            } else if (item.iconMode === 'custom' && item.icon) {
                try {
                    icon = new St.Icon({
                        gicon: new Gio.FileIcon({file: Gio.File.new_for_path(item.icon)}),
                        icon_size: 26,
                    });
                } catch {
                    icon = null;
                }
            }
            icon ??= app?.create_icon_texture(26) ?? new St.Icon({
                icon_name: 'application-x-executable-symbolic',
                icon_size: 26,
            });
            let child = icon;
            if (item.showName) {
                child = new St.BoxLayout({vertical: true});
                child.add_child(icon);
                child.add_child(new St.Label({
                    text: item.name || app?.get_name() || item.command,
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
                        app.launch_action(item.action, global.get_current_time(), -1);
                    } else {
                        app.open_new_window(-1);
                    }
                } catch (error) {
                    console.error(`Dynamic Bar launcher failed: ${error}`);
                }
            });
            box.add_child(button);
        }

        const dndIcon = new St.Icon({
            icon_name: this._settings.get_boolean('notifications-enabled')
                ? 'notifications-symbolic'
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
                ? 'notifications-symbolic'
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
