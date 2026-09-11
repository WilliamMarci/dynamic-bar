import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {BarProvider} from '../provider.js';
import {MprisService} from '../services/mprisService.js';
import {IslandControlContainer} from './controlContainer.js';

function drawRoundedRect(cr, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);

    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

export class MediaProvider extends BarProvider {
    constructor(bar, settings, launcherProvider = null, liveActivityProvider = null) {
        super(bar);
        this._settings = settings;
        this._launcherProvider = launcherProvider;
        this._liveActivityProvider = liveActivityProvider;
        this._unsubscribeLive = liveActivityProvider?.subscribe(() => {
            const presentation = this.bar.presentation;
            if (presentation.expanded && presentation.provider === this)
                this.bar.rebuild(this);
        }) ?? null;
        this._playerName = null;
        this._metadata = {};
        this._playing = false;
        this._trackId = null;
        this._position = 0;
        this._length = 0;
        this._canSeek = false;
        this._seekPreview = null;
        this._seekGrab = null;
        this._controlContainer = null;
        this._islandRefs = null;
        this._service = null;
        this._unsubscribe = null;
        try {
            this._service = new MprisService();
            this._unsubscribe = this._service.subscribe(state =>
                this._applyMediaState(state));
        } catch (error) {
            console.error(`Dynamic Bar MPRIS service unavailable: ${error}`);
        }
        this._settings.connectObject('changed::launcher-apps', () => {
            this._controlContainer?.rebuildActivePage();
            this.bar.refresh();
        }, 'changed::launcher-items', () => {
            this._controlContainer?.rebuildActivePage();
            this.bar.refresh();
        }, 'changed::compact-control-height', () =>
            this._controlContainer?.syncHeight(), this);
    }

    get isPlaying() {
        return this._playing;
    }

    get isAvailable() {
        return Boolean(this._playerName);
    }

    getLayoutOptions() {
        return {paddingX: 24, paddingY: 14, minWidth: 372, minHeight: 116};
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._unsubscribe?.();
        this._unsubscribeLive?.();
        this._service?.destroy();
        this._service = null;
        this._islandRefs = null;
        this._launcherProvider = null;
        this._liveActivityProvider = null;
    }

    _applyMediaState(state) {
        const firstPlayer = !this._playerName && Boolean(state.name);
        const previousTrack = this._trackId;
        this._playerName = state.name;
        this._metadata = state.metadata;
        this._playing = state.playing;
        this._position = state.position;
        this._length = state.length;
        this._canSeek = state.canSeek;
        this._identity = state.identity;
        this._trackId = state.metadata['mpris:trackid'] ?? null;
        const logKey = `${state.name}|${state.playing}|${this._trackId}|${state.length}`;
        if (logKey !== this._lastLogKey) {
            this._lastLogKey = logKey;
            console.log(`[Dynamic Bar][Media] player=${state.identity || 'none'} ` +
                `playing=${state.playing} title=${this._title() || '(none)'} ` +
                `length=${state.length || 'unknown'}`);
        }
        if (previousTrack && this._trackId !== previousTrack) {
            this._showTrackNotification();
            this.bar.flashProgressReset();
        }
        this._updateBar();
        if (firstPlayer)
            this.bar.mediaActivated(this._progress);
        this._refreshIsland();
    }

    get _progress() {
        return this._length > 0
            ? Math.min(Math.max(this._position / this._length, 0), 1)
            : 0;
    }

    _updateBar() {
        this.setProgress(this._length > 0 ? this._progress : 0,
            this._playing);
    }

    _title() {
        return this._metadata['xesam:title'] ?? '';
    }

    _artists() {
        const artists = this._metadata['xesam:artist'] ?? [];
        return Array.isArray(artists) ? artists.join(', ') : String(artists);
    }

    _sourceName() {
        return this._identity ?? '';
    }

    _subtitle() {
        const parts = [];
        const artists = this._artists();
        if (artists)
            parts.push(artists);
        const album = this._metadata['xesam:album'];
        if (album)
            parts.push(album);
        return parts.join(' | ');
    }

    _composer() {
        const composers = this._metadata['xesam:composer'];
        if (Array.isArray(composers) && composers.length > 0)
            return composers.join(', ');
        if (composers)
            return String(composers);
        return this._artists();
    }

    _showTrackNotification() {
        const text = [this._composer(), this._title()]
            .filter(Boolean).join(' - ');
        if (!text)
            return;

        const provider = {
            createIslandActor: () => this._createTrackTicker(text),
            destroyIslandActor() {},
        };
        this.bar.notification(provider, {
            timeout: this._settings.get_int('track-flash-duration'),
            passive: true,
            width: 192,
            height: 10,
            paddingX: 8,
            paddingY: 0,
        });
    }

    _createTrackTicker(text) {
        const viewport = new St.Widget({
            style_class: 'dynamic-bar-track-notification',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            width: 176,
            height: 10,
        });
        const label = new St.Label({
            text,
            style_class: 'dynamic-bar-track-notification-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        viewport.add_child(label);

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!label.get_parent())
                return GLib.SOURCE_REMOVE;
            const [, naturalWidth] = label.get_preferred_width(-1);
            const overflow = Math.max(0, naturalWidth - viewport.width);
            if (overflow > 0) {
                label.ease({
                    translation_x: -overflow,
                    duration: Math.max(1800, overflow * 35),
                    mode: Clutter.AnimationMode.LINEAR,
                    repeatCount: -1,
                    autoReverse: true,
                });
            }
            return GLib.SOURCE_REMOVE;
        });
        return viewport;
    }

    _call(method) {
        this._service?.call(method);
    }

    _button(iconName, callback) {
        const button = new St.Button({
            style_class: 'dynamic-bar-media-button',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 18}),
        });
        button.connect('clicked', () => {
            this.bar.holdOpen(1800);
            callback();
        });
        return button;
    }

    _createCover() {
        const rawArtUrl = this._metadata['mpris:artUrl'];
        const artUrl = typeof rawArtUrl === 'string' ? rawArtUrl : '';
        if (!artUrl.startsWith('file://'))
            return null;

        try {
            return new St.Icon({
                gicon: Gio.icon_new_for_string(artUrl),
                icon_size: 60,
                style_class: 'dynamic-bar-media-cover',
            });
        } catch {
            return null;
        }
    }

    _paintProgress(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();

        if (width > 0 && height > 0) {
            const options = this.bar.presentation.options;
            drawRoundedRect(cr, 0, 0, width, height, height / 2);
            cr.setSourceRGBA(1, 1, 1, options.trackAlpha);
            cr.fill();
            const progressWidth = width * (this._seekPreview ?? this._progress);
            if (progressWidth > 0) {
                drawRoundedRect(cr, 0, 0, progressWidth, height,
                    Math.min(height / 2, progressWidth / 2));
                cr.setSourceRGBA(1, 1, 1, options.progressAlpha);
                cr.fill();
            }
        }

        cr.$dispose();
    }

    _seekFraction(area, event) {
        const [stageX, stageY] = event.get_coords();
        const [ok, localX] = area.transform_stage_point(stageX, stageY);
        if (!ok || area.width <= 0)
            return null;
        return Math.min(Math.max(localX / area.width, 0), 1);
    }

    _updateSeek(area, event) {
        const fraction = this._seekFraction(area, event);
        if (fraction === null)
            return;
        this._seekPreview = fraction;
        area.queue_repaint();
        this.bar.holdOpen(1800);
    }

    _finishSeek(area, event) {
        if (!this._seekGrab)
            return Clutter.EVENT_PROPAGATE;
        this._updateSeek(area, event);
        const fraction = this._seekPreview;
        this._seekGrab.dismiss();
        this._seekGrab = null;
        if (fraction !== null)
            this._service?.seekTo(fraction);
        this._seekPreview = null;
        area.queue_repaint();
        return Clutter.EVENT_STOP;
    }

    _createProgress() {
        const progress = new St.DrawingArea({
            style_class: this._canSeek
                ? 'dynamic-bar-media-progress dynamic-bar-media-progress-seekable'
                : 'dynamic-bar-media-progress',
            reactive: this._canSeek,
            track_hover: this._canSeek,
        });
        progress.set_height(this._canSeek ? 6 : 4);
        progress.connect('repaint', () => this._paintProgress(progress));
        progress.connect('button-press-event', (_actor, event) => {
            if (!this._canSeek || this._seekGrab)
                return Clutter.EVENT_PROPAGATE;
            this._seekGrab = global.stage.grab(progress);
            this._updateSeek(progress, event);
            return Clutter.EVENT_STOP;
        });
        progress.connect('motion-event', (_actor, event) => {
            if (!this._seekGrab)
                return Clutter.EVENT_PROPAGATE;
            this._updateSeek(progress, event);
            return Clutter.EVENT_STOP;
        });
        progress.connect('button-release-event', (_actor, event) =>
            this._finishSeek(progress, event));
        return progress;
    }

    _createControlContainer() {
        this._controlContainer = new IslandControlContainer(this._settings,
            () => {
                this.bar.holdOpen(1800);
                this.bar.refresh();
            });
        if (this._launcherProvider) {
            this._controlContainer.addPage('launcher', () =>
                this._launcherProvider.createIslandActor());
        }
        if (this._liveActivityProvider?.hasActivities) {
            this._controlContainer.addPage('live-activities', () =>
                this._liveActivityProvider.createIslandActor());
        }
        return this._controlContainer.createActor();
    }

    _createMarquee(text, styleClass) {
        const viewport = new St.Widget({
            style_class: 'dynamic-bar-media-marquee',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
        });
        const label = new St.Label({
            text,
            style_class: styleClass,
            x_align: Clutter.ActorAlign.START,
        });
        label.clutter_text.single_line_mode = true;
        viewport.add_child(label);
        const ref = {viewport, label};
        this._restartMarquee(ref, true);
        return ref;
    }

    _restartMarquee(ref, force = false, text = null) {
        if (text !== null && !force && ref.label.text === text)
            return;
        if (text !== null)
            ref.label.text = text;
        ref.label.remove_all_transitions();
        ref.label.translation_x = 0;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!ref.label.get_parent())
                return GLib.SOURCE_REMOVE;
            const [, naturalWidth] = ref.label.get_preferred_width(-1);
            const overflow = Math.max(0, naturalWidth - ref.viewport.width);
            if (overflow > 0) {
                ref.label.ease({
                    translation_x: -overflow,
                    duration: Math.max(2200, overflow * 32),
                    mode: Clutter.AnimationMode.LINEAR,
                    repeatCount: -1,
                    autoReverse: true,
                });
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    createIslandActor() {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-media',
        });

        const top = new St.BoxLayout({style_class: 'dynamic-bar-media-top'});
        const cover = this._createCover();
        if (cover)
            top.add_child(cover);

        const info = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-media-info',
            x_expand: true,
            width: 270,
        });
        const title = this._createMarquee(this._title(),
            'dynamic-bar-media-title');
        const subtitle = this._createMarquee(this._subtitle(),
            'dynamic-bar-media-subtitle');
        const controls = new St.Widget({
            style_class: 'dynamic-bar-media-controls',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        const controlButtons = new St.BoxLayout({
            style_class: 'dynamic-bar-media-control-buttons',
            x_align: Clutter.ActorAlign.CENTER,
        });
        controlButtons.add_child(this._button('media-skip-backward-symbolic',
            () => this._call('Previous')));
        const playIcon = new St.Icon({
            icon_name: this._playing
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic',
            icon_size: 18,
        });
        const playButton = new St.Button({
            style_class: 'dynamic-bar-media-button',
            can_focus: true,
            child: playIcon,
        });
        playButton.connect('clicked', () => {
            this.bar.holdOpen(1800);
            this._call('PlayPause');
        });
        controlButtons.add_child(playButton);
        controlButtons.add_child(this._button('media-skip-forward-symbolic',
            () => this._call('Next')));
        controls.add_child(controlButtons);

        const source = new St.Label({
            text: this._sourceName(),
            style_class: 'dynamic-bar-media-source',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        controls.add_child(source);

        // Metadata stays left-aligned; playback controls are centered below it.
        info.add_child(title.viewport);
        info.add_child(subtitle.viewport);
        info.add_child(controls);
        const progress = this._createProgress();
        info.add_child(progress);
        top.add_child(info);
        box.add_child(top);
        box.add_child(this._createControlContainer());

        this._islandRefs = {title, subtitle, progress, playIcon, source};
        return box;
    }

    destroyIslandActor() {
        this._seekGrab?.dismiss();
        this._seekGrab = null;
        this._seekPreview = null;
        this._controlContainer?.destroy();
        this._controlContainer = null;
        this._islandRefs = null;
    }

    _refreshIsland() {
        const presentation = this.bar.presentation;
        if (!presentation.expanded || presentation.provider !== this)
            return;
        const refs = this._islandRefs;
        if (!refs)
            return;

        this._restartMarquee(refs.title, false, this._title());
        this._restartMarquee(refs.subtitle, false, this._subtitle());
        refs.playIcon.icon_name = this._playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        refs.source.text = this._sourceName();
        refs.progress.reactive = this._canSeek;
        refs.progress.track_hover = this._canSeek;
        refs.progress.style_class = this._canSeek
            ? 'dynamic-bar-media-progress dynamic-bar-media-progress-seekable'
            : 'dynamic-bar-media-progress';
        refs.progress.set_height(this._canSeek ? 6 : 4);
        refs.progress.queue_repaint();
        this.bar.refresh();
    }

    _updateIslandProgress() {
        const presentation = this.bar.presentation;
        if (!presentation.expanded || presentation.provider !== this)
            return;
        this._islandRefs?.progress?.queue_repaint();
    }
}
