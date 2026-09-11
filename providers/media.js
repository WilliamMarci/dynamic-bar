import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {BarProvider, smallNotificationHeight, smallNotificationLabel}
    from '../provider.js';
import {MprisService} from '../services/mprisService.js';
import {createProgressBar} from '../progressBar.js';
import {logError} from '../log.js';

export class MediaProvider extends BarProvider {
    constructor(bar, settings, launcherProvider = null, liveActivityProvider = null) {
        super(bar);
        this._settings = settings;
        this._launcherProvider = launcherProvider;
        this._liveActivityProvider = liveActivityProvider;
        this._playerName = null;
        this._metadata = {};
        this._playing = false;
        this._trackId = null;
        this._position = 0;
        this._length = 0;
        this._canSeek = false;
        this._seekPreview = null;
        this._seekGrab = null;
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
        this._settings.connectObject('changed::compact-control-height',
            () => this.bar.cardsChanged(), this);
    }

    get isPlaying() {
        return this._playing;
    }

    get isAvailable() {
        return Boolean(this._playerName);
    }

    getLayoutOptions() {
        return {paddingX: 12, paddingY: 12, minHeight: 104};
    }

    _pageWidth() {
        return this._settings.get_int('card-page-width');
    }

    getCards() {
        if (!this.isAvailable)
            return [];
        return [{
            id: 'media',
            layout: this.getLayoutOptions(),
            createActor: () => this._createMediaPanel(),
            onDestroy: () => this._destroyMediaPanel(),
        }];
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._unsubscribe?.();
        this._service?.destroy();
        this._service = null;
        this._islandRefs = null;
        this._launcherProvider = null;
        this._liveActivityProvider = null;
    }

    _applyMediaState(state) {
        const wasAvailable = this.isAvailable;
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
        if (wasAvailable !== this.isAvailable)
            this.bar.cardsChanged();
        if (previousTrack && this._trackId !== previousTrack) {
            if (!this.bar.presentation.expanded)
                this._showTrackNotification();
            this.bar.flashProgressReset();
        } else {
            this._updateBar(true);
        }
        if (firstPlayer)
            this.bar.mediaActivated(this._progress);
        this._refreshIsland();
    }

    get _progress() {
        return this._length > 0
            ? Math.min(Math.max(this._position / this._length, 0), 1)
            : 0;
    }

    _updateBar(animate = false) {
        const active = this._playing || this._length > 0;
        this.setProgress(this._length > 0 ? this._progress : 0, active, animate);
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
        const height = smallNotificationHeight(this._settings);

        const provider = {
            createIslandActor: () => this._createTrackTicker(`♪ ${text}`),
            destroyIslandActor() {},
        };
        this.bar.notification(provider, {
            timeout: this._settings.get_int('track-flash-duration'),
            passive: true,
            width: 192,
            height,
            paddingX: 8,
            paddingY: 0,
        });
    }

    _createTrackTicker(text) {
        const height = smallNotificationHeight(this._settings);
        const viewport = new St.Widget({
            style_class: 'dynamic-bar-track-notification',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            width: 176,
            height,
        });
        const label = smallNotificationLabel(text, this._settings);
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

    _createCover(iconSize = 60) {
        const rawArtUrl = this._metadata['mpris:artUrl'];
        const artUrl = typeof rawArtUrl === 'string' ? rawArtUrl : '';
        if (!artUrl.startsWith('file://'))
            return null;

        try {
            return new St.Icon({
                gicon: Gio.icon_new_for_string(artUrl),
                icon_size: iconSize,
                style_class: 'dynamic-bar-media-cover',
            });
        } catch (error) {
            logError('Media', error, `cover ${artUrl}`);
            return null;
        }
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
        area.setProgress(fraction, {animate: false});
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
        area.setProgress(this._progress, {animate: false});
        return Clutter.EVENT_STOP;
    }

    _createProgress(width) {
        const options = this.bar.presentation.options;
        const progress = createProgressBar({
            style_class: this._canSeek
                ? 'dynamic-bar-media-progress dynamic-bar-media-progress-seekable'
                : 'dynamic-bar-media-progress',
            reactive: this._canSeek,
            width,
            height: this._canSeek ? 6 : 4,
            trackAlpha: options.trackAlpha,
            progressAlpha: options.progressAlpha,
            fillColor: [1, 1, 1],
        });
        progress.setProgress(this._progress, {animate: false});
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

    _createMarquee(text, styleClass) {        const viewport = new St.Widget({
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
        return this._createMediaPanel();
    }

    _createMediaPanel() {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-media',
        });

        const pageWidth = this._pageWidth();
        const paddingX = this.getLayoutOptions().paddingX;
        const coverSize = pageWidth < 280 ? 44 : 60;
        const top = new St.BoxLayout({style_class: 'dynamic-bar-media-top'});
        const cover = this._createCover(coverSize);
        if (cover)
            top.add_child(cover);

        const infoWidth = Math.max(88, pageWidth - paddingX * 2 -
            (cover ? coverSize + 12 : 0));
        const info = new St.BoxLayout({
            vertical: true,
            style_class: 'dynamic-bar-media-info',
            x_expand: true,
            width: infoWidth,
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
            style_class: 'dynamic-bar-media-button', can_focus: true,
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
        const progress = this._createProgress(infoWidth);
        info.add_child(progress);
        top.add_child(info);
        box.add_child(top);

        this._islandRefs = {title, subtitle, progress, playIcon, source};
        progress.queue_repaint();
        return box;
    }

    _destroyMediaPanel() {
        this._seekGrab?.dismiss();
        this._seekGrab = null;
        this._seekPreview = null;
        this._islandRefs = null;
    }

    destroyIslandActor() {
        this._destroyMediaPanel();
    }

    _refreshIsland() {
        if (!this.bar.isShown(this))
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
        refs.progress.setProgress(this._progress, {animate: true});
        this.bar.refresh();
    }

    _updateIslandProgress() {
        if (!this.bar.isShown(this))
            return;
        this._islandRefs?.progress?.setProgress(this._progress, {animate: true});
    }
}
