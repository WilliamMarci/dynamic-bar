import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const TAU = Math.PI * 2;

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpColor(from, to, t) {
    return from.map((value, index) => lerp(value, to[index], t));
}

function makeFusedPath(cr, width, height, topRadius, bottomRadius) {
    const fillet = Math.min(topRadius, height * 0.5, width * 0.4);
    const bodyWidth = width - fillet * 2;
    const bottom = Math.min(bottomRadius, height - fillet, bodyWidth * 0.5);

    cr.newSubPath();
    cr.moveTo(0, 0);
    cr.arc(0, fillet, fillet, 0.75 * TAU, TAU);
    cr.lineTo(fillet, height - bottom);
    cr.arcNegative(fillet + bottom, height - bottom, bottom,
        0.5 * TAU, 0.25 * TAU);
    cr.lineTo(width - fillet - bottom, height);
    cr.arcNegative(width - fillet - bottom, height - bottom, bottom,
        0.25 * TAU, 0);
    cr.lineTo(width - fillet, fillet);
    cr.arc(width, fillet, fillet, 0.5 * TAU, 0.75 * TAU);
    cr.closePath();
}

// Dynamic bar owns its drawing path. It is not an island progress control:
// its geometry, activation glow and activity-preview state are independent.
function makeRoundedRectPath(cr, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);

    cr.newSubPath();
    cr.arc(width - r, r, r, -0.5 * Math.PI, 0);
    cr.arc(width - r, height - r, r, 0, 0.5 * Math.PI);
    cr.arc(r, height - r, r, 0.5 * Math.PI, Math.PI);
    cr.arc(r, r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export const IslandBackground = GObject.registerClass(
class IslandBackground extends St.DrawingArea {
    _init(params = {}) {
        super._init({layout_manager: new Clutter.BinLayout()});
        this._topRadius = params.topRadius ?? 8;
        this._bottomRadius = params.bottomRadius ?? 8;
        this._color = [0, 0, 0, 0];
        this._fromColor = null;
        this._targetColor = [0, 0, 0, 0];
        this._elapsed = 0;
        this._duration = 0;
        this._tickId = 0;
        this._glowActive = false;
        this._glowAngle = 0;
        this._activityColor = null;

        this.connect('repaint', () => this._paint());
        this.connect('destroy', () => this._stopTick());
    }

    setRadii(topRadius, bottomRadius) {
        this._topRadius = topRadius;
        this._bottomRadius = bottomRadius;
        this.queue_repaint();
    }

    setColor(color, duration = 0) {
        if (duration <= 0) {
            this._stopTick();
            this._color = [...color];
            this._targetColor = [...color];
            this._fromColor = null;
            this.queue_repaint();
            return;
        }

        this._fromColor = [...this._color];
        this._targetColor = [...color];
        this._elapsed = 0;
        this._duration = duration;

        if (!this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16,
                () => this._tick());
        }
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _tick() {
        this._elapsed += 16;
        const progress = Math.min(this._elapsed / this._duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        this._color = lerpColor(this._fromColor ?? this._targetColor,
            this._targetColor, eased);
        this.queue_repaint();

        if (progress >= 1) {
            this._fromColor = null;
            this._tickId = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _paint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();

        if (width > 0 && height > 1 && this._color[3] > 0) {
            makeFusedPath(cr, width, height, this._topRadius, this._bottomRadius);
            cr.setSourceRGBA(...this._color);
            cr.fill();
        }

        cr.$dispose();
    }
});

export const BarBackground = GObject.registerClass(
class BarBackground extends St.DrawingArea {
    _init(params = {}) {
        super._init({layout_manager: new Clutter.BinLayout()});
        this._radius = params.radius ?? 2;
        this._alpha = params.alpha ?? 0.2;
        this._trackAlpha = 0.2;
        this._progressAlpha = 0.9;
        this._progress = 0;
        this._active = false;
        this._fromProgress = 0;
        this._targetProgress = 0;
        this._elapsed = 0;
        this._duration = 0;
        this._tickId = 0;
        this._activityStriped = false;
        this._activityStripeAnimated = false;
        this._activityPreviewPinned = false;
        this._stripePhase = 0;
        this._stripeTickId = 0;

        this.connect('repaint', () => this._paint());
        this.connect('destroy', () => {
            this._stopTick();
            this._stopStripeTick();
        });
    }

    setRadius(radius) {
        this._radius = radius;
        this.queue_repaint();
    }

    setAlpha(alpha) {
        if (this._alpha === alpha)
            return;
        this._alpha = alpha;
        this.queue_repaint();
    }

    setTrackAlpha(alpha) {
        this._trackAlpha = alpha;
        this.queue_repaint();
    }

    setProgressAlpha(alpha) {
        this._progressAlpha = alpha;
        this.queue_repaint();
    }

    setProgress(progress, active, animate = false, style = {}) {
        const target = Math.min(Math.max(progress, 0), 1);
        this._activityColor = style.color ?? null;
        this._activityStriped = style.striped ?? false;
        this._activityStripeAnimated = style.animateStripes ??
            this._activityStriped;
        this._activityPreviewPinned = false;
        this._stopStripeTick();
        if (this._activityStriped && this._activityStripeAnimated)
            this._stripedTick();
        if (this._glowActive) {
            this._targetProgress = target;
            this._active = active;
            return;
        }
        // Grow the fill from zero when progress becomes visible again (for
        // example when the island collapses back to the bar).
        if (active && !this._active) {
            this._progress = 0;
            this._fromProgress = 0;
            this._targetProgress = target;
            this._elapsed = 0;
            this._duration = 240;
            this._active = true;
            if (!this._tickId) {
                this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16,
                    () => this._tick());
            }
            return;
        }
        if (animate && active && Math.abs(target - this._progress) > 0.002) {
            this._fromProgress = this._progress;
            this._targetProgress = target;
            this._elapsed = 0;
            this._duration = 200;
            this._active = active;
            if (!this._tickId) {
                this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16,
                    () => this._tick());
            }
            return;
        }
        this._stopTick();
        this._progress = target;
        this._targetProgress = target;
        this._active = active;
        this.queue_repaint();
    }

    easeProgress(target, duration = 180) {
        this._fromProgress = this._progress;
        this._targetProgress = Math.min(Math.max(target, 0), 1);
        this._elapsed = 0;
        this._duration = Math.max(1, duration);
        this._active = true;

        if (!this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16,
                () => this._tick());
        }
    }

    playActivation(target, duration = 480, style = {}) {
        this._stopTick();
        this._activityColor = style.color ?? null;
        this._activityStriped = style.striped ?? false;
        this._activityStripeAnimated = style.animateStripes ??
            this._activityStriped;
        this._stopStripeTick();
        if (this._activityStriped && this._activityStripeAnimated)
            this._stripedTick();
        this._progress = 0;
        this._glowActive = true;
        this._glowAngle = 0;
        this.easeProgress(target, duration);
    }

    setActivityPreview(progress, {color = null, striped = false,
        animateStripes = striped} = {}) {
        this._stopTick();
        this._activityColor = color ?? [0.36, 0.68, 0.95, 1];
        this._activityStriped = striped;
        this._activityStripeAnimated = animateStripes;
        this._activityPreviewPinned = false;
        this._progress = 0;
        if (striped && animateStripes)
            this._stripedTick();
        this.easeProgress(progress, 220);
    }

    /** Persistent preview while an activity dot is pinned (Shift+click). */
    setPinnedActivityPreview(progress, {color = null, striped = true,
        animateStripes = striped} = {}) {
        const firstFrame = !this._activityPreviewPinned;
        this._activityPreviewPinned = true;
        this._activityColor = color ?? [0.36, 0.68, 0.95, 1];
        this._activityStriped = striped;
        this._activityStripeAnimated = animateStripes;
        this._active = true;
        if (!animateStripes)
            this._stopStripeTick();
        if (striped && animateStripes)
            this._stripedTick();
        if (firstFrame)
            this._progress = 0;
        this.easeProgress(progress, firstFrame ? 220 : 180);
    }

    clearActivityPreview() {
        this._activityStriped = false;
        this._activityStripeAnimated = false;
        this._activityPreviewPinned = false;
        this._activityColor = null;
        this._stopStripeTick();
    }

    _stripedTick() {
        if (this._stripeTickId)
            return;
        this._stripeTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (!this._activityStriped || !this._activityStripeAnimated ||
                !this._active) {
                this._stripeTickId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._stripePhase = (this._stripePhase + 0.5) % 8;
            this.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopStripeTick() {
        if (this._stripeTickId) {
            GLib.source_remove(this._stripeTickId);
            this._stripeTickId = 0;
        }
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _tick() {
        this._elapsed += 16;
        const progress = Math.min(this._elapsed / this._duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        this._progress = lerp(this._fromProgress, this._targetProgress, eased);
        this._glowAngle = progress * TAU;
        this.queue_repaint();

        if (progress >= 1) {
            this._glowActive = false;
            this._tickId = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _paint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();

        if (width > 0 && height > 0) {
            makeRoundedRectPath(cr, width, height, this._radius);

            if (this._active) {
                cr.setSourceRGBA(1, 1, 1, this._trackAlpha);
                cr.fill();
                const progressWidth = width * this._progress;
                if (progressWidth > 0) {
                    makeRoundedRectPath(cr, progressWidth, height,
                        Math.min(this._radius, progressWidth / 2));
                    if (this._activityColor)
                        cr.setSourceRGBA(this._activityColor[0], this._activityColor[1],
                            this._activityColor[2], this._progressAlpha);
                    else
                        cr.setSourceRGBA(1, 1, 1, this._progressAlpha);
                    cr.fill();

                    if (this._activityStriped) {
                        // Darker diagonal stripes over the completed part,
                        // scrolling slowly while the task runs.
                        cr.save();
                        makeRoundedRectPath(cr, progressWidth, height,
                            Math.min(this._radius, progressWidth / 2));
                        cr.clip();
                        cr.setLineWidth(2);
                        cr.setSourceRGBA(0, 0, 0, 0.28);
                        const step = 8;
                        for (let x = -height + this._stripePhase;
                            x < progressWidth + height; x += step) {
                            cr.moveTo(x, height);
                            cr.lineTo(x + height, 0);
                        }
                        cr.stroke();
                        cr.restore();
                    }
                }
            } else {
                cr.setSourceRGBA(1, 1, 1, this._alpha);
                cr.fill();
            }
            if (this._glowActive && width > 4 && height > 2) {
                const cx = width / 2;
                const cy = height / 2;
                const dx = Math.cos(this._glowAngle) * width / 2;
                const dy = Math.sin(this._glowAngle) * Math.max(height, 8) / 2;
                const gradient = new Cairo.LinearGradient(
                    cx - dx, cy - dy, cx + dx, cy + dy);
                gradient.addColorStopRGBA(0, 0.30, 0.55, 1.0, 0.05);
                // Keep the hot spot saturated. A near-white midpoint reads as
                // a white defect when it crosses the centre of a short bar.
                gradient.addColorStopRGBA(0.5, 0.18, 0.62, 1.0, 1.0);
                gradient.addColorStopRGBA(1, 0.60, 0.35, 1.0, 0.10);
                cr.save();
                cr.translate(1, 1);
                makeRoundedRectPath(cr, width - 2, height - 2,
                    Math.max(1, this._radius));
                cr.setSource(gradient);
                cr.setLineWidth(2);
                cr.stroke();
                cr.restore();
            }
        }

        cr.$dispose();
    }
});
