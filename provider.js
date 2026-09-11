export class BarProvider {
    constructor(api) {
        this._api = api;
    }

    get bar() {
        return this._api;
    }

    /** Publish persistent progress in the dynamic bar. */
    setProgress(value, active = true) {
        this._api.progress(value, active);
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

    /** @returns {Clutter.Actor|null} actor shown inside the dynamic island */
    createIslandActor() {
        return null;
    }

    destroyIslandActor() {
    }

    destroy() {
    }
}
