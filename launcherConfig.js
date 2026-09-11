import {logError} from './log.js';

export function getLauncherItems(settings) {
    try {
        const parsed = JSON.parse(settings.get_string('launcher-items'));
        // An explicitly saved empty list means the user removed everything;
        // only migrate the legacy strv before this key has a user value.
        if (Array.isArray(parsed) && (parsed.length > 0 ||
            settings.get_user_value('launcher-items') !== null))
            return parsed.map(normalizeItem);
    } catch (error) {
        logError('LauncherConfig', error, 'parse launcher-items');
    }
    return settings.get_strv('launcher-apps').map(desktopId =>
        normalizeItem({desktopId}));
}

export function normalizeItem(item = {}) {
    return {
        desktopId: String(item.desktopId ?? ''),
        name: String(item.name ?? ''),
        showName: Boolean(item.showName),
        iconMode: ['desktop', 'theme', 'custom'].includes(item.iconMode)
            ? item.iconMode
            : 'desktop',
        icon: String(item.icon ?? ''),
        command: String(item.command ?? ''),
        action: String(item.action ?? ''),
    };
}

export function saveLauncherItems(settings, items) {
    settings.set_string('launcher-items', JSON.stringify(items.map(normalizeItem)));
}
