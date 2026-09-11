import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

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
    } catch {
        return fallback;
    }
}

export class LiveActivityProvider extends BarProvider {
    constructor(bar, settings) {
        super(bar);
        this._settings = settings;
        this._tasks = new Map();
        this._listeners = new Set();
        this._publishedGroups = new Set();
        this._internalCallbacks = new Map();
        this._timers = new Map();
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-bar']);
        this._stateFile = Gio.File.new_for_path(GLib.build_filenamev([
            this._cacheDir, 'activities.json']));
        this._load();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._dbus.export(Gio.DBus.session, LIVE_OBJECT_PATH);
        this._ownerId = Gio.bus_own_name_on_connection(Gio.DBus.session,
            LIVE_BUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null);
        this._cleanupId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15,
            () => this._housekeeping());
        this._publishGroups();
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
        const pause = () => { if (!timer.paused) { update(); timer.paused = true;
            this.updateInternal(id, {status: 'paused'}); } };
        const resume = () => { if (timer.paused) { timer.paused = false;
            timer.deadline = GLib.get_monotonic_time() + timer.remaining * 1e6;
            this.updateInternal(id, {status: 'running'}); } };
        const end = () => { if (timer.sourceId) GLib.source_remove(timer.sourceId);
            timer.sourceId = 0; this._timers.delete(id);
            this.finishInternal(id, {status: 'cancelled', summary: 'Timer ended'}); };
        this.registerInternal({id, title: title || 'Timer', source: 'dynamic-bar', type: 'timer',
            group: 'timer', progress: {kind: 'determinate', value: 0},
            actions: [{id: 'pause', label: 'Pause'}, {id: 'resume', label: 'Resume'},
                {id: 'skip', label: 'Skip'}, {id: 'end', label: 'End', dangerous: true}]},
        {pause, resume, skip: () => { timer.remaining = 0; update(); }, end});
        timer.sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, update);
        this._timers.set(id, timer);
        update();
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
            terminalPid: Number(input.terminalPid) || 0, summary: '', logPath: '', exitCode: null,
            createdAt: timestamp, updatedAt: timestamp,
            expiresAt: Number(input.expiresAt) || 0, heartbeatTimeout: Number(input.heartbeatTimeout) || 45000,
        };
        this._tasks.set(task.id, task);
        this._sync(task);
        if (!input.silentStart) this._notifySmall(`${task.title} started`);
    }

    UpdateV2(id, payload) {
        const task = this._tasks.get(id);
        if (!task || TERMINAL_STATES.has(task.status)) return;
        const update = safeJson(payload);
        for (const key of ['status', 'progress', 'summary', 'logPath', 'actions', 'priority']) {
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
        if (result.progress) task.progress = result.progress;
        else if (task.status === 'success') task.progress = {kind: 'determinate', value: 1};
        task.updatedAt = now();
        task.expiresAt ||= task.updatedAt + (task.status === 'success' ? 30000 : 300000);
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
        if (!this._tasks.delete(id)) return;
        this._internalCallbacks.delete(id);
        this._changed();
    }

    _sync(_task) { this._changed(); }
    _publishGroups() {
        const groups = new Map();
        const rank = status => ({error: 7, warning: 6, orphaned: 5, running: 4,
            paused: 3, cancelled: 2, success: 1}[status] ?? 0);
        for (const task of this._tasks.values()) {
            const current = groups.get(task.group);
            if (!current || rank(task.status) > rank(current.status))
                groups.set(task.group, task);
        }
        for (const old of this._publishedGroups) {
            if (!groups.has(old)) this.bar.activity(old, false);
        }
        for (const [group, task] of groups) {
            const progress = task.progress?.kind === 'determinate'
                ? Number(task.progress.value) : NaN;
            this.bar.activity(group, {status: task.status, progress});
        }
        this._publishedGroups = new Set(groups.keys());
    }

    _changed() {
        this._publishGroups();
        this._persist();
        for (const listener of this._listeners) listener();
        const presentation = this.bar.presentation;
        if (presentation.expanded && presentation.provider === this) this.bar.rebuild(this);
    }

    _housekeeping() {
        const timestamp = now();
        for (const task of [...this._tasks.values()]) {
            if (task.expiresAt > 0 && timestamp >= task.expiresAt) {
                task.status = 'expired';
                this.Dismiss(task.id);
            } else if (!TERMINAL_STATES.has(task.status) && task.status !== 'orphaned' &&
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
        } catch (error) { console.error(`Dynamic Bar activity persistence failed: ${error}`); }
    }

    _load() {
        try {
            const [ok, bytes] = this._stateFile.load_contents(null);
            if (!ok) return;
            for (const stored of safeJson(new TextDecoder().decode(bytes), [])) {
                if (!stored.id) continue;
                if (!TERMINAL_STATES.has(stored.status)) stored.status = 'orphaned';
                this._tasks.set(stored.id, stored);
            }
        } catch {}
    }

    _notifySmall(text) {
        this.bar.notification({createIslandActor: () => new St.Label({text,
            style_class: 'dynamic-bar-track-notification-label'}), destroyIslandActor() {}},
        {timeout: 1200, passive: true, height: 10, paddingX: 8, paddingY: 0});
    }

    _notifyComplete(task) {
        this.bar.notification({createIslandActor: () => {
            const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
            box.add_child(new St.Icon({icon_name: task.status === 'success'
                ? 'object-select-symbolic' : 'dialog-error-symbolic', icon_size: 22}));
            box.add_child(new St.Label({text: task.status === 'success'
                ? `${task.title} completed` : `${task.title} ${task.status}`,
            style_class: 'dynamic-bar-notice-title'})); return box;}, destroyIslandActor() {}},
        {timeout: 2800, passive: true});
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

    createIslandActor() {
        const list = new St.BoxLayout({vertical: true, style_class: 'dynamic-bar-live-list'});
        const tasks = [...this._tasks.values()].sort((a, b) => {
            const rank = status => ({error: 5, warning: 4, orphaned: 3, running: 2,
                paused: 1, success: 0}[status] ?? 0);
            return rank(b.status) - rank(a.status) || b.priority - a.priority || b.updatedAt - a.updatedAt;
        });
        for (const task of tasks) list.add_child(this._createRow(task));
        return list;
    }

    _createRow(task) {
        const row = new St.BoxLayout({vertical: true, style_class: 'dynamic-bar-live-row'});
        const main = new St.BoxLayout({style_class: 'dynamic-bar-live-row-content'});
        main.add_child(new St.Label({text: task.title, style_class: 'dynamic-bar-live-title', x_expand: true}));
        const progress = task.progress ?? {kind: 'indeterminate'};
        const track = new St.Widget({style_class: `dynamic-bar-live-progress ${progress.kind}`, width: 100, height: 5});
        let percent = '…';
        if (progress.kind === 'determinate') {
            const value = Math.min(Math.max(Number(progress.value) || 0, 0), 1);
            track.add_child(new St.Widget({style_class: `dynamic-bar-live-progress-fill ${task.status}`,
                width: Math.round(100 * value), height: 5})); percent = `${Math.round(value * 100)}%`;
        } else if (progress.kind === 'steps') {
            percent = `${progress.current ?? 0}/${progress.total ?? '?'}`;
        } else if (progress.kind === 'elapsed') {
            percent = `${Math.floor((now() - task.createdAt) / 1000)}s`;
        }
        main.add_child(track);
        main.add_child(new St.Label({text: percent, style_class: 'dynamic-bar-live-percent'}));
        row.add_child(main);
        if (task.summary) row.add_child(new St.Label({text: task.summary, style_class: 'dynamic-bar-live-summary'}));
        const actions = [...(task.actions ?? [])];
        if (task.logPath) actions.unshift({id: 'open-log', label: 'Open Log', icon: 'text-x-generic-symbolic'});
        if (task.status === 'orphaned' || TERMINAL_STATES.has(task.status))
            actions.push({id: 'dismiss', label: 'Dismiss', icon: 'window-close-symbolic'});
        if (actions.length) {
            const buttons = new St.BoxLayout({style_class: 'dynamic-bar-live-actions'});
            for (const action of actions.slice(0, 2)) {
                const button = new St.Button({label: action.label ?? action.id,
                    style_class: action.dangerous ? 'dynamic-bar-live-action destructive' : 'dynamic-bar-live-action'});
                let armed = false;
                button.connect('clicked', () => {
                    if (action.dangerous && !armed) { armed = true; button.label = 'Confirm'; return; }
                    this._requestAction(task, action.id);
                });
                buttons.add_child(button);
            }
            row.add_child(buttons);
        }
        row.connect('button-press-event', () => { this._activateTerminal(task.terminalPid); return 0; });
        return row;
    }

    _activateTerminal(pid) {
        const actor = global.get_window_actors().find(item => item.meta_window.get_pid() === pid);
        actor?.meta_window.activate(global.get_current_time());
    }

    destroy() {
        if (this._cleanupId) GLib.source_remove(this._cleanupId);
        for (const timer of this._timers.values()) {
            if (timer.sourceId) GLib.source_remove(timer.sourceId);
        }
        this._timers.clear();
        for (const task of this._tasks.values()) this.bar.activity(task.group, false);
        this._listeners.clear(); this._persist(); this._dbus.unexport();
        this._internalCallbacks.clear();
        Gio.bus_unown_name(this._ownerId);
    }
}
