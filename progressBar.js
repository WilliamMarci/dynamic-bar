import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export const ISLAND_PROGRESS_WIDTH = 270;
export const ISLAND_PROGRESS_HEIGHT = 6;

export function drawRoundedRect(cr, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);

    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

export function paintProgressBar(cr, width, height, fraction, options = {}) {
    const trackAlpha = options.trackAlpha ?? 0.2;
    const progressAlpha = options.progressAlpha ?? 0.9;
    const fill = options.fillColor ?? [1, 1, 1];
    const value = Math.min(Math.max(fraction, 0), 1);

    drawRoundedRect(cr, 0, 0, width, height, height / 2);
    cr.setSourceRGBA(1, 1, 1, trackAlpha);
    cr.fill();

    const progressWidth = width * value;
    if (progressWidth > 0) {
        drawRoundedRect(cr, 0, 0, progressWidth, height,
            Math.min(height / 2, progressWidth / 2));
        cr.setSourceRGBA(fill[0], fill[1], fill[2], progressAlpha);
        cr.fill();
    }
}

/**
 * Plain St.DrawingArea with the same rounded look as the media progress bar.
 * Exposed as a factory (no subclassing) so feature code only deals with a
 * small imperative API: setProgress / setIndeterminate / setColors.
 */
export function createProgressBar(params = {}) {
    const area = new St.DrawingArea({
        style_class: params.styleClass ?? 'dynamic-bar-progress',
        reactive: params.reactive ?? false,
        track_hover: params.reactive ?? false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    area.set_size(params.width ?? ISLAND_PROGRESS_WIDTH,
        params.height ?? ISLAND_PROGRESS_HEIGHT);

    const state = {
        fraction: 0,
        indeterminate: params.indeterminate ?? false,
        striped: params.striped ?? false,
        stripeAnimated: params.stripeAnimated ?? true,
        phase: 0,
        stripePhase: 0,
        timerId: 0,
        stripeTimerId: 0,
        tweenId: 0,
        trackAlpha: params.trackAlpha ?? 0.2,
        progressAlpha: params.progressAlpha ?? 0.9,
        fillColor: params.fillColor ?? [1, 1, 1],
    };

    const paint = () => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width > 0 && height > 0) {
            const radius = height / 2;
            drawRoundedRect(cr, 0, 0, width, height, height / 2);
            cr.setSourceRGBA(1, 1, 1, state.trackAlpha);
            cr.fill();

            if (state.indeterminate) {
                const band = Math.max(12, width * 0.3);
                const travel = width + band;
                const x = state.phase * travel - band;
                const start = Math.max(0, x);
                const end = Math.min(width, x + band);
                if (end > start) {
                    const bandWidth = end - start;
                    drawRoundedRect(cr, start, 0, bandWidth, height,
                        Math.min(radius, bandWidth / 2));
                    cr.setSourceRGBA(state.fillColor[0], state.fillColor[1],
                        state.fillColor[2], state.progressAlpha);
                    cr.fill();
                }
            } else {
                const progressWidth = width * state.fraction;
                if (progressWidth > 0) {
                    drawRoundedRect(cr, 0, 0, progressWidth, height,
                        Math.min(radius, progressWidth / 2));
                    cr.setSourceRGBA(state.fillColor[0], state.fillColor[1],
                        state.fillColor[2], state.progressAlpha);
                    cr.fill();

                    if (state.striped) {
                        cr.save();
                        drawRoundedRect(cr, 0, 0, progressWidth, height,
                            Math.min(radius, progressWidth / 2));
                        cr.clip();
                        cr.setLineWidth(2);
                        cr.setSourceRGBA(0, 0, 0, 0.26);
                        const step = 8;
                        for (let x = -height + state.stripePhase;
                            x < progressWidth + height; x += step) {
                            cr.moveTo(x, height);
                            cr.lineTo(x + height, 0);
                        }
                        cr.stroke();
                        cr.restore();
                    }
                }
            }
        }
        cr.$dispose();
    };

    const stopTimer = () => {
        if (state.timerId) {
            GLib.source_remove(state.timerId);
            state.timerId = 0;
        }
    };
    const startTimer = () => {
        if (!state.timerId) {
            state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
                state.phase = (state.phase + 0.035) % 1;
                area.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }
    };
    const syncTimer = () => {
        if (state.indeterminate)
            startTimer();
        else
            stopTimer();
    };

    area.setIndeterminate = value => {
        state.indeterminate = Boolean(value);
        syncTimer();
        area.queue_repaint();
    };
    area.setColors = ({trackAlpha, progressAlpha, fillColor} = {}) => {
        if (trackAlpha !== undefined)
            state.trackAlpha = trackAlpha;
        if (progressAlpha !== undefined)
            state.progressAlpha = progressAlpha;
        if (fillColor !== undefined)
            state.fillColor = fillColor;
        area.queue_repaint();
    };
    area.setProgress = (value, {animate = true, duration = 220} = {}) => {
        const target = Math.min(Math.max(Number(value) || 0, 0), 1);
        if (state.tweenId) {
            GLib.source_remove(state.tweenId);
            state.tweenId = 0;
        }
        if (!animate || duration <= 0 ||
            Math.abs(target - state.fraction) < 0.002) {
            state.fraction = target;
            area.queue_repaint();
            return;
        }
        const start = state.fraction;
        const started = GLib.get_monotonic_time();
        state.tweenId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const elapsed = (GLib.get_monotonic_time() - started) / 1000;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            state.fraction = start + (target - start) * eased;
            area.queue_repaint();
            if (progress >= 1) {
                state.tweenId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    };

    area.connect('repaint', () => paint());
    area.connect('notify::allocation', () => area.queue_repaint());
    area.connect('destroy', () => {
        stopTimer();
        if (state.tweenId) {
            GLib.source_remove(state.tweenId);
            state.tweenId = 0;
        }
        if (state.stripeTimerId) {
            GLib.source_remove(state.stripeTimerId);
            state.stripeTimerId = 0;
        }
    });

    const syncStripe = () => {
        if (state.striped && state.stripeAnimated && !state.stripeTimerId) {
            state.stripeTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50,
                () => {
                    state.stripePhase = (state.stripePhase + 0.5) % 8;
                    area.queue_repaint();
                    return GLib.SOURCE_CONTINUE;
                });
        } else if (!state.striped && state.stripeTimerId) {
            GLib.source_remove(state.stripeTimerId);
            state.stripeTimerId = 0;
        }
    };
    area.setStriped = (value, {animate = true} = {}) => {
        state.striped = Boolean(value);
        state.stripeAnimated = animate;
        syncStripe();
        area.queue_repaint();
    };

    syncTimer();
    syncStripe();
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        area.queue_repaint();
        return GLib.SOURCE_REMOVE;
    });
    return area;
}
