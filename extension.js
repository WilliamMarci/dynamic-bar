import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DynamicBar} from './dynamicBar.js';
import {ChargingProvider} from './providers/charging.js';
import {BluetoothProvider} from './providers/bluetooth.js';
import {LauncherProvider} from './providers/launcher.js';
import {LockKeysProvider} from './providers/lockKeys.js';
import {LiveActivityProvider} from './providers/liveActivity.js';
import {MediaProvider} from './providers/media.js';
import {RemovableProvider} from './providers/removable.js';
import {NotificationBridgeProvider} from './providers/notificationBridge.js';
import {PrintingProvider} from './providers/printing.js';

const TOGGLE_KEY = 'toggle-bar';

export default class DynamicBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._bar = new DynamicBar({
            settings: this._settings,
            openPreferences: () => this.openPreferences(),
        });

        this._providers = [];

        const launcher = new LauncherProvider(this._bar.api, this._settings);
        this._bar.setDefaultProvider(launcher);
        this._bar.registerProvider(launcher);
        this._providers.push(launcher);

        const liveActivity = new LiveActivityProvider(this._bar.api, this._settings);
        this._bar.setLiveActivityProvider(liveActivity);
        this._bar.registerProvider(liveActivity);
        this._providers.push(liveActivity);
        this._providers.push(new RemovableProvider(this._bar.api, this._settings,
            liveActivity));
        this._providers.push(new NotificationBridgeProvider(this._bar.api,
            this._settings));
        this._providers.push(new PrintingProvider(this._bar.api, this._settings,
            liveActivity));

        if (this._settings.get_boolean('media-enabled')) {
            try {
                const media = new MediaProvider(this._bar.api, this._settings,
                    launcher, liveActivity);
                this._bar.setMediaProvider(media);
                this._bar.registerProvider(media);
                this._providers.push(media);
            } catch (error) {
                console.error(`Dynamic Bar media provider disabled: ${error}`);
            }
        }

        if (this._settings.get_boolean('charging-enabled'))
            this._providers.push(new ChargingProvider(this._bar.api, this._settings));

        if (this._settings.get_boolean('bluetooth-enabled'))
            this._providers.push(new BluetoothProvider(this._bar.api, this._settings));

        if (this._settings.get_boolean('lock-keys-enabled'))
            this._providers.push(new LockKeysProvider(this._bar.api, this._settings));

        Main.wm.addKeybinding(TOGGLE_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL,
            () => this._bar?.toggle());
    }

    disable() {
        Main.wm.removeKeybinding(TOGGLE_KEY);

        for (const provider of this._providers ?? [])
            provider.destroy();
        this._providers = null;

        this._bar?.destroy();
        this._bar = null;
        this._settings = null;
    }
}
