import { useState, useRef, useCallback } from "preact/hooks";
import InlineSVG from '../../components/InlineSVG';

import styles from './IconButton.module.css';

const LONG_PRESS_MS = 400;

type IconButtonProps = {
    icon: string;
    onClick?: (isOn?: boolean) => void;
    onShortPress?: () => void;
    onLongPress?: () => void;
    toggle?: boolean;
    on?: boolean;
    className?: string;
    ariaLabel?: string;
    iconSize?: number;
};


function IconButton({ icon, onClick, onShortPress, onLongPress, toggle, on, className, ariaLabel, iconSize = 20 }: IconButtonProps) {
    const controlled = on !== undefined;
    const [internalOn, setInternalOn] = useState(on ?? false);
    const isOn = controlled ? on : internalOn;

    const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
    const didLongPress = useRef(false);

    const hasPressHandlers = onShortPress || onLongPress;

    const handleClick = () => {
        if (hasPressHandlers) return; // handled by pointer events
        if (toggle) {
            if (!controlled) setInternalOn(!isOn);
            if (onClick) onClick(!isOn);
        } else {
            if (onClick) onClick();
        }
    };

    const handlePointerDown = useCallback(() => {
        if (!hasPressHandlers) return;
        didLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            onLongPress?.();
        }, LONG_PRESS_MS);
    }, [hasPressHandlers, onLongPress]);

    const handlePointerUp = useCallback(() => {
        if (!hasPressHandlers) return;
        clearTimeout(longPressTimer.current);
        if (!didLongPress.current) {
            onShortPress?.();
        }
    }, [hasPressHandlers, onShortPress]);

    const handlePointerLeave = useCallback(() => {
        clearTimeout(longPressTimer.current);
    }, []);

    return (
        <button
            className={`${styles.iconButton} ${isOn ? styles.iconButton_active : ''} ${toggle ? styles.iconButton_toggle : ''} ${className || ''}`}
            onClick={handleClick}
            onPointerDown={hasPressHandlers ? handlePointerDown : undefined}
            onPointerUp={hasPressHandlers ? handlePointerUp : undefined}
            onPointerLeave={hasPressHandlers ? handlePointerLeave : undefined}
            aria-label={ariaLabel}
        >
            {toggle && <div className={styles.led} />}
            <InlineSVG src={icon} width={iconSize} height={iconSize} />
        </button>
    );
};

export default IconButton;