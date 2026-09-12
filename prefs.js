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

const MODIFIER_KEYVALS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Caps_Lock, Gdk.KEY_Shift_Lock,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R, Gdk.KEY_ISO_Level3_Shift,
    Gdk.KEY_ISO_Level5_Shift, Gdk.KEY_Num_Lock,
]);

function acceleratorLabel(accelerator) {
    const [ok, keyval, mask] = Gtk.accelerator_parse(accelerator);
    return ok ? Gtk.accelerator_get_label(keyval, mask) : accelerator;
}

function validateShortcut(keyval, state) {
    if (MODIFIER_KEYVALS.has(keyval))
        return {ok: false, reason: 'Press a regular key together with Ctrl, Alt or Super.'};

    const mask = state & Gtk.accelerator_get_default_mod_mask();
    if (!Gtk.accelerator_valid(keyval, mask))
        return {ok: false, reason: 'This key cannot be used as a shortcut.'};

    const safe = mask & (Gdk.ModifierType.CONTROL_MASK |
        Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK);
    if (!safe)
        return {ok: false, reason: 'Add Ctrl, Alt or Super so normal typing is not captured.'};

    return {ok: true, accelerator: Gtk.accelerator_name(keyval, mask)};
}

function openShortcutDialog(window, {title, accelerator, onAccept}) {
    const dialog = new Adw.Window({
        title: 'Record shortcut',
        modal: true,
        transient_for: window,
        default_width: 380,
        resizable: false,
    });
    const toolbar = new Adw.ToolbarView();
    const header = new Adw.HeaderBar();
    toolbar.add_top_bar(header);

    const cancel = new Gtk.Button({label: 'Cancel'});
    cancel.connect('clicked', () => dialog.close());
    header.pack_start(cancel);

    const clear = new Gtk.Button({label: 'Clear'});
    clear.connect('clicked', () => {
        onAccept(null);
        dialog.close();
    });
    header.pack_end(clear);

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        valign: Gtk.Align.CENTER,
        vexpand: true,
        margin_top: 18,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    });
    box.append(new Gtk.Label({
        label: `Press a key combination for “${title}”`,
        wrap: true,
        justify: Gtk.Justification.CENTER,
        css_classes: ['title-3'],
    }));
    box.append(new Gtk.Label({
        label: accelerator
            ? `Current: ${acceleratorLabel(accelerator)}`
            : 'Current: Disabled',
        wrap: true,
        css_classes: ['dim-label'],
    }));
    const pending = new Gtk.Label({label: 'Waiting for a key…', css_classes: ['dim-label']});
    box.append(pending);
    const error = new Gtk.Label({
        visible: false,
        wrap: true,
        css_classes: ['error'],
    });
    box.append(error);

    // Fallback for combinations the shell grabs first (for example Super
    // shortcuts): the accelerator can also be typed directly.
    box.append(new Gtk.Separator());
    const entry = new Gtk.Entry({placeholder_text: 'or type <Super><Shift>b'});
    const setButton = new Gtk.Button({label: 'Set', css_classes: ['suggested-action']});
    const entryBox = new Gtk.Box({spacing: 6});
    entryBox.append(entry);
    entryBox.append(setButton);
    box.append(entryBox);
    toolbar.set_content(box);
    dialog.set_content(toolbar);

    const apply = value => {
        onAccept(value);
        dialog.close();
    };
    const commitEntry = () => {
        const text = entry.text.trim();
        const [ok, keyval, mask] = Gtk.accelerator_parse(text);
        if (!ok || !text) {
            error.label = 'Not a valid accelerator, for example <Super><Shift>b.';
            error.visible = true;
            return;
        }
        if (!(mask & (Gdk.ModifierType.CONTROL_MASK |
            Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK))) {
            error.label = 'Add Ctrl, Alt or Super so normal typing is not captured.';
            error.visible = true;
            return;
        }
        apply(Gtk.accelerator_name(keyval, mask));
    };
    setButton.connect('clicked', commitEntry);
    entry.connect('activate', commitEntry);

    const controller = new Gtk.EventControllerKey();
    controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (entry.has_focus())
            return Gdk.EVENT_PROPAGATE;
        if (MODIFIER_KEYVALS.has(keyval)) {
            // Wait until the user finishes the combination; a bare modifier
            // press is not an error.
            pending.label = modifierLabel(state);
            return Gdk.EVENT_PROPAGATE;
        }
        const result = validateShortcut(keyval, state);
        if (!result.ok) {
            error.label = result.reason;
            error.visible = true;
            return Gdk.EVENT_STOP;
        }
        apply(result.accelerator);
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);
    dialog.present();
}

function modifierLabel(state) {
    const names = [];
    if (state & Gdk.ModifierType.CONTROL_MASK)
        names.push('Ctrl');
    if (state & Gdk.ModifierType.ALT_MASK)
        names.push('Alt');
    if (state & Gdk.ModifierType.SUPER_MASK)
        names.push('Super');
    if (state & Gdk.ModifierType.SHIFT_MASK)
        names.push('Shift');
    return names.length ? `${names.join(' + ')} + …` : 'Waiting for a key…';
}

function addShortcutEditor(page, settings, window) {
    const KEY = 'toggle-bar';
    const group = new Adw.PreferencesGroup({
        title: 'Global shortcuts',
        description: 'Changes apply immediately. Single keys without a modifier are rejected.',
    });
    page.add(group);

    const rows = [];
    const rebuild = () => {
        for (const row of rows.splice(0))
            group.remove(row);

        const accelerators = settings.get_strv(KEY);
        accelerators.forEach((accelerator, index) => {
            const row = new Adw.ActionRow({
                title: 'Toggle dynamic bar',
                subtitle: acceleratorLabel(accelerator),
            });
            row.activatable = true;
            row.connect('activated', () => {
                openShortcutDialog(window, {
                    title: 'Toggle dynamic bar',
                    accelerator,
                    onAccept: value => {
                        const next = [...settings.get_strv(KEY)];
                        if (value === null)
                            next.splice(index, 1);
                        else
                            next[index] = value;
                        settings.set_strv(KEY, next);
                    },
                });
            });

            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                css_classes: ['flat'],
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Remove shortcut',
            });
            remove.connect('clicked', () => {
                const next = [...settings.get_strv(KEY)];
                next.splice(index, 1);
                settings.set_strv(KEY, next);
            });
            row.add_suffix(remove);
            group.add(row);
            rows.push(row);
        });

        if (accelerators.length === 0) {
            const empty = new Adw.ActionRow({
                title: 'No shortcut',
                subtitle: 'Use the + button to record one.',
            });
            group.add(empty);
            rows.push(empty);
        }
    };

    const add = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        tooltip_text: 'Add shortcut',
    });
    add.connect('clicked', () => {
        openShortcutDialog(window, {
            title: 'Toggle dynamic bar',
            accelerator: null,
            onAccept: value => {
                if (value === null)
                    return;
                const next = settings.get_strv(KEY);
                if (next.includes(value)) {
                    window.add_toast(new Adw.Toast({
                        title: `${acceleratorLabel(value)} is already assigned`,
                    }));
                    return;
                }
                next.push(value);
                settings.set_strv(KEY, next);
            },
        });
    });
    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Restore default shortcut',
    });
    reset.connect('clicked', () => settings.reset(KEY));
    const suffix = new Gtk.Box({spacing: 6});
    suffix.append(add);
    suffix.append(reset);
    group.header_suffix = suffix;

    const changedId = settings.connect(`changed::${KEY}`, rebuild);
    group.connect('destroy', () => settings.disconnect(changedId));
    rebuild();
}

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

function addIgnoredAppsEditor(group, settings) {
    const KEY = 'notification-filter';
    const rows = [];
    const rebuild = () => {
        for (const row of rows.splice(0))
            group.remove(row);

        settings.get_strv(KEY).forEach((appId, index) => {
            const row = new Adw.ActionRow({
                title: appId || '(empty)',
                subtitle: 'Ignored application ID',
            });
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                css_classes: ['flat'],
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Remove from filter',
            });
            remove.connect('clicked', () => {
                const next = [...settings.get_strv(KEY)];
                next.splice(index, 1);
                settings.set_strv(KEY, next);
            });
            row.add_suffix(remove);
            group.add(row);
            rows.push(row);
        });

        const add = new Adw.EntryRow({title: 'Add application ID'});
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        const commit = () => {
            const id = add.text.trim();
            add.text = '';
            if (!id)
                return;
            const next = settings.get_strv(KEY);
            if (next.includes(id))
                return;
            next.push(id);
            settings.set_strv(KEY, next);
        };
        addButton.connect('clicked', commit);
        add.connect('entry-activated', commit);
        add.add_suffix(addButton);
        group.add(add);
        rows.push(add);
    };

    const changedId = settings.connect(`changed::${KEY}`, rebuild);
    group.connect('destroy', () => settings.disconnect(changedId));
    rebuild();
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
        addSpinRow(islandGroup, settings, 'card-page-width', 'Card page width (px)', {min: 200, max: 500, step: 2});
        addSpinRow(islandGroup, settings, 'card-page-edge-padding',
            'Extra page side padding (px)', {min: 0, max: 32, step: 1});
        addSpinRow(islandGroup, settings, 'island-padding', 'Padding (px)', {min: 0, max: 60, step: 1});
        addSpinRow(islandGroup, settings, 'panel-top-radius', 'Fusion fillet (px)', {min: 0, max: 60, step: 1});
        addSpinRow(islandGroup, settings, 'panel-bottom-radius', 'Bottom radius (px)', {min: 0, max: 60, step: 1});
        addSpinRow(islandGroup, settings, 'compact-control-height', 'Compact control height (px)', {min: 5, max: 24, step: 1});
        addColorRow(islandGroup, settings, 'maximized-dark-color',
            'Maximized background (dark)');
        addColorRow(islandGroup, settings, 'maximized-light-color',
            'Maximized background (light)');

        const activityGroup = new Adw.PreferencesGroup({
            title: 'Activity dots',
            description: 'Collapsed indicators and the colors used by activity progress bars.',
        });
        finePage.add(activityGroup);
        addSpinRow(activityGroup, settings, 'activity-dot-size', 'Dot size (0 = bar height)', {min: 0, max: 40, step: 1});
        addSpinRow(activityGroup, settings, 'activity-dot-hit-size', 'Near-hover hit area (px)', {min: 4, max: 40, step: 1});
        addSpinRow(activityGroup, settings, 'activity-dot-hover-scale', 'Hover scale', {min: 1, max: 3, step: 0.1});
        addSpinRow(activityGroup, settings, 'activity-dot-border-width', 'Completed border (px)', {min: 0, max: 4, step: 1});
        addSwitchRow(activityGroup, settings, 'activity-auto-remove',
            'Automatically remove completed activities');
        addSpinRow(activityGroup, settings, 'activity-expiry-seconds',
            'Remove completed after (seconds)', {min: 1, max: 86400, step: 1});
        addSpinRow(activityGroup, settings, 'list-progress-height',
            'List progress thickness (logical px)', {min: 1, max: 10, step: 1});
        for (const [kind, title] of [['media', 'Media'], ['activity', 'Activity'],
            ['timer', 'Timer'], ['device', 'Device']]) {
            addColorRow(activityGroup, settings, `bar-${kind}-color`,
                `${title} dynamic bar color`);
            addSwitchRow(activityGroup, settings, `bar-${kind}-striped`,
                `${title} dynamic bar stripes`);
        }
        addColorRow(activityGroup, settings, 'activity-running-color', 'Running color');
        addColorRow(activityGroup, settings, 'activity-success-color', 'Completed color');
        addColorRow(activityGroup, settings, 'activity-paused-color', 'Paused color');
        addColorRow(activityGroup, settings, 'activity-warning-color', 'Warning/orphaned color');
        addColorRow(activityGroup, settings, 'activity-error-color', 'Error/cancelled color');
        addColorRow(activityGroup, settings, 'removable-mounted-color', 'Removable mounted ring');
        addColorRow(activityGroup, settings, 'removable-unmounted-color', 'Removable removed ring');

        const notifyGroup = new Adw.PreferencesGroup({
            title: 'Notifications',
            description: 'Size of the low-profile small notifications.',
        });
        finePage.add(notifyGroup);
        addSpinRow(notifyGroup, settings, 'small-notification-height', 'Small notification height (px)', {min: 6, max: 40, step: 1});
        addSpinRow(notifyGroup, settings, 'small-notification-font-size', 'Small notification font size (px)', {min: 6, max: 20, step: 1});

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
        addSwitchRow(featureGroup, settings, 'printing-enabled', 'Printing activities');
        addSwitchRow(featureGroup, settings, 'bluetooth-enabled', 'Bluetooth notifications');
        addSwitchRow(featureGroup, settings, 'charging-enabled', 'Charging notifications');
        addSwitchRow(featureGroup, settings, 'lock-keys-enabled', 'Lock key indicators');
        addSpinRow(featureGroup, settings, 'battery-low-threshold', 'Low battery threshold (%)', {min: 0, max: 100, step: 1});

        const filterGroup = new Adw.PreferencesGroup({
            title: 'Notification filter',
            description: 'Application IDs that are not forwarded as small notifications.',
        });
        contentPage.add(filterGroup);
        addIgnoredAppsEditor(filterGroup, settings);

        const launcherGroup = new Adw.PreferencesGroup({
            title: 'Launcher',
            description: 'Add applications or commands and customize icons, labels and Desktop actions.',
        });
        contentPage.add(launcherGroup);
        addLauncherEditor(launcherGroup, settings, window);

        const shortcutPage = new Adw.PreferencesPage({
            title: 'Shortcuts',
            icon_name: 'preferences-desktop-keyboard-symbolic',
        });
        window.add(shortcutPage);
        addShortcutEditor(shortcutPage, settings, window);
    }
}
