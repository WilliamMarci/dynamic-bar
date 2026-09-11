import Clutter from 'gi://Clutter';
import St from 'gi://St';

export function smallNotificationHeight(settings, fallback = 10) {
    return settings?.get_int?.('small-notification-height') ?? fallback;
}

export function smallNotificationLabel(text, settings) {
    const label = new St.Label({
        text,
        style_class: 'dynamic-bar-track-notification-label',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const size = settings?.get_int?.('small-notification-font-size') ?? 8;
    label.set_style(`font-size: ${size}px;`);
    return label;
}

export class BarProvider {
    constructor(api) {
        this._api = api;
    }

    get bar() {
        return this._api;
    }

    /** Publish persistent progress in the dynamic bar. */
    setProgress(value, active = true, animate = false) {
        this._api.progress(value, active, animate);
    }

    /** Publish or clear persistent status content in an icon zone. */
    setStatus(id, actor) {
        this._api.status(id, actor);
    }

    /** Publish temporary content that restores the previous presentation. */
    pushNotification(options = {}) {
        this._api.notification(this, options);
    }

    /** Content-owned spacing; the API does not impose feature layout policy. */
    getLayoutOptions() {
        return {};
    }

    /**
     * Peer-switchable cards contributed to the island deck. Each entry is
     * `{id, createActor, onDestroy?, layout?}`. The deck owns navigation,
     * measurement and interaction; features never build their own tabs.
     */
    getCards() {
        return [];
    }

    /** Optional page expanded below the deck control strip. */
    getAttachedPage() {
        return null;
    }

    /** @returns {Clutter.Actor|null} actor shown inside the dynamic island */
    createIslandActor() {
        return null;
    }

    destroyIslandActor() {
    }

    destroy() {
    }
}
