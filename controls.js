import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Shared circular icon action with a transient hover tooltip. */
export function createIconButton({iconName, tooltip, destructive = false,
    iconSize = 16, onClicked = null}) {
    const icon = new St.Icon({icon_name: iconName, icon_size: iconSize});
    const button = new St.Button({
        style_class: destructive
            ? 'dynamic-bar-icon-button destructive'
            : 'dynamic-bar-icon-button',
        child: icon,
        can_focus: true,
        accessible_name: tooltip,
    });
    let tip = null;
    const hideTip = () => {
        tip?.destroy();
        tip = null;
    };
    const showTip = () => {
        hideTip();
        if (!button.hover || !tooltip)
            return;
        tip = new St.Label({text: tooltip, style_class: 'dynamic-bar-tooltip'});
        Main.uiGroup.add_child(tip);
        const [x, y] = button.get_transformed_position();
        const [, naturalWidth] = tip.get_preferred_width(-1);
        const [, naturalHeight] = tip.get_preferred_height(naturalWidth);
        tip.set_position(Math.round(x + (button.width - naturalWidth) / 2),
            Math.round(y - naturalHeight - 6));
        tip.raise_top();
    };
    button.connect('notify::hover', () => button.hover ? showTip() : hideTip());
    button.connect('destroy', hideTip);
    button.connect('button-press-event', () => Clutter.EVENT_STOP);
    if (onClicked)
        button.connect('clicked', onClicked);
    button.setActionIcon = name => { icon.icon_name = name; };
    return button;
}
