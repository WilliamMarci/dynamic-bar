import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {getLauncherItems, normalizeItem, saveLauncherItems} from './launcherConfig.js';

const COMMON_ICONS = [
    'applications-system-symbolic', 'folder-symbolic', 'web-browser-symbolic',
    'utilities-terminal-symbolic', 'text-editor-symbolic', 'camera-photo-symbolic',
    'audio-x-generic-symbolic', 'video-x-generic-symbolic', 'mail-unread-symbolic',
    'system-search-symbolic', 'preferences-system-symbolic', 'starred-symbolic',
];

function addSpinRow(group, settings, key, title, {min, max, step}) {
    const isDouble = settings.get_value(key).get_type_string() === 'd';
    const read = () => isDouble ? settings.get_double(key) : settings.get_int(key);

    const row = new Adw.SpinRow({
        title,
        digits: isDouble ? 2 : 0,
        adjustment: new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: step,
            page_increment: step * 10,
        }),
    });
    row.value = read();

    row.connect('notify::value', () => {
        if (isDouble)
            settings.set_double(key, row.value);
        else
            settings.set_int(key, Math.round(row.value));
    });

    const changedId = settings.connect(`changed::${key}`, () => {
        const value = read();
        if (row.value !== value)
            row.value = value;
    });
    row.connect('destroy', () => settings.disconnect(changedId));

    group.add(row);
}

function addSwitchRow(group, settings, key, title) {
    const row = new Adw.SwitchRow({title});
    row.active = settings.get_boolean(key);

    row.connect('notify::active', () => settings.set_boolean(key, row.active));

    const changedId = settings.connect(`changed::${key}`, () => {
        const value = settings.get_boolean(key);
        if (row.active !== value)
            row.active = value;
    });
    row.connect('destroy', () => settings.disconnect(changedId));

    group.add(row);
}

function addColorRow(group, settings, key, title) {
    const row = new Adw.ActionRow({title});
    const dialog = new Gtk.ColorDialog({with_alpha: false});
    const button = new Gtk.ColorDialogButton({
        dialog,
        valign: Gtk.Align.CENTER,
    });
    const updateButton = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string(key)))
            button.rgba = rgba;
    };
    updateButton();
    button.connect('notify::rgba', () =>
        settings.set_string(key, button.rgba.to_string()));
    const changedId = settings.connect(`changed::${key}`, () => {
        updateButton();
    });
    row.connect('destroy', () => settings.disconnect(changedId));
    row.add_suffix(button);
    group.add(row);
}

function addLauncherEditor(group, settings, window) {
    let items = getLauncherItems(settings);
    const rows = [];
    const save = () => saveLauncherItems(settings, items);
    const rebuild = () => {
        for (const oldRow of rows.splice(0))
            group.remove(oldRow);
        items.forEach((item, index) => {
            const row = new Adw.ExpanderRow({
                title: item.name || item.desktopId || item.command || `Item ${index + 1}`,
                subtitle: item.desktopId || item.command || 'Not configured',
            });
            rows.push(row);
            group.add(row);
            const entry = (title, field) => {
                const child = new Adw.EntryRow({title, text: item[field]});
                child.connect('notify::text', () => {
                    item[field] = child.text;
                    row.title = item.name || item.desktopId || item.command || `Item ${index + 1}`;
                    row.subtitle = item.desktopId || item.command || 'Not configured';
                    save();
                });
                row.add_row(child);
            };
            entry('Desktop file ID', 'desktopId');
            entry('Name', 'name');
            const showName = new Adw.SwitchRow({title: 'Show name under icon', active: item.showName});
            showName.connect('notify::active', () => { item.showName = showName.active; save(); });
            row.add_row(showName);
            const modes = ['desktop', 'theme', 'custom'];
            const iconMode = new Adw.ComboRow({
                title: 'Icon source',
                model: Gtk.StringList.new(['Desktop original', 'Theme icon', 'Custom image']),
                selected: modes.indexOf(item.iconMode),
            });
            iconMode.connect('notify::selected', () => { item.iconMode = modes[iconMode.selected]; save(); });
            row.add_row(iconMode);
            const iconRow = new Adw.ActionRow({title: 'Icon', subtitle: item.icon || 'Choose from grid or file'});
            const popover = new Gtk.Popover();
            const grid = new Gtk.Grid({row_spacing: 6, column_spacing: 6,
                margin_top: 8, margin_bottom: 8, margin_start: 8, margin_end: 8});
            COMMON_ICONS.forEach((iconName, iconIndex) => {
                const button = new Gtk.Button({child: new Gtk.Image({icon_name: iconName, pixel_size: 20})});
                button.connect('clicked', () => {
                    item.iconMode = 'theme'; item.icon = iconName;
                    iconMode.selected = 1; iconRow.subtitle = iconName;
                    popover.popdown(); save();
                });
                grid.attach(button, iconIndex % 4, Math.floor(iconIndex / 4), 1, 1);
            });
            popover.child = grid;
            iconRow.add_suffix(new Gtk.MenuButton({icon_name: 'view-grid-symbolic', popover,
                valign: Gtk.Align.CENTER, tooltip_text: 'Choose theme icon'}));
            const fileButton = new Gtk.Button({icon_name: 'document-open-symbolic',
                valign: Gtk.Align.CENTER, tooltip_text: 'Choose custom image'});
            fileButton.connect('clicked', () => {
                const dialog = new Gtk.FileDialog({title: 'Choose launcher icon'});
                dialog.open(window, null, (_source, result) => {
                    try {
                        const file = dialog.open_finish(result);
                        item.iconMode = 'custom'; item.icon = file.get_path() ?? file.get_uri();
                        iconMode.selected = 2; iconRow.subtitle = item.icon; save();
                    } catch {}
                });
            });
            iconRow.add_suffix(fileButton);
            row.add_row(iconRow);
            entry('Launch command (overrides Desktop)', 'command');
            entry('Desktop action', 'action');
            const removeRow = new Adw.ActionRow({title: 'Remove this item'});
            const remove = new Gtk.Button({icon_name: 'user-trash-symbolic',
                css_classes: ['destructive-action'], valign: Gtk.Align.CENTER});
            remove.connect('clicked', () => { items.splice(index, 1); save(); rebuild(); });
            removeRow.add_suffix(remove); row.add_row(removeRow);
        });
    };
    const add = new Gtk.Button({icon_name: 'list-add-symbolic', tooltip_text: 'Add launcher item'});
    add.connect('clicked', () => {
        items.push(normalizeItem()); save(); rebuild(); rows.at(-1)?.set_expanded(true);
    });
    group.header_suffix = add;
    rebuild();
}

export default class DynamicBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.search_enabled = true;

        const finePage = new Adw.PreferencesPage({
            title: 'Fine tune',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(finePage);

        const barGroup = new Adw.PreferencesGroup({
            title: 'Dynamic bar',
            description: 'The small bar shown below the top panel.',
        });
        finePage.add(barGroup);
        addSpinRow(barGroup, settings, 'handle-width', 'Width (px)', {min: 20, max: 600, step: 2});
        addSpinRow(barGroup, settings, 'bar-long-width', 'Active width (px)', {min: 20, max: 1200, step: 2});
        addSpinRow(barGroup, settings, 'handle-height', 'Height (px)', {min: 2, max: 40, step: 1});
        addSpinRow(barGroup, settings, 'handle-radius', 'Corner radius (px)', {min: 0, max: 40, step: 1});
        addSpinRow(barGroup, settings, 'handle-gap', 'Gap (px)', {min: 0, max: 40, step: 1});
        addSpinRow(barGroup, settings, 'handle-alpha', 'Opacity', {min: 0, max: 1, step: 0.05});
        addSpinRow(barGroup, settings, 'handle-hover-alpha', 'Hover opacity', {min: 0, max: 1, step: 0.05});
        addSpinRow(barGroup, settings, 'bar-track-alpha', 'Track opacity', {min: 0, max: 1, step: 0.05});
        addSpinRow(barGroup, settings, 'bar-progress-alpha', 'Progress opacity', {min: 0, max: 1, step: 0.05});

        const islandGroup = new Adw.PreferencesGroup({
            title: 'Dynamic island',
            description: 'The panel that slides out of the top bar.',
        });
        finePage.add(islandGroup);
        addSpinRow(islandGroup, settings, 'panel-width', 'Min width (px)', {min: 60, max: 1200, step: 2});
        addSpinRow(islandGroup, settings, 'panel-height', 'Min height (px)', {min: 8, max: 200, step: 1});
        addSpinRow(islandGroup, settings, 'island-padding', 'Padding (px)', {min: 0, max: 60, step: 1});
        addSpinRow(islandGroup, settings, 'panel-top-radius', 'Fusion fillet (px)', {min: 0, max: 60, step: 1});
        addSpinRow(islandGroup, settings, 'panel-bottom-radius', 'Bottom radius (px)', {min: 0, max: 60, step: 1});
        addSpinRow(islandGroup, settings, 'compact-control-height', 'Compact control height (px)', {min: 5, max: 24, step: 1});
        addColorRow(islandGroup, settings, 'maximized-dark-color',
            'Maximized background (dark)');
        addColorRow(islandGroup, settings, 'maximized-light-color',
            'Maximized background (light)');

        const animationGroup = new Adw.PreferencesGroup({title: 'Animation'});
        finePage.add(animationGroup);
        addSwitchRow(animationGroup, settings, 'animations-enabled', 'Popup animations');
        addSpinRow(animationGroup, settings, 'hover-duration', 'Hover duration (ms)', {min: 20, max: 2000, step: 10});
        addSpinRow(animationGroup, settings, 'expand-duration', 'Expand duration (ms)', {min: 50, max: 2000, step: 10});
        addSpinRow(animationGroup, settings, 'collapse-duration', 'Collapse duration (ms)', {min: 50, max: 2000, step: 10});
        addSpinRow(animationGroup, settings, 'auto-collapse-delay', 'Auto collapse after (ms)', {min: 0, max: 10000, step: 100});
        addSpinRow(animationGroup, settings, 'notification-decay', 'Notification decay (ms)', {min: 500, max: 15000, step: 100});
        addSpinRow(animationGroup, settings, 'track-flash-duration', 'Track flash duration (ms)', {min: 200, max: 5000, step: 100});

        const contentPage = new Adw.PreferencesPage({
            title: 'Content',
            icon_name: 'view-grid-symbolic',
        });
        window.add(contentPage);

        const featureGroup = new Adw.PreferencesGroup({title: 'Features'});
        contentPage.add(featureGroup);
        addSwitchRow(featureGroup, settings, 'media-enabled', 'Media playback');
        addSwitchRow(featureGroup, settings, 'notifications-enabled', 'Dynamic Bar notifications');
        addSwitchRow(featureGroup, settings, 'notification-forwarding-enabled', 'Forward GNOME notifications');
        addSwitchRow(featureGroup, settings, 'bluetooth-enabled', 'Bluetooth notifications');
        addSwitchRow(featureGroup, settings, 'charging-enabled', 'Charging notifications');
        addSwitchRow(featureGroup, settings, 'lock-keys-enabled', 'Lock key indicators');
        addSpinRow(featureGroup, settings, 'battery-low-threshold', 'Low battery threshold (%)', {min: 0, max: 100, step: 1});
        const filterRow = new Adw.EntryRow({title: 'Ignored notification app IDs',
            text: settings.get_strv('notification-filter').join(', ')});
        filterRow.connect('notify::text', () => settings.set_strv('notification-filter',
            filterRow.text.split(',').map(value => value.trim()).filter(Boolean)));
        featureGroup.add(filterRow);

        const launcherGroup = new Adw.PreferencesGroup({
            title: 'Launcher',
            description: 'Add applications or commands and customize icons, labels and Desktop actions.',
        });
        contentPage.add(launcherGroup);
        addLauncherEditor(launcherGroup, settings, window);

        const shortcutGroup = new Adw.PreferencesGroup({title: 'Shortcut'});
        contentPage.add(shortcutGroup);

        const shortcutRow = new Adw.ActionRow({
            title: 'Toggle shortcut',
            subtitle: settings.get_strv('toggle-bar').join(', ') || 'Disabled',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            settings.reset('toggle-bar');
            shortcutRow.subtitle = settings.get_strv('toggle-bar').join(', ');
        });
        settings.connect('changed::toggle-bar', () => {
            shortcutRow.subtitle = settings.get_strv('toggle-bar').join(', ') || 'Disabled';
        });
        shortcutRow.add_suffix(resetButton);
        shortcutGroup.add(shortcutRow);
    }
}
