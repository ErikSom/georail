import { useState } from "preact/hooks";
import InlineSVG from '../../components/InlineSVG';

import styles from './IconButton.module.css';

type IconButtonProps = {
    icon: string;
    onClick?: (isOn?: boolean) => void;
    toggle?: boolean;
    on?: boolean;
    className?: string;
    ariaLabel?: string;
    iconSize?: number;
};


function IconButton({ icon, onClick, toggle, on, className, ariaLabel, iconSize = 20 }: IconButtonProps) {
    const [isOn, setIsOn] = useState(on ?? false);

    const handleClick = () => {
        if (toggle) {
            setIsOn(!isOn);
            if (onClick) onClick(!isOn);
        } else {
            if (onClick) onClick();
        }
    };

    return (
        <button
            className={`${styles.iconButton} ${isOn ? styles.iconButton_active : ''} ${toggle ? styles.iconButton_toggle : ''} ${className || ''}`}
            onClick={handleClick}
            aria-label={ariaLabel}
        >
            {toggle && <div className={styles.led} />}
            <InlineSVG src={icon} width={iconSize} height={iconSize} />
        </button>
    );
};

export default IconButton;