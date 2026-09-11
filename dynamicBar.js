import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BarBackground, IslandBackground} from './barBackground.js';
import {DynamicBarApi} from './api.js';
import {findPanelStyleActor, readPanelColor,
    readPanelTransitionDuration} from './panelStyle.js';

export const DEFAULTS = {
    barWidth: 72,
    barLongWidth: 144,
    barHeight: 4,
    barRadius: 2,
    barGap: 2,
    barAlpha: 0.20,
    barHoverAlpha: 0.55,
    trackAlpha: 0.20,
    progressAlpha: 0.90,
    islandMinWidth: 212,
    islandMinHeight: 38,
    islandTopRadius: 8,
    islandBottomRadius: 8,
    islandPadding: 10,
    hoverDuration: 140,
    expandDuration: 180,
    collapseDuration: 180,
    autoCollapseDelay: 1200,
    notificationDecay: 2500,
    trackFlashDuration: 1200,
    animationsEnabled: true,
};

const ZONE_SIZE = 20;
const ZONE_GAP = 4;
const PANEL_COLOR_POLL = 100;

export const DynamicBar = GObject.registerClass({
    Signals: {
        'expanded-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class DynamicBar extends GObject.Object {
    /**
     * @param {object} [params]
     * @param {Gio.Settings} [params.settings] extension settings
     * @param {Function} [params.openPreferences] callback for the settings button
     */
    _init(params = {}) {
        super._init();

        this._settings = params.settings ?? null;
        this._openPreferences = params.openPreferences ?? null;
        this._options = {...DEFAULTS};
        this._defaultProvider = null;
        this._mediaProvider = null;
        this._liveActivityProvider = null;
        this._contentProvider = null;
        this._islandContent = null;
        this._expanded = false;
        this._pinned = false;
        this._hovered = false;
        this._destroyed = false;
        this._collapseTimerId = 0;
        this._notificationTimerId = 0;
        this._notification = null;
        this._passiveExpanded = false;
        this._contentSize = null;
        this._providerLayout = null;
        this._pollId = 0;
        this._stageEventId = 0;
        this._leftFlashTimerId = 0;
        this._leftFlashActor = null;
        this._indicators = new Map();
        this._activities = new Map();
        this._activityPreviewTimerId = 0;
        this._progress = 0;
        this._progressActive = false;
        this._islandWidth = 0;
        this._islandHeight = 0;
        this._panelColorActor = null;
        this.api = new DynamicBarApi(this);
        this._initialLayoutId = 0;
        this._interactionTimerId = 0;
        this._layoutReady = false;

        this._actor = new St.Widget({
            name: 'dynamicBar',
            style_class: 'dynamic-bar',
            clip_to_allocation: true,
        });
        this._actor.opacity = 0;

        this._island = new IslandBackground({
            topRadius: this._options.islandTopRadius,
            bottomRadius: this._options.islandBottomRadius,
        });
        this._island.reactive = true;
        this._island.track_hover = true;
        this._actor.add_child(this._island);

        this._islandHolder = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
        });
        this._actor.add_child(this._islandHolder);

        this._bar = new BarBackground({
            radius: this._options.barRadius,
            alpha: this._options.barAlpha,
        });
        this._bar.reactive = true;
        this._bar.track_hover = true;
        this._actor.add_child(this._bar);

        this._leftZone = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
        });
        this._rightZone = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
        });
        this._actor.add_child(this._leftZone);
        this._actor.add_child(this._rightZone);
        this._activityBox = new St.BoxLayout({style_class: 'dynamic-bar-activities'});
        this._leftZone.add_child(this._activityBox);

        this._island.connectObject(
            'notify::hover', () => this._onHoverChanged(),
            'notify::allocation', () => this._syncIslandHolder(),
            'notify::translation-y', () => this._syncIslandHolder(),
            this);
        this._bar.connectObject(
            'notify::hover', () => this._onHoverChanged(),
            'notify::allocation', () => this._syncBarDependents(),
            'notify::x', () => this._syncBarDependents(),
            'notify::y', () => this._syncBarDependents(),
            'notify::width', () => this._syncBarDependents(),
            'button-press-event', (_actor, event) => this._onBarPress(event),
            this);

        Main.layoutManager.addTopChrome(this._actor, {trackFullscreen: true});

        this._panelBox = Main.layoutManager.panelBox;
        this._panelBox.connectObject('notify::allocation',
            () => this._syncLayout(), this);
        Main.layoutManager.connectObject('monitors-changed',
            () => this._syncLayout(), this);
        Main.overview.connectObject('showing',
            () => this.collapse(), this);
        Main.sessionMode.connectObject('updated', () => {
            if (Main.sessionMode.isLocked)
                this.collapse();
        }, this);

        this._stageEventId = global.stage.connect('captured-event',
            (_stage, event) => this._onCapturedEvent(event));

        this._settings?.connectObject('changed',
            () => this._onSettingsChanged(), this);

        this._reloadOptions();
        this._updatePanelColor(false);
        this._syncLayout();
        this._initialLayoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250,
            () => {
                this._initialLayoutId = 0;
                this._layoutReady = true;
                this._syncLayout();
                return GLib.SOURCE_REMOVE;
            });
    }

    get actor() {
        return this._actor;
    }

    get options() {
        return this._options;
    }

    get expanded() {
        return this._expanded;
    }

    get pinned() {
        return this._pinned;
    }

    get currentProvider() {
        return this._contentProvider;
    }

    setDefaultProvider(provider) {
        this._defaultProvider = provider;
    }

    setMediaProvider(provider) {
        this._mediaProvider = provider;
    }

    setLiveActivityProvider(provider) {
        this._liveActivityProvider = provider;
    }

    openPreferences() {
        this._openPreferences?.();
    }

    expandPrimary() {
        const provider = this._mediaProvider?.isAvailable
            ? this._mediaProvider
            : this._liveActivityProvider?.hasActivities
                ? this._liveActivityProvider
                : this._defaultProvider;
        if (!provider)
            return;
        if (!this.expandWith(provider) && provider !== this._defaultProvider)
            this.expandWith(this._defaultProvider);
    }

    expandWith(provider, {timeout = 0} = {}) {
        if (this._destroyed || !this._actor.visible)
            return false;

        this._cancelNotification(false);
        this._cancelCollapseTimer();
        this._passiveExpanded = false;
        this._contentSize = null;
        this._updatePanelColor(true);

        if (!this._expanded) {
            this._expanded = true;
            if (!this._setIslandContent(provider)) {
                this._expanded = false;
                this._passiveExpanded = false;
                this._contentSize = null;
                return false;
            }
            this._syncBarPaint();
            this._startPolling();
            this.emit('expanded-changed', true);
            this._animateState(true, {fromCollapsed: true});
        } else if (provider !== this._contentProvider) {
            if (!this._setIslandContent(provider))
                return false;
        }

        if (timeout > 0)
            this._scheduleCollapse(timeout);
        return true;
    }

    notify(provider, timeout, options = {}) {
        if (this._destroyed || !this._actor.visible)
            return;
        if (this._settings && !this._settings.get_boolean('notifications-enabled'))
            return false;

        if (!this._notification) {
            this._notification = {
                expanded: this._expanded,
                provider: this._contentProvider,
                passive: this._passiveExpanded,
                contentSize: this._contentSize,
            };
        }

        this._cancelNotificationTimer();
        this._cancelCollapseTimer();
        this._passiveExpanded = options.passive ?? true;
        this._contentSize = {
            width: options.width ?? 0,
            height: options.height ?? 0,
            paddingX: options.paddingX ?? options.padding ?? null,
            paddingY: options.paddingY ?? options.padding ?? null,
        };
        this._updatePanelColor(true);

        if (!this._expanded) {
            this._expanded = true;
            if (!this._setIslandContent(provider)) {
                this._restoreNotification();
                return false;
            }
            this._startPolling();
            this.emit('expanded-changed', true);
            this._animateState(true, {fromCollapsed: true});
        } else {
            if (!this._setIslandContent(provider)) {
                this._restoreNotification();
                return false;
            }
        }
        this._syncBarPaint();

        if (options.pulse)
            this._showNotificationPulse(timeout);

        if (timeout > 0) {
            this._notificationTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, timeout, () => {
                    this._notificationTimerId = 0;
                    this._restoreNotification();
                    return GLib.SOURCE_REMOVE;
                });
        }
        return true;
    }

    collapse() {
        if (this._destroyed || !this._expanded || this._pinned)
            return;

        this._cancelNotification(false);
        this._expanded = false;
        this._passiveExpanded = false;
        this._contentSize = null;
        this._cancelCollapseTimer();
        this._stopPolling();
        this._syncBarPaint();
        this.emit('expanded-changed', false);
        this._animateState(false);
    }

    toggle() {
        if (this._notification) {
            this._cancelNotification(false);
            this._expanded = false;
            this.expandPrimary();
        } else if (this._expanded)
            this.collapse();
        else
            this.expandPrimary();
    }

    /** while pinned, hover and clicks outside do not collapse the bar */
    setPinned(pinned) {
        this._pinned = pinned;
        if (!pinned && !this._hovered && this._expanded)
            this._scheduleCollapse(this._options.autoCollapseDelay);
    }

    holdOpen(duration = 1500) {
        if (this._destroyed || !this._expanded)
            return;
        this._cancelCollapseTimer();
        if (this._interactionTimerId)
            GLib.source_remove(this._interactionTimerId);
        this._interactionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            duration, () => {
                this._interactionTimerId = 0;
                if (!this._hovered)
                    this._scheduleCollapse(this._options.autoCollapseDelay);
                return GLib.SOURCE_REMOVE;
            });
    }

    setBarProgress(progress, active) {
        if (this._destroyed || !this._bar)
            return;
        this._progress = progress;
        this._progressActive = active;
        this._syncBarPaint();
    }

    setProgress(progress, active = true) {
        this.setBarProgress(progress, active);
    }

    setStatus(id, actor) {
        this.setRightIndicator(id, actor);
    }

    setActivity(id, activity) {
        if (activity)
            this._activities.set(id, activity === true ? {} : activity);
        else
            this._activities.delete(id);
        this._activityBox.remove_all_children();
        for (const [activityId, state] of this._activities) {
            const dot = new St.Button({
                style_class: `dynamic-bar-activity-dot ${state.status ??
                    (state.completed ? 'success' : 'running')}`,
                width: this._options.barHeight,
                height: this._options.barHeight,
                can_focus: true,
            });
            dot.connect('clicked', () => {
                if (Number.isFinite(state.progress))
                    this.previewActivityProgress(state.progress);
                state.onClick?.(activityId);
            });
            this._activityBox.add_child(dot);
        }
        this._syncLayout();
    }

    previewActivityProgress(progress) {
        if (this._activityPreviewTimerId)
            GLib.source_remove(this._activityPreviewTimerId);
        this._bar.setActivityPreview(progress);
        this._activityPreviewTimerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, 1800, () => {
                this._activityPreviewTimerId = 0;
                this._syncBarPaint();
                return GLib.SOURCE_REMOVE;
            });
    }

    playMediaActivation(progress) {
        this._bar.playActivation(progress, 480);
    }

    pushNotification(provider, options = {}) {
        this.notify(provider,
            options.timeout ?? this._options.notificationDecay, options);
    }

    flashTrackChange() {
        if (this._expanded && !this._passiveExpanded)
            return;
        this._bar.setProgress(1, true);
        this._bar.easeProgress(0, 180);
    }

    flashLeftIcon(actor, duration) {
        this._cancelLeftFlash();
        if (this._interactionTimerId) {
            GLib.source_remove(this._interactionTimerId);
            this._interactionTimerId = 0;
        }
        if (this._initialLayoutId) {
            GLib.source_remove(this._initialLayoutId);
            this._initialLayoutId = 0;
        }
        actor.x_align = Clutter.ActorAlign.END;
        actor.y_align = Clutter.ActorAlign.CENTER;
        this._leftZone.add_child(actor);
        this._leftZone.queue_relayout();
        this._leftFlashActor = actor;
        this._syncLayout();

        this._leftFlashTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            duration, () => {
                this._leftFlashTimerId = 0;
                if (this._leftFlashActor === actor)
                    this._removeLeftFlash(actor);
                return GLib.SOURCE_REMOVE;
            });
    }

    setRightIndicator(id, actor) {
        if (this._destroyed || !this._rightZone)
            return;
        const old = this._indicators.get(id);
        if (old === actor)
            return;

        if (old) {
            this._rightZone.remove_child(old);
            old.destroy();
        }

        if (actor) {
            actor.x_align = Clutter.ActorAlign.START;
            actor.y_align = Clutter.ActorAlign.CENTER;
            this._rightZone.add_child(actor);
            this._indicators.set(id, actor);
        } else {
            this._indicators.delete(id);
        }

        this._rightZone.queue_relayout();
        this._syncLayout();
    }

    refreshIslandSize() {
        if (this._destroyed || !this._expanded)
            return;
        this._syncIslandSize();
        this._syncRootGeometry();
        this._syncIslandGeometry();
        this._syncBarGeometry();
    }

    rebuildProvider(provider) {
        if (this._destroyed || !this._expanded ||
            this._contentProvider !== provider)
            return;
        this._setIslandContent(provider);
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;

        if (this._activityPreviewTimerId)
            GLib.source_remove(this._activityPreviewTimerId);

        this._cancelCollapseTimer();
        this._cancelNotification(false);
        this._stopPolling();
        this._cancelLeftFlash();

        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }

        this._actor.disconnectObject(this);
        this._island.disconnectObject(this);
        this._bar.disconnectObject(this);
        this._panelBox.disconnectObject(this);
        this._panelColorActor?.disconnectObject(this);
        this._settings?.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);

        this._contentProvider?.destroyIslandActor?.();
        this._contentProvider = null;
        this._islandContent = null;

        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
        this._actor = null;
        this._island = null;
        this._islandHolder = null;
        this._bar = null;
        this._leftZone = null;
        this._rightZone = null;
        this._panelBox = null;
        this._panelColorActor = null;
        this._leftFlashActor = null;
    }

    _showNotificationPulse(duration) {
        const size = Math.max(2, this._options.barHeight);
        const dot = new St.Widget({
            style_class: 'dynamic-bar-notification-pulse',
            width: size,
            height: size,
        });
        dot.set_pivot_point(0.5, 0.5);
        this.flashLeftIcon(dot, duration || this._options.notificationDecay);
        const breathe = () => {
            if (dot.is_destroyed?.() || !dot.get_parent())
                return;
            dot.ease({
                opacity: dot.opacity < 200 ? 255 : 90,
                scale_x: dot.scale_x < 1 ? 1.25 : 0.8,
                scale_y: dot.scale_y < 1 ? 1.25 : 0.8,
                duration: 550,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                onComplete: breathe,
            });
        };
        dot.opacity = 90;
        dot.scale_x = 0.8;
        dot.scale_y = 0.8;
        breathe();
    }

    _cancelNotificationTimer() {
        if (!this._notificationTimerId)
            return;
        GLib.source_remove(this._notificationTimerId);
        this._notificationTimerId = 0;
    }

    _cancelNotification(restore) {
        this._cancelNotificationTimer();
        if (!this._notification)
            return;
        if (restore) {
            this._restoreNotification();
            return;
        }
        this._notification = null;
        this._passiveExpanded = false;
        this._contentSize = null;
        this._cancelLeftFlash();
    }

    _restoreNotification() {
        const previous = this._notification;
        if (!previous)
            return;

        this._notification = null;
        this._cancelLeftFlash();
        this._passiveExpanded = previous.passive;
        this._contentSize = previous.contentSize;

        if (previous.expanded) {
            if (!this._setIslandContent(previous.provider) &&
                previous.provider !== this._defaultProvider)
                this._setIslandContent(this._defaultProvider);
            this._syncBarPaint();
            this._animateState(true);
        } else {
            this._expanded = false;
            this._passiveExpanded = false;
            this._contentSize = null;
            this._stopPolling();
            this._syncBarPaint();
            this.emit('expanded-changed', false);
            this._animateState(false);
        }
    }

    _removeLeftFlash(actor) {
        if (this._leftFlashActor !== actor)
            return;
        this._leftFlashActor = null;
        if (actor.get_parent())
            this._leftZone.remove_child(actor);
        actor.destroy();
    }

    _cancelLeftFlash() {
        if (this._leftFlashTimerId) {
            GLib.source_remove(this._leftFlashTimerId);
            this._leftFlashTimerId = 0;
        }
        if (this._leftFlashActor) {
            const actor = this._leftFlashActor;
            this._leftFlashActor = null;
            if (actor.get_parent())
                this._leftZone.remove_child(actor);
            actor.destroy();
        }
    }

    _onBarPress(event) {
        if (this._destroyed || event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        this.toggle();
        return Clutter.EVENT_STOP;
    }

    _onCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;

        if (this._destroyed || !this._expanded || this._pinned)
            return Clutter.EVENT_PROPAGATE;

        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        const target = global.stage.get_event_actor(event);
        if (this._contains(target))
            return Clutter.EVENT_PROPAGATE;

        this.collapse();
        return Clutter.EVENT_PROPAGATE;
    }

    _contains(actor) {
        for (let current = actor; current; current = current.get_parent()) {
            if (current === this._actor)
                return true;
        }
        return false;
    }

    _onHoverChanged() {
        const hovered = this._bar.hover ||
            (this._expanded && this._island.hover);
        if (hovered === this._hovered)
            return;

        this._hovered = hovered;
        this._bar.setAlpha(hovered
            ? this._options.barHoverAlpha
            : this._options.barAlpha);

        if (!this._expanded) {
            const currentWidth = this._bar.width || this._options.barWidth;
            const targetWidth = hovered
                ? this._options.barLongWidth
                : this._options.barWidth;
            this._bar.ease({
                x: Math.round(this._bar.x + (currentWidth - targetWidth) / 2),
                width: targetWidth,
                duration: this._options.hoverDuration,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else if (this._notification) {
            return;
        } else if (this._interactionTimerId) {
            this._cancelCollapseTimer();
            return;
        } else if (hovered) {
            this._cancelCollapseTimer();
        } else {
            this._scheduleCollapse(this._options.autoCollapseDelay);
        }
    }

    _scheduleCollapse(delay) {
        this._cancelCollapseTimer();
        if (delay <= 0)
            return;

        this._collapseTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay,
            () => {
                this._collapseTimerId = 0;
                this.collapse();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelCollapseTimer() {
        if (!this._collapseTimerId)
            return;
        GLib.source_remove(this._collapseTimerId);
        this._collapseTimerId = 0;
    }

    _startPolling() {
        if (this._pollId)
            return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PANEL_COLOR_POLL,
            () => {
                this._updatePanelColor(true);
                return GLib.SOURCE_CONTINUE;
            });
    }

    _stopPolling() {
        if (!this._pollId)
            return;
        GLib.source_remove(this._pollId);
        this._pollId = 0;
    }

    _updatePanelColor(animated) {
        if (this._destroyed || !this._island)
            return;

        const color = readPanelColor(this._settings ? {
            dark: this._settings.get_string('maximized-dark-color'),
            light: this._settings.get_string('maximized-light-color'),
        } : null);
        const duration = animated ? readPanelTransitionDuration() : 0;
        this._island.setColor(color, duration);

        const actor = findPanelStyleActor();
        if (actor === this._panelColorActor)
            return;

        this._panelColorActor?.disconnectObject(this);
        this._panelColorActor = actor;
        actor?.connectObject('style-changed',
            () => this._updatePanelColor(true), this);
    }

    _onSettingsChanged() {
        this._reloadOptions();
        this._syncLayout();
        this._updatePanelColor(false);
    }

    _reloadOptions() {
        const settings = this._settings;
        const read = (key, fallback, type) => {
            if (!settings)
                return fallback;
            return type === 'd'
                ? settings.get_double(key)
                : settings.get_int(key);
        };
        const readBoolean = (key, fallback) => settings
            ? settings.get_boolean(key)
            : fallback;

        this._options = {
            barWidth: read('handle-width', DEFAULTS.barWidth),
            barLongWidth: read('bar-long-width', DEFAULTS.barLongWidth),
            barHeight: read('handle-height', DEFAULTS.barHeight),
            barRadius: read('handle-radius', DEFAULTS.barRadius),
            barGap: read('handle-gap', DEFAULTS.barGap),
            barAlpha: read('handle-alpha', DEFAULTS.barAlpha, 'd'),
            barHoverAlpha: read('handle-hover-alpha', DEFAULTS.barHoverAlpha, 'd'),
            trackAlpha: read('bar-track-alpha', DEFAULTS.trackAlpha, 'd'),
            progressAlpha: read('bar-progress-alpha', DEFAULTS.progressAlpha, 'd'),
            islandMinWidth: read('panel-width', DEFAULTS.islandMinWidth),
            islandMinHeight: read('panel-height', DEFAULTS.islandMinHeight),
            islandTopRadius: read('panel-top-radius', DEFAULTS.islandTopRadius),
            islandBottomRadius: read('panel-bottom-radius', DEFAULTS.islandBottomRadius),
            islandPadding: read('island-padding', DEFAULTS.islandPadding),
            hoverDuration: read('hover-duration', DEFAULTS.hoverDuration),
            expandDuration: read('expand-duration', DEFAULTS.expandDuration),
            collapseDuration: read('collapse-duration', DEFAULTS.collapseDuration),
            autoCollapseDelay: read('auto-collapse-delay', DEFAULTS.autoCollapseDelay),
            notificationDecay: read('notification-decay', DEFAULTS.notificationDecay),
            trackFlashDuration: read('track-flash-duration', DEFAULTS.trackFlashDuration),
            animationsEnabled: readBoolean('animations-enabled',
                DEFAULTS.animationsEnabled),
        };

        if (!this._island)
            return;

        this._island.setRadii(this._options.islandTopRadius,
            this._options.islandBottomRadius);
        this._bar.setRadius(this._options.barRadius);
        this._bar.setAlpha(this._hovered
            ? this._options.barHoverAlpha
            : this._options.barAlpha);
        this._bar.setTrackAlpha(this._options.trackAlpha);
        this._bar.setProgressAlpha(this._options.progressAlpha);
        this._syncBarPaint();
    }

    _syncBarPaint() {
        if (!this._bar)
            return;
        this._bar.setProgress(this._progress,
            this._progressActive && (!this._expanded || this._passiveExpanded));
    }

    _setIslandContent(provider) {
        this._clearIslandContent();

        this._contentProvider = provider;
        this._providerLayout = provider?.getLayoutOptions?.() ?? null;

        if (provider) {
            let actor = null;
            try {
                actor = provider.createIslandActor();
            } catch (error) {
                console.error(`Dynamic Bar provider failed to create content: ${error}`);
                this._contentProvider = null;
                this._providerLayout = null;
                return false;
            }
            if (actor) {
                actor.x_align = Clutter.ActorAlign.CENTER;
                actor.y_align = Clutter.ActorAlign.CENTER;
                this._islandHolder.add_child(actor);
                this._islandContent = actor;
            } else {
                this._contentProvider = null;
                this._providerLayout = null;
                return false;
            }
        }

        this._islandHolder.queue_relayout();
        this._syncIslandSize();
        this._syncRootGeometry();
        this._syncIslandGeometry();
        this._syncBarGeometry();
        return true;
    }

    _clearIslandContent() {
        if (!this._islandContent)
            return;
        this._islandHolder.remove_child(this._islandContent);
        this._islandContent.destroy();
        this._islandContent = null;
        this._contentProvider?.destroyIslandActor?.();
        this._contentProvider = null;
        this._providerLayout = null;
    }

    _measureIsland() {
        const options = this._options;

        if (!this._islandContent) {
            return {
                width: options.islandMinWidth,
                height: options.islandMinHeight,
            };
        }

        const [, naturalWidth] = this._islandContent.get_preferred_width(-1);
        const [, naturalHeight] = this._islandContent.get_preferred_height(naturalWidth);

        const layout = this._providerLayout ?? {};
        const paddingX = this._contentSize?.paddingX ?? layout.paddingX ??
            options.islandPadding;
        const paddingY = this._contentSize?.paddingY ?? layout.paddingY ??
            options.islandPadding;
        return {
            width: Math.max(this._contentSize?.width ?? 0,
                this._notification ? 0 : layout.minWidth ?? options.islandMinWidth,
                Math.ceil(naturalWidth) + paddingX * 2),
            height: Math.max(this._contentSize?.height ?? 0,
                this._notification ? 0 : layout.minHeight ?? options.islandMinHeight,
                Math.ceil(naturalHeight) + paddingY * 2),
        };
    }

    _syncIslandSize() {
        const {width, height} = this._measureIsland();
        this._islandWidth = width;
        this._islandHeight = height;
    }

    _syncRootGeometry() {
        const monitor = Main.layoutManager.primaryMonitor;
        const panelBox = this._panelBox;
        if (!monitor || !panelBox || panelBox.width <= 0 || panelBox.height <= 0)
            return;

        const options = this._options;
        const [, panelY] = panelBox.get_transformed_position();
        const [, leftNatural] = this._leftZone.get_preferred_width(-1);
        const [, rightNatural] = this._rightZone.get_preferred_width(-1);
        const sideWidth = Math.max(ZONE_SIZE, leftNatural, rightNatural);
        const rootWidth = Math.max(options.barLongWidth, this._islandWidth) +
            (sideWidth + ZONE_GAP) * 2;
        // A thin bar needs space on both sides of its center for indicators.
        // Start the root above the panel edge by the required upper half.
        const topInset = this._expanded
            ? Math.max(0, Math.ceil((ZONE_SIZE - options.barHeight) / 2))
            : 0;
        const barAndZoneTail = Math.ceil(
            (options.barHeight + Math.max(options.barHeight, ZONE_SIZE)) / 2);
        const rootHeight = topInset + this._islandHeight + options.barGap +
            barAndZoneTail;

        this._rootX = Math.round(monitor.x + (monitor.width - rootWidth) / 2);
        this._rootY = Math.round(panelY + panelBox.height - topInset);
        this._rootWidth = rootWidth;
        this._rootHeight = rootHeight;
        this._sideWidth = sideWidth;
        this._topInset = topInset;

        this._actor.set_position(this._rootX, this._rootY);
        this._actor.set_size(rootWidth, rootHeight);
        this._actor.opacity = this._layoutReady ? 255 : 0;
    }

    _syncIslandGeometry() {
        if (!this._island)
            return;
        const topInset = this._topInset ?? 0;
        const x = Math.round((this._rootWidth - this._islandWidth) / 2);
        this._island.set_position(x, topInset);
        this._island.set_size(this._islandWidth, this._islandHeight);
        this._island.translation_y = this._expanded
            ? 0
            : -(this._islandHeight + topInset);
        this._syncIslandHolder();
    }

    _syncIslandHolder() {
        if (!this._islandHolder || !this._island)
            return;
        const [x, y] = this._island.get_position();
        this._islandHolder.set_position(x, y);
        this._islandHolder.set_size(this._island.width, this._island.height);
        this._islandHolder.translation_y = this._island.translation_y;
        this._islandHolder.queue_relayout();
    }

    _syncBarGeometry() {
        if (!this._bar)
            return;
        const options = this._options;
        const width = this._expanded
            ? (this._passiveExpanded
                ? (this._hovered ? options.barLongWidth : options.barWidth)
                : options.barLongWidth)
            : (this._hovered ? options.barLongWidth : options.barWidth);
        const y = (this._topInset ?? 0) + options.barGap +
            (this._expanded ? this._islandHeight : 0);
        this._bar.set_position(Math.round((this._rootWidth - width) / 2), y);
        this._bar.set_size(width, options.barHeight);
        this._bar.setAlpha(this._hovered
            ? options.barHoverAlpha
            : options.barAlpha);
        this._syncBarDependents();
    }

    _syncBarDependents() {
        if (!this._bar || !this._leftZone || !this._rightZone)
            return;
        const [barX, barY] = this._bar.get_position();
        const barWidth = this._bar.width;
        const barHeight = this._bar.height;
        const sideWidth = this._sideWidth ?? ZONE_SIZE;
        const zoneSize = this._expanded ? ZONE_SIZE : barHeight;
        const centeredY = Math.round(barY + (barHeight - zoneSize) / 2);
        const zoneY = Math.max(0,
            Math.min(centeredY, this._rootHeight - zoneSize));

        this._leftZone.set_position(
            Math.round(barX - ZONE_GAP - sideWidth), zoneY);
        this._leftZone.set_size(sideWidth, zoneSize);
        this._rightZone.set_position(Math.round(barX + barWidth + ZONE_GAP), zoneY);
        this._rightZone.set_size(sideWidth, zoneSize);
    }

    _syncLayout() {
        if (this._destroyed)
            return;
        this._syncIslandSize();
        this._syncRootGeometry();
        this._syncIslandGeometry();
        this._syncBarGeometry();
        this._syncStatusScale(false);
    }

    _syncStatusScale(animate, duration = 0) {
        if (!this._rightZone)
            return;
        // LockBadge is 7px tall. In the collapsed state scale the complete
        // status actor to the configured bar height and keep its center fixed.
        const collapsed = !this._expanded;
        for (const actor of this._rightZone.get_children()) {
            const children = actor.get_children?.() ?? [];
            for (const child of children)
                child.setCollapsed?.(collapsed, this._options.barHeight,
                    animate, duration);
        }
    }

    _animateState(expanded, {fromCollapsed = false} = {}) {
        const options = this._options;
        const duration = !options.animationsEnabled ? 0 : expanded
            ? options.expandDuration
            : options.collapseDuration;
        const mode = Clutter.AnimationMode.EASE_OUT_CUBIC;
        const barWidth = (expanded && !this._passiveExpanded) || this._hovered
            ? options.barLongWidth
            : options.barWidth;
        const collapsedBarY = (this._topInset ?? 0) + options.barGap;
        const hiddenIslandY = -(this._islandHeight + (this._topInset ?? 0));
        const barY = collapsedBarY + (expanded ? this._islandHeight : 0);
        const barX = Math.round((this._rootWidth - barWidth) / 2);

        this._bar.setAlpha(this._hovered
            ? options.barHoverAlpha
            : options.barAlpha);
        this._syncStatusScale(true, duration);

        if (expanded) {
            this._bar.ease({x: barX, width: barWidth, y: barY, duration, mode});
            if (fromCollapsed)
                this._island.translation_y = hiddenIslandY;
            this._island.ease({translation_y: 0, duration, mode});
        } else {
            // Phase 1 only retracts vertically. Preserve the exact horizontal
            // geometry already visible instead of forcing a configured width.
            this._bar.ease({
                y: collapsedBarY,
                duration,
                mode,
            });
            this._island.ease({
                translation_y: hiddenIslandY,
                duration,
                mode,
                onComplete: () => {
                    if (this._destroyed || this._expanded)
                        return;
                    const [stageBarX] = this._bar.get_transformed_position();
                    const phaseOneWidth = this._bar.width;
                    this._clearIslandContent();
                    this._contentSize = null;
                    this._syncIslandSize();
                    this._syncRootGeometry();
                    this._syncIslandGeometry();

                    // Root width may change after removing provider content.
                    // Restore the phase-one bar in stage coordinates first.
                    const phaseOneX = Math.round(stageBarX - this._rootX);
                    const finalBarY = (this._topInset ?? 0) + options.barGap;
                    this._bar.set_position(phaseOneX, finalBarY);
                    this._bar.set_size(phaseOneWidth, options.barHeight);

                    // Phase 2 decides from the current collapsed state whether
                    // the bar actually needs to change width.
                    const targetWidth = this._hovered
                        ? options.barLongWidth
                        : options.barWidth;
                    const targetX = Math.round(
                        (this._rootWidth - targetWidth) / 2);
                    this._bar.ease({
                        x: targetX,
                        width: targetWidth,
                        y: finalBarY,
                        duration,
                        mode,
                        onComplete: () => {
                            if (this._destroyed || this._expanded)
                                return;
                            this._bar.set_position(targetX, finalBarY);
                            this._bar.set_size(targetWidth, options.barHeight);
                            this._syncBarDependents();
                        },
                    });
                },
            });
        }
    }
});
