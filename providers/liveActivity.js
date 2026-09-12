import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {BarProvider, smallNotificationHeight, smallNotificationLabel}
    from '../provider.js';
import {createIconButton} from '../controls.js';
import {createProgressBar} from '../progressBar.js';
import {logError, logWarning} from '../log.js';

function colorToRgb(value) {
    const text = String(value || '').trim();
    let match = text.match(/^#([0-9a-f]{6})$/i);
    if (match) {
        const hex = match[1];
        return [
            parseInt(hex.slice(0, 2), 16) / 255,
            parseInt(hex.slice(2, 4), 16) / 255,
            parseInt(hex.slice(4, 6), 16) / 255,
        ];
    }
    match = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match)
        return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
    return [1, 1, 1];
}

export const LIVE_BUS_NAME = 'org.gnome.Shell.Extensions.DynamicBar.LiveActivity';
export const LIVE_OBJECT_PATH = '/org/gnome/Shell/Extensions/DynamicBar/LiveActivity';
const PROTOCOL_VERSION = 2;
const TERMINAL_STATES = new Set(['success', 'warning', 'error', 'cancelled', 'expired']);
const XML = `<node><interface name="${LIVE_BUS_NAME}">
  <method name="GetCapabilities"><arg type="u" direction="out"/><arg type="as" direction="out"/></method>
  <method name="StartV2"><arg type="s" direction="in"/></method>
  <method name="UpdateV2"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
  <method name="FinishV2"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
  <method name="Heartbeat"><arg type="s" direction="in"/></method>
  <method name="Dismiss"><arg type="s" direction="in"/></method>
  <method name="Inspect"><arg type="s" direction="out"/></method>
  <method name="Timer"><arg type="s" direction="in"/><arg type="s" direction="in"/>
    <arg type="u" direction="in"/></method>
  <signal name="ActionRequested"><arg type="s"/><arg type="s"/></signal>
  <method name="Start"><arg type="s" direction="in"/><arg type="s" direction="in"/>
    <arg type="s" direction="in"/><arg type="u" direction="in"/></method>
  <method name="Update"><arg type="s" direction="in"/><arg type="d" direction="in"/></method>
  <method name="Complete"><arg type="s" direction="in"/><arg type="i" direction="in"/></method>
</interface></node>`;

function now() {
    return Date.now();
}

function safeJson(text, fallback = {}) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' ? value : fallback;
    } catch (error) {
        logWarning('Activity', `Invalid JSON payload: ${error.message}`);
        return fallback;
    }
}

export class LiveActivityProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._tasks = new Map();
        this._listeners = new Set();
        this._publishedDots = new Set();
        this._internalCallbacks = new Map();
        this._timers = new Map();
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-bar']);
        this._stateFile = Gio.File.new_for_path(GLib.build_filenamev([
            this._cacheDir, 'activities.json']));
        this._selectedId = null;
        this._selectedUntil = 0;
        this._flashId = null;
        this._flashTimerId = 0;
        this._cardSignature = '';
        this._cardsChangedId = 0;
        this._load();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._dbus.export(Gio.DBus.session, LIVE_OBJECT_PATH);
        this._ownerId = Gio.bus_own_name_on_connection(Gio.DBus.session,
            LIVE_BUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null);
        this._cleanupId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15,
            () => this._housekeeping());
        this._publishDots();
    }

    get hasActivities() { return this._tasks.size > 0; }
    subscribe(callback) { this._listeners.add(callback); return () => this._listeners.delete(callback); }
    registerInternal(input, callbacks = {}) {
        const id = String(input.id);
        this._internalCallbacks.set(id, callbacks);
        this.StartV2(JSON.stringify({...input, id}));
        return id;
    }
    updateInternal(id, update) { this.UpdateV2(id, JSON.stringify(update)); }
    finishInternal(id, result) { this.FinishV2(id, JSON.stringify(result)); }
    GetCapabilities() { return [PROTOCOL_VERSION, ['lifecycle', 'heartbeat', 'actions',
        'logs', 'progress:determinate', 'progress:indeterminate', 'progress:steps',
        'progress:elapsed', 'groups', 'priority']]; }
    Inspect() { return [JSON.stringify([...this._tasks.values()])]; }

    Timer(id, title, seconds) {
        const timer = {remaining: seconds, deadline: GLib.get_monotonic_time() + seconds * 1e6,
            paused: false, sourceId: 0};
        const update = () => {
            if (!timer.paused)
                timer.remaining = Math.max(0, (timer.deadline - GLib.get_monotonic_time()) / 1e6);
            if (timer.remaining <= 0) {
                timer.sourceId = 0;
                this.finishInternal(id, {status: 'success', summary: 'Timer completed'});
                this._timers.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            this.updateInternal(id, {progress: {kind: 'determinate',
                value: 1 - timer.remaining / seconds}, summary: `${Math.ceil(timer.remaining)}s remaining`});
            return GLib.SOURCE_CONTINUE;
        };
        const startSource = () => {
            if (!timer.sourceId)
                timer.sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, update);
        };
        const pause = () => { if (!timer.paused) { update(); timer.paused = true;
            if (timer.sourceId) GLib.source_remove(timer.sourceId);
            timer.sourceId = 0;
            this.updateInternal(id, {status: 'paused'}); } };
        const resume = () => { if (timer.paused) { timer.paused = false;
            timer.deadline = GLib.get_monotonic_time() + timer.remaining * 1e6;
            this.updateInternal(id, {status: 'running'}); startSource(); } };
        const end = () => { if (timer.sourceId) GLib.source_remove(timer.sourceId);
            timer.sourceId = 0; this._timers.delete(id);
            this.finishInternal(id, {status: 'cancelled', summary: 'Timer ended'}); };
        this.registerInternal({id, title: title || 'Timer', source: 'dynamic-bar', type: 'timer',
            group: 'timer', heartbeat: false, silentStart: true,
            progress: {kind: 'determinate', value: 0},
            actions: [{id: 'pause', label: 'Pause'}, {id: 'resume', label: 'Resume'},
                {id: 'skip', label: 'Skip'}, {id: 'end', label: 'End', dangerous: true}]},
        {pause, resume, skip: () => {
            if (timer.sourceId) GLib.source_remove(timer.sourceId);
            timer.sourceId = 0; timer.remaining = 0; update();
        }, end});
        startSource();
        this._timers.set(id, timer);
        update();
        this._notifyTimerStarted(title || 'Timer', seconds);
    }

    Start(id, title, command, terminalPid) {
        this.StartV2(JSON.stringify({id, title: title || command, source: 'island-run',
            type: 'command', terminalPid, progress: {kind: 'indeterminate'}}));
    }
    Update(id, progress) { this.UpdateV2(id, JSON.stringify({progress: {kind: 'determinate', value: progress}})); }
    Complete(id, exitCode) { this.FinishV2(id, JSON.stringify({status: exitCode === 0 ? 'success' : 'error', exitCode})); }

    StartV2(payload) {
        const input = safeJson(payload);
        if (!input.id) return;
        const timestamp = now();
        const task = {
            id: String(input.id), title: String(input.title || input.command || input.id),
            source: String(input.source || 'third-party'), type: String(input.type || 'task'),
            group: String(input.group || `${input.source || 'third-party'}:${input.type || 'task'}`),
            priority: Number(input.priority) || 0, status: input.status ?? 'running',
            progress: input.progress ?? {kind: 'indeterminate'}, actions: input.actions ?? [],
            terminalPid: Number(input.terminalPid) || 0,
            summary: String(input.summary || ''), logPath: String(input.logPath || ''), exitCode: null,
            ring: typeof input.ring === 'string' ? input.ring : null,
            indicator: input.indicator && typeof input.indicator === 'object'
                ? input.indicator : null,
            createdAt: timestamp, updatedAt: timestamp,
            expiresAt: Number(input.expiresAt) || 0,
            // Provider-owned tasks can opt out of heartbeat expiry; a client
            // task that stops heartbeating is only marked orphaned, never failed.
            heartbeatTimeout: input.heartbeat === false ? 0
                : Number(input.heartbeatTimeout) || 45000,
        };
        this._tasks.set(task.id, task);
        this._sync(task);
        if (!input.silentStart) this._notifySmall(`${task.title} started`);
    }

    UpdateV2(id, payload) {
        const task = this._tasks.get(id);
        if (!task || TERMINAL_STATES.has(task.status)) return;
        const update = safeJson(payload);
        for (const key of ['status', 'progress', 'summary', 'logPath', 'actions',
            'priority', 'indicator']) {
            if (update[key] !== undefined) task[key] = update[key];
        }
        task.updatedAt = now();
        this._sync(task);
    }

    FinishV2(id, payload) {
        const task = this._tasks.get(id);
        if (!task) return;
        const result = safeJson(payload);
        task.status = result.status ?? 'success';
        task.exitCode = result.exitCode ?? null;
        task.summary = String(result.summary ?? task.summary ?? '');
        task.logPath = String(result.logPath ?? task.logPath ?? '');
        if (result.actions) task.actions = result.actions;
        if (result.ring) task.ring = result.ring;
        if (result.progress) task.progress = result.progress;
        else if (task.status === 'success') task.progress = {kind: 'determinate', value: 1};
        task.updatedAt = now();
        if (!task.expiresAt && this._settings.get_boolean('activity-auto-remove'))
            task.expiresAt = task.updatedAt +
                this._settings.get_int('activity-expiry-seconds') * 1000;
        this._sync(task);
        this._notifyComplete(task);
    }

    Heartbeat(id) {
        const task = this._tasks.get(id);
        if (!task || TERMINAL_STATES.has(task.status)) return;
        task.updatedAt = now();
        if (task.status === 'orphaned') task.status = 'running';
        this._sync(task);
    }

    Dismiss(id) {
        if (!this._tasks.delete(id)) {
            logWarning('Activity', 'Dismiss ignored because id was not found', id);
            return;
        }
        this._internalCallbacks.delete(id);
        const timer = this._timers.get(id);
        if (timer?.sourceId)
            GLib.source_remove(timer.sourceId);
        this._timers.delete(id);
        console.log(`[Dynamic Bar][Activity] dismissed ${id}`);
        this._changed();
    }

    _sync(_task) { this._changed(); }
    _publishDots() {
        const ids = new Set(this._tasks.keys());
        for (const old of this._publishedDots) {
            if (!ids.has(old)) this.bar.activityDot(old, false);
        }
        for (const task of this._tasks.values()) {
            const progress = task.progress?.kind === 'determinate'
                ? Number(task.progress.value) : NaN;
            this.bar.activityDot(task.id, {status: task.status, progress,
                kind: task.group === 'timer' ? 'timer'
                    : task.group === 'device' ? 'device' : 'activity',
                ring: task.ring, createdAt: task.createdAt,
                onClick: () => this._focusTask(task)});
        }
        this._publishedDots = ids;
    }

    _changed() {
        this._publishDots();
        this._persist();
        for (const listener of this._listeners) listener();
        const signature = this.getCards().map(card => card.id).join('|');
        const visible = this.bar.isShown(this);
        if (signature === this._cardSignature && !visible)
            return;
        this._cardSignature = signature;
        // Never destroy the clicked row from inside its own event callback.
        // Coalesce timer bursts and rebuild after event dispatch completes.
        if (!this._cardsChangedId) {
            this._cardsChangedId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,
                () => {
                    this._cardsChangedId = 0;
                    try { this.bar.cardsChanged(); }
                    catch (error) { logError('Activity', error, 'refresh cards'); }
                    return GLib.SOURCE_REMOVE;
                });
        }
    }

    _housekeeping() {
        const timestamp = now();
        for (const task of [...this._tasks.values()]) {
            if (task.expiresAt > 0 && timestamp >= task.expiresAt) {
                task.status = 'expired';
                this.Dismiss(task.id);
            } else if (!TERMINAL_STATES.has(task.status) && task.status !== 'orphaned' &&
                task.heartbeatTimeout > 0 &&
                timestamp - task.updatedAt > task.heartbeatTimeout) {
                task.status = 'orphaned';
                this._sync(task);
            }
        }
        return GLib.SOURCE_CONTINUE;
    }

    _persist() {
        try {
            GLib.mkdir_with_parents(this._cacheDir, 0o700);
            const metadata = [...this._tasks.values()].map(task => ({...task,
                actions: task.actions?.map(action => ({id: action.id, label: action.label,
                    icon: action.icon, dangerous: action.dangerous})) ?? []}));
            this._stateFile.replace_contents(JSON.stringify(metadata), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (error) { logError('Activity', error, 'persist metadata'); }
    }

    _load() {
        try {
            const [ok, bytes] = this._stateFile.load_contents(null);
            if (!ok) return;
            for (const stored of safeJson(new TextDecoder().decode(bytes), [])) {
                if (!stored.id) continue;
                if (stored.terminalPid > 0 &&
                    !GLib.file_test(`/proc/${stored.terminalPid}`, GLib.FileTest.EXISTS)) {
                    logWarning('Activity', 'Discarding stale local activity', stored.id);
                    continue;
                }
                if (stored.expiresAt > 0 && now() >= stored.expiresAt)
                    continue;
                if (!TERMINAL_STATES.has(stored.status)) stored.status = 'orphaned';
                if (stored.status === 'orphaned' && !stored.expiresAt)
                    stored.expiresAt = now() + 300000;
                this._tasks.set(stored.id, stored);
            }
            this._persist();
        } catch (error) {
            if (error.code !== Gio.IOErrorEnum.NOT_FOUND)
                logError('Activity', error, 'restore metadata');
        }
    }

    _notifySmall(text) {
        const height = smallNotificationHeight(this._settings);
        this.bar.notification({createIslandActor: () =>
            smallNotificationLabel(text, this._settings), destroyIslandActor() {}},
        {timeout: 1200, passive: true, height, paddingX: 8, paddingY: 0});
    }

    _notifyComplete(task) {
        this.bar.notification({createIslandActor: () => {
            const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
            box.add_child(new St.Icon({icon_name: task.status === 'success'
                ? 'object-select-symbolic' : 'dialog-error-symbolic', icon_size: 22}));
            box.add_child(new St.Label({text: task.status === 'success'
                ? `${task.title} completed` : `${task.title} ${task.status}`,
            style_class: 'dynamic-bar-notice-title'})); return box;}, destroyIslandActor() {}},
        {timeout: 2800, passive: true, paddingX: 16, paddingY: 10});
    }

    _notifyTimerStarted(title, seconds) {
        this.bar.notification({createIslandActor: () => {
            const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
            box.add_child(new St.Icon({icon_name: 'alarm-symbolic', icon_size: 22}));
            const labels = new St.BoxLayout({vertical: true});
            labels.add_child(new St.Label({text: title,
                style_class: 'dynamic-bar-notice-title'}));
            labels.add_child(new St.Label({text: `Timer started · ${seconds}s`,
                style_class: 'dynamic-bar-notice-label'}));
            box.add_child(labels);
            return box;
        }, destroyIslandActor() {}}, {timeout: 2600, passive: true,
            paddingX: 16, paddingY: 10});
    }

    _requestAction(task, actionId) {
        if (actionId === 'dismiss') { this.Dismiss(task.id); return; }
        if (actionId === 'open-log' && task.logPath) {
            Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(task.logPath).get_uri(), null);
            return;
        }
        const callback = this._internalCallbacks.get(task.id)?.[actionId];
        if (callback) { callback(); return; }
        this._dbus.emit_signal('ActionRequested', new GLib.Variant('(ss)', [task.id, actionId]));
    }

    _hasTasks(predicate) {
        for (const task of this._tasks.values()) {
            if (predicate(task))
                return true;
        }
        return false;
    }

    getCards() {
        if (!this.hasActivities)
            return [];
        const cards = [];
        const layout = {paddingX: 10, paddingY: 7};
        const specialized = task => task.group === 'timer' ||
            task.group === 'device' || task.type === 'print';
        if (this._hasTasks(task => !specialized(task))) {
            cards.push({id: 'live-activities', layout,
                createActor: () => this._createList(task => !specialized(task)),
                onDestroy: () => {}});
        }
        if (this._hasTasks(task => task.group === 'timer')) {
            cards.push({
                id: 'timer',
                layout,
                createActor: () => this._createList(task => task.group === 'timer'),
                onDestroy: () => {},
            });
        }
        if (this._hasTasks(task => task.group === 'device')) {
            cards.push({
                id: 'device',
                layout,
                createActor: () => this._createList(task => task.group === 'device'),
                onDestroy: () => {},
            });
        }
        if (this._hasTasks(task => task.type === 'print')) {
            cards.push({
                id: 'printing',
                layout,
                createActor: () => this._createList(task => task.type === 'print'),
                onDestroy: () => {},
            });
        }
        return cards;
    }

    createIslandActor() {
        return this._createList(() => true);
    }

    _createList(filter) {
        const list = new St.BoxLayout({vertical: true, style_class: 'dynamic-bar-live-list'});
        const rank = status => ({error: 5, warning: 4, orphaned: 3, running: 2,
            paused: 1, success: 0}[status] ?? 0);
        const held = task => this._selectedId === task.id && now() < this._selectedUntil;
        const groups = new Map();
        for (const task of this._tasks.values()) {
            if (!filter(task))
                continue;
            if (!groups.has(task.group)) groups.set(task.group, []);
            groups.get(task.group).push(task);
        }
        const ordered = [...groups.entries()].sort(([, a], [, b]) =>
            (Math.max(...b.map(task => rank(task.status))) +
                (b.some(held) ? 100 : 0)) -
            (Math.max(...a.map(task => rank(task.status))) +
                (a.some(held) ? 100 : 0)) ||
            Math.max(...b.map(task => task.priority)) - Math.max(...a.map(task => task.priority)));
        for (const [group, tasks] of ordered) {
            tasks.sort((a, b) => (rank(b.status) + (held(b) ? 100 : 0)) -
                (rank(a.status) + (held(a) ? 100 : 0)) ||
                b.priority - a.priority || b.updatedAt - a.updatedAt);
            for (const task of tasks) list.add_child(this._createRow(task));
        }
        return list;
    }

    _activityStatusColor(status) {
        const options = this.bar.presentation.options;
        switch (status) {
        case 'success': return options.activitySuccessColor;
        case 'paused': return options.activityPausedColor;
        case 'warning':
        case 'orphaned': return options.activityWarningColor;
        case 'error':
        case 'cancelled': return options.activityErrorColor;
        default: return options.activityRunningColor;
        }
    }

    _progressModel(task) {
        const progress = task.progress ?? {kind: 'indeterminate'};
        if (progress.kind === 'determinate') {
            const value = Math.min(Math.max(Number(progress.value) || 0, 0), 1);
            return {fraction: value, indeterminate: false,
                label: `${Math.round(value * 100)}%`};
        }
        if (progress.kind === 'steps') {
            const current = Number(progress.current) || 0;
            if (Number(progress.total) > 0) {
                return {fraction: Math.min(current / progress.total, 1),
                    indeterminate: false, label: `${current}/${progress.total}`};
            }
            return {fraction: 0, indeterminate: true, label: `${current}/?`};
        }
        if (progress.kind === 'elapsed') {
            return {fraction: 0, indeterminate: true,
                label: `${Math.floor((now() - task.createdAt) / 1000)}s`};
        }
        return {fraction: 0, indeterminate: true, label: '…'};
    }

    _createProgress(task, width) {
        const options = this.bar.presentation.options;
        const model = this._progressModel(task);
        const actor = createProgressBar({
            width,
            height: this._settings.get_int('list-progress-height'),
            style_class: 'dynamic-bar-progress',
            trackAlpha: options.trackAlpha,
            progressAlpha: options.progressAlpha,
            fillColor: colorToRgb(task.indicator?.color ??
                this._activityStatusColor(task.status)),
            indeterminate: model.indeterminate,
            striped: !task.indicator && (task.status === 'running' ||
                task.status === 'warning' || task.status === 'paused'),
            stripeAnimated: task.status !== 'paused',
        });
        if (!model.indeterminate)
            actor.setProgress(model.fraction, {animate: false});
        return {actor, label: model.label};
    }

    _actionButton(task, action) {
        const label = () => action.label ?? action.id;
        const icons = {
            pause: 'media-playback-pause-symbolic',
            resume: 'media-playback-start-symbolic',
            skip: 'media-skip-forward-symbolic',
            end: 'process-stop-symbolic',
            cancel: 'process-stop-symbolic',
            eject: 'media-eject-symbolic',
            unmount: 'media-eject-symbolic',
            open: 'folder-open-symbolic',
            retry: 'view-refresh-symbolic',
        };
        const button = createIconButton({
            iconName: action.icon || icons[action.id] || 'emblem-system-symbolic',
            tooltip: label(),
            destructive: action.dangerous,
            iconSize: 15,
        });
        let armed = false;
        let resetId = 0;
        button.connect('clicked', () => {
            if (action.dangerous && !armed) {
                armed = true;
                button.setActionIcon('dialog-warning-symbolic');
                resetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
                    resetId = 0;
                    armed = false;
                    button.setActionIcon(action.icon || icons[action.id] ||
                        'emblem-system-symbolic');
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            if (resetId) {
                GLib.source_remove(resetId);
                resetId = 0;
            }
            this._requestAction(task, action.id);
        });
        return button;
    }

    _visibleActions(task) {
        return (task.actions ?? []).filter(action => {
            if (action.id === 'pause') return task.status === 'running';
            if (action.id === 'resume') return task.status === 'paused';
            return !TERMINAL_STATES.has(task.status);
        });
    }

    _cardIdForGroup(group) {
        if (group === 'timer')
            return 'timer';
        if (group === 'device')
            return 'device';
        if (String(group).startsWith('print'))
            return 'printing';
        return 'live-activities';
    }

    _focusTask(task) {
        if (!task)
            return;
        this._selectedId = task.id;
        this._selectedUntil = now() + 5000;
        this._flashId = task.id;
        if (this._flashTimerId)
            GLib.source_remove(this._flashTimerId);
        this._flashTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1400,
            () => {
                this._flashTimerId = 0;
                this._flashId = null;
                if (this.bar.isShown(this))
                    this.bar.cardsChanged();
                return GLib.SOURCE_REMOVE;
            });
        this.bar.focusCard(this._cardIdForGroup(task.group));
    }

    _createRow(task) {
        // Compact list contract: title | progress | value | context actions.
        const classes = ['dynamic-bar-live-row'];
        if (task.id === this._flashId)
            classes.push('flash');
        if (this._selectedId === task.id && now() < this._selectedUntil)
            classes.push('selected');
        const row = new St.BoxLayout({
            style_class: classes.join(' '),
            reactive: true,
            track_hover: true,
        });

        const actions = this._visibleActions(task);
        const buttonCount = actions.length + (task.logPath ? 1 : 0) + 1;
        const inset = 10 + this._settings.get_int('card-page-edge-padding');
        const contentWidth = this._settings.get_int('card-page-width') - inset * 2;
        const indicatorWidth = task.indicator?.icon ? 18 : 0;
        const percentWidth = Math.max(14, Math.round(contentWidth * 0.05));
        const controlsWidth = buttonCount * 22 + Math.max(0, buttonCount - 1) * 2;
        const gapsWidth = 15 + (indicatorWidth ? 5 : 0);
        const flexible = Math.max(48, contentWidth - indicatorWidth - percentWidth -
            controlsWidth - gapsWidth);
        const desiredTitle = contentWidth * 0.25;
        const desiredProgress = contentWidth * 0.43;
        const scale = Math.min(1, flexible / (desiredTitle + desiredProgress));
        const titleWidth = Math.max(28, Math.round(desiredTitle * scale));
        const progressWidth = Math.max(20, Math.round(flexible - titleWidth));

        const title = new St.Label({
            text: task.title,
            style_class: 'dynamic-bar-live-title',
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.set_width(titleWidth);
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        if (task.summary)
            title.accessible_name = task.summary;
        row.add_child(title);

        if (task.indicator?.icon) {
            row.add_child(new St.Icon({icon_name: task.indicator.icon,
                icon_size: 13, style_class: 'dynamic-bar-device-icon',
                y_align: Clutter.ActorAlign.CENTER}));
        }
        const {actor: progress, label} = this._createProgress(task, progressWidth);
        row.add_child(progress);
        const percent = new St.Label({
            text: label,
            style_class: 'dynamic-bar-live-percent',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        percent.set_width(percentWidth);
        row.add_child(percent);

        const controls = new St.BoxLayout({
            style_class: 'dynamic-bar-live-actions',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (const action of actions)
            controls.add_child(this._actionButton(task, action));
        if (task.logPath) {
            const openLog = createIconButton({
                iconName: 'text-x-generic-symbolic', tooltip: 'Open Log',
                onClicked: () => this._requestAction(task, 'open-log'),
            });
            controls.add_child(openLog);
        }
        const untrack = createIconButton({
            iconName: 'window-close-symbolic', tooltip: 'Stop tracking',
            onClicked: () => this.Dismiss(task.id),
        });
        controls.add_child(untrack);
        row.add_child(controls);

        row.connect('button-press-event', () => {
            // Keep the user's card near the top for a short while so a
            // low-priority update cannot reorder it away immediately.
            this._selectedId = task.id;
            this._selectedUntil = now() + 5000;
            this._activateTerminal(task.terminalPid);
            return Clutter.EVENT_PROPAGATE;
        });
        return row;
    }

    _processAncestors(pid) {
        const ancestors = new Set();
        let current = Number(pid) || 0;
        for (let depth = 0; depth < 12 && current > 1; depth++) {
            ancestors.add(current);
            try {
                const [ok, bytes] = GLib.file_get_contents(`/proc/${current}/stat`);
                if (!ok)
                    break;
                const text = new TextDecoder().decode(bytes);
                const end = text.lastIndexOf(')');
                if (end < 0)
                    break;
                const fields = text.slice(end + 2).split(' ');
                current = Number(fields[1]) || 0;
            } catch (error) {
                logWarning('Activity', `Cannot inspect process ${current}: ${error.message}`);
                break;
            }
        }
        return ancestors;
    }

    _activateTerminal(pid) {
        if (!pid)
            return false;
        // The wrapper reports its parent PID. The terminal window usually
        // belongs to an ancestor process (terminal server, not the shell), so
        // match the window PID against the process ancestry.
        const ancestors = this._processAncestors(pid);
        const actors = global.get_window_actors();
        const target = actors.find(item =>
            ancestors.has(item.meta_window?.get_pid?.()));
        if (!target)
            return false;
        try {
            target.meta_window.activate(global.get_current_time());
            return true;
        } catch (error) {
            logError('Activity', error, `activate terminal for ${pid}`);
            return false;
        }
    }

    destroy() {
        if (this._cardsChangedId) GLib.source_remove(this._cardsChangedId);
        if (this._cleanupId) GLib.source_remove(this._cleanupId);
        for (const timer of this._timers.values()) {
            if (timer.sourceId) GLib.source_remove(timer.sourceId);
        }
        this._timers.clear();
        for (const task of this._tasks.values()) this.bar.activityDot(task.id, false);
        this._listeners.clear(); this._persist(); this._dbus.unexport();
        this._internalCallbacks.clear();
        Gio.bus_unown_name(this._ownerId);
    }
}
