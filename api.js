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

    progress(value, active = true) {
        this._controller.setProgress(value, active);
    }

    status(id, actor) {
        this._controller.setStatus(id, actor);
    }

    activity(id, active = true) {
        this._controller.setActivity(id, active);
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
