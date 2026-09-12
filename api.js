export const EventKind = Object.freeze({
    PROGRESS: 'progress',
    STATUS: 'status',
    NOTIFICATION: 'notification',
});

/** Stable provider-facing API. Geometry and animation remain DynamicBar-owned. */
export class DynamicBarApi {
    constructor(controller) {
        this._controller = controller;
    }

    progress(value, active = true, animate = false, style = {}) {
        this._controller.setProgress(value, active, animate, style);
    }

    status(id, actor) {
        this._controller.setStatus(id, actor);
    }

    activityDot(id, state = true) {
        this._controller.setActivityDot(id, state);
    }

    /** Compatibility alias for providers written before the dot registry. */
    activity(id, state = true) {
        this.activityDot(id, state);
    }

    notification(provider, options = {}) {
        this._controller.pushNotification(provider, options);
    }

    expand(provider) {
        this._controller.expandWith(provider);
    }

    collapse() {
        this._controller.collapse();
    }

    refresh() {
        this._controller.refreshIslandSize();
    }

    rebuild(provider) {
        this._controller.rebuildProvider(provider);
    }

    /** True while the given provider's card/page/content is on screen. */
    isShown(provider) {
        return this._controller.isProviderShown(provider);
    }

    /** Ask the island to re-collect cards from all providers. */
    cardsChanged() {
        this._controller.cardsChanged();
    }

    /** Focus a deck card by id (also when the island is currently collapsed). */
    focusCard(id) {
        this._controller.focusCard(id);
    }

    holdOpen(duration = 1500) {
        this._controller.holdOpen(duration);
    }

    get presentation() {
        return Object.freeze({
            expanded: this._controller.expanded,
            provider: this._controller.currentProvider,
            options: this._controller.options,
        });
    }

    openPreferences() {
        this._controller.openPreferences();
    }

    flashProgressReset() {
        this._controller.flashTrackChange();
    }

    mediaActivated(progress) {
        this._controller.playMediaActivation(progress);
    }
}
