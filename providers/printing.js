import Gio from 'gi://Gio';
import St from 'gi://St';

import {BarProvider} from '../provider.js';

const PATH = '/org/cups/cupsd/Notifier';
const IFACE = 'org.cups.cupsd.Notifier';

const JOB_STATE = {
    PENDING: 3,
    HELD: 4,
    PROCESSING: 5,
    STOPPED: 6,
    CANCELED: 7,
    ABORTED: 8,
    COMPLETED: 9,
};

const PRINTER_PROBLEMS =
    /(media-empty|media-needed|offline|jam|door-open|cover-open|toner-empty|marker-supply-empty)/;

export class PrintingProvider extends BarProvider {
    constructor(bar, settings, activities) {
        super(bar);
        this._settings = settings;
        this._activities = activities;
        this._jobs = new Map();
        this._signalId = 0;
        this._setEnabled(settings.get_boolean('printing-enabled'));
        this._settings.connectObject('changed::printing-enabled',
            () => this._setEnabled(this._settings.get_boolean('printing-enabled')),
            this);
    }

    _setEnabled(enabled) {
        if (enabled && !this._signalId) {
            this._signalId = Gio.DBus.system.signal_subscribe(null, IFACE, null,
                PATH, null, Gio.DBusSignalFlags.NONE,
                (_bus, _sender, _path, _iface, signal, parameters) =>
                    this._onSignal(signal, parameters));
        } else if (!enabled && this._signalId) {
            Gio.DBus.system.signal_unsubscribe(this._signalId);
            this._signalId = 0;
            for (const id of this._jobs.keys())
                this._activities.Dismiss(id);
            this._jobs.clear();
        }
    }

    _onSignal(signal, parameters) {
        const values = parameters.recursiveUnpack();

        if (signal === 'PrinterStateChanged' || signal === 'PrinterStopped') {
            // CUPS printer signals: text, printer-uri, printer, printer-state,
            // printer-state-reasons, printer-is-accepting-jobs.
            if (values.length < 6)
                return;
            const [text, , printer, , reasons] = values;
            const problem = String(reasons || text || '').toLowerCase();
            if (PRINTER_PROBLEMS.test(problem))
                this._notifyProblem(printer, text || reasons);
            return;
        }

        if (!signal.startsWith('Job') || values.length < 11)
            return;

        // CUPS job signals: text, printer-uri, printer, printer-state,
        // printer-state-reasons, printer-is-accepting-jobs, job-id, job-state,
        // job-state-reasons, job-name, job-impressions-completed.
        const [text, , printer, , printerReasons, , jobId, jobState,
            jobReasons, jobName, impressions] = values;
        const id = `print:${printer}-${jobId}`;

        if (signal === 'JobCreated' && !this._jobs.has(id)) {
            this._jobs.set(id, true);
            this._activities.registerInternal({
                id,
                title: jobName || `Print job ${jobId}`,
                source: 'cups',
                type: 'print',
                group: `print:${printer}`,
                priority: 2,
                heartbeat: false,
                progress: {kind: 'steps', current: impressions, total: null},
                summary: printer,
                actions: [
                    {id: 'pause', label: 'Pause'},
                    {id: 'resume', label: 'Resume'},
                    {id: 'cancel', label: 'Cancel', dangerous: true},
                ],
            }, {
                pause: () => this._command(['lp', '-i', `${printer}-${jobId}`,
                    '-H', 'hold']),
                resume: () => this._command(['lp', '-i', `${printer}-${jobId}`,
                    '-H', 'resume']),
                cancel: () => this._command(['cancel', `${printer}-${jobId}`]),
            });
        }

        if (!this._jobs.has(id))
            return;

        if (signal === 'JobCompleted' || jobState === JOB_STATE.COMPLETED) {
            this._activities.finishInternal(id, {
                status: 'success',
                summary: text || printerReasons,
            });
            this._jobs.delete(id);
            return;
        }
        if (jobState === JOB_STATE.CANCELED) {
            this._activities.finishInternal(id, {
                status: 'cancelled',
                summary: text || jobReasons,
            });
            this._jobs.delete(id);
            return;
        }
        if (jobState === JOB_STATE.ABORTED) {
            this._activities.finishInternal(id, {
                status: 'error',
                summary: text || jobReasons || 'Print job aborted',
            });
            this._jobs.delete(id);
            return;
        }

        // No reliable page total is broadcast, so keep the steps display at
        // N/? instead of fabricating a percentage.
        const status = jobState === JOB_STATE.HELD
            ? 'paused'
            : jobState === JOB_STATE.STOPPED
                ? 'warning'
                : 'running';
        this._activities.updateInternal(id, {
            status,
            progress: {kind: 'steps', current: impressions, total: null},
            summary: printerReasons || jobReasons || text,
        });
    }

    _command(argv) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        } catch (error) {
            console.error(`Dynamic Bar print action failed: ${error}`);
        }
    }

    _notifyProblem(printer, detail) {
        this.bar.notification({createIslandActor: () => {
            const box = new St.BoxLayout({style_class: 'dynamic-bar-notice'});
            box.add_child(new St.Icon({icon_name: 'printer-error-symbolic',
                icon_size: 22}));
            const labels = new St.BoxLayout({vertical: true});
            labels.add_child(new St.Label({
                text: `${printer || 'Printer'} needs attention`,
                style_class: 'dynamic-bar-notice-title',
            }));
            labels.add_child(new St.Label({
                text: String(detail || 'Printing problem'),
                style_class: 'dynamic-bar-notice-subtitle',
            }));
            box.add_child(labels);
            return box;
        }, destroyIslandActor() {}}, {timeout: 6000, passive: false,
            paddingX: 16, paddingY: 10});
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._setEnabled(false);
    }
}
