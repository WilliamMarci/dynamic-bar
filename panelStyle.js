import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FALLBACK_COLOR = [0, 0, 0, 0.65];
const DEFAULT_TRANSITION = 200;
let dashToPanelSettings;
let triedDashToPanelSettings = false;
let interfaceSettings;

function colorToArray(color) {
    return [
        color.red / 255,
        color.green / 255,
        color.blue / 255,
        color.alpha / 255,
    ];
}

function parseColor(text) {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
    if (hex) {
        const value = hex[1].length === 3
            ? [...hex[1]].map(char => char + char).join('')
            : hex[1];
        return [
            parseInt(value.slice(0, 2), 16) / 255,
            parseInt(value.slice(2, 4), 16) / 255,
            parseInt(value.slice(4, 6), 16) / 255,
            1,
        ];
    }
    const match = /rgba?\(([^)]+)\)/.exec(text);
    if (!match)
        return null;

    const parts = match[1].split(',').map(value => parseFloat(value.trim()));
    if (parts.length < 3 || parts.some(value => Number.isNaN(value)))
        return null;

    return [
        parts[0] / 255,
        parts[1] / 255,
        parts[2] / 255,
        parts.length > 3 ? parts[3] : 1,
    ];
}

function getDashToPanelGradient() {
    if (!triedDashToPanelSettings) {
        triedDashToPanelSettings = true;
        try {
            const schemaDir = GLib.build_filenamev([
                GLib.get_user_data_dir(), 'gnome-shell', 'extensions',
                'dash-to-panel@jderose9.github.com', 'schemas',
            ]);
            const parent = Gio.SettingsSchemaSource.get_default();
            const source = Gio.SettingsSchemaSource.new_from_directory(
                schemaDir, parent, false);
            const schema = source.lookup(
                'org.gnome.shell.extensions.dash-to-panel', true);
            if (schema)
                dashToPanelSettings = Gio.Settings.new_full(schema, null, null);
        } catch {
            dashToPanelSettings = null;
        }
    }

    if (!dashToPanelSettings?.get_boolean('trans-use-custom-gradient'))
        return null;
    const bottom = parseColor(dashToPanelSettings.get_string(
        'trans-gradient-bottom-color'));
    if (!bottom)
        return null;
    bottom[3] = dashToPanelSettings.get_double(
        'trans-gradient-bottom-opacity');
    return bottom;
}

function sourceOver(foreground, background) {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    if (alpha <= 0)
        return [0, 0, 0, 0];

    return [
        (foreground[0] * foreground[3] +
            background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] +
            background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] +
            background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
    ];
}

function hasOpaqueTopWindow() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor)
        return false;
    const right = monitor.x + monitor.width;
    for (const actor of global.get_window_actors()) {
        const window = actor.meta_window;
        if (!window || window.minimized ||
            window.get_monitor() !== Main.layoutManager.primaryIndex)
            continue;
        const rect = window.get_frame_rect();
        const maximized = window.maximized_vertically &&
            window.maximized_horizontally;
        const fillsTop = rect.y <= monitor.y + 2 &&
            rect.x <= monitor.x + 2 && rect.x + rect.width >= right - 2;
        if (maximized || fillsTop)
            return true;
    }
    return false;
}

function maximizedColor(colors, fallback) {
    try {
        interfaceSettings ??= new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        const scheme = interfaceSettings.get_string('color-scheme');
        const requested = scheme.includes('light')
            ? colors?.light
            : colors?.dark;
        const parsed = requested ? parseColor(requested) : null;
        if (parsed)
            return [parsed[0], parsed[1], parsed[2], 1];
    } catch {
    }
    return [fallback[0], fallback[1], fallback[2], 1];
}

export function findPanelStyleActor() {
    for (let actor = Main.panel;
        actor && actor !== Main.layoutManager.uiGroup;
        actor = actor.get_parent()) {
        const node = actor.get_theme_node?.();
        if (!node)
            continue;
        if (node.get_background_color().alpha > 0)
            return actor;
    }
    return null;
}

export function readPanelGradient() {
    const style = Main.panel.get_style() ?? '';
    const startMatch = /background-gradient-start:\s*([^;]+)/.exec(style);
    const endMatch = /background-gradient-end:\s*([^;]+)/.exec(style);

    if (!startMatch || !endMatch)
        return null;

    const start = parseColor(startMatch[1]);
    const end = parseColor(endMatch[1]);
    return start && end ? {start, end} : null;
}

export function readPanelColor(maximizedColors = null) {
    const actor = findPanelStyleActor();
    const base = actor
        ? colorToArray(actor.get_theme_node().get_background_color())
        : null;

    const forceOpaque = color => hasOpaqueTopWindow()
        ? maximizedColor(maximizedColors, color)
        : color;

    const dashBottom = getDashToPanelGradient();
    if (dashBottom)
        return forceOpaque(sourceOver(dashBottom, base ?? FALLBACK_COLOR));

    const gradient = readPanelGradient();
    if (gradient) {
        // Dash to Panel can override the panel theme gradient: the panel is
        // darker at its bottom edge, and the island sits right below it.
        return forceOpaque(sourceOver(gradient.end, base ?? FALLBACK_COLOR));
    }

    return forceOpaque(base ?? FALLBACK_COLOR);
}

export function readPanelTransitionDuration() {
    const style = Main.panel.get_style() ?? '';
    const match = /transition-duration:\s*([\d.]+)ms/.exec(style);
    return match
        ? Math.max(50, Math.round(parseFloat(match[1])))
        : DEFAULT_TRANSITION;
}
