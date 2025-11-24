import { Vector2 } from "three";

export class Input {
    public static keysDown: Record<string, boolean> = {};
    public static mouseButtonsDown: Record<number, boolean> = {};
    public static keysPressed: Record<string, boolean> = {};
    public static mouseButtonsPressed: Record<number, boolean> = {};
    public static keysReleased: Record<string, boolean> = {};
    public static mouseButtonsReleased: Record<number, boolean> = {};
    public static mouse = new Vector2();

    public static isShift = false;
    public static isAlt = false;
    public static isControl = false;

    public static onRightMouseDown: (() => void) | null = null;
    public static onRightMouseUp: (() => void) | null = null;

    private static domElement: HTMLElement | null = null;

    public static init(domElement: HTMLElement): void {
        this.domElement = domElement;

        this.onContextMenu = this.onContextMenu.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onBlur = this.onBlur.bind(this);

        this.domElement.addEventListener('contextmenu', this.onContextMenu, false);
        this.domElement.addEventListener('mousedown', this.onMouseDown, false);
        this.domElement.addEventListener('mousemove', this.onMouseMove, false);
        document.addEventListener('mouseup', this.onMouseUp, false);
        window.addEventListener('keydown', this.onKeyDown, false);
        window.addEventListener('keyup', this.onKeyUp, false);
        window.addEventListener('blur', this.onBlur, false);
    }

    public static update(): void {
        this.keysPressed = {};
        this.keysReleased = {};
        this.mouseButtonsPressed = {};
        this.mouseButtonsReleased = {};
    }

    public static cleanup(): void {
        if (!this.domElement) return;

        this.domElement.removeEventListener('contextmenu', this.onContextMenu);
        this.domElement.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        this.domElement.removeEventListener('mousemove', this.onMouseMove);

        this.domElement = null;
        this.reset();
    }

    private static reset(): void {
        this.keysDown = {};
        this.keysPressed = {};
        this.keysReleased = {};
        this.mouseButtonsDown = {};
        this.mouseButtonsPressed = {};
        this.mouseButtonsReleased = {};
        this.isShift = false;
        this.isAlt = false;
        this.isControl = false;
        this.mouse = new Vector2();
    }

    public static isDown(code: string): boolean {
        return !!this.keysDown[code];
    }

    public static isPressed(code: string): boolean {
        return !!this.keysPressed[code];
    }

    public static isReleased(code: string): boolean {
        return !!this.keysReleased[code];
    }

    public static isMouseDown(button: number): boolean {
        return !!this.mouseButtonsDown[button];
    }

    public static isMousePressed(button: number): boolean {
        return !!this.mouseButtonsPressed[button];
    }

    public static isMouseReleased(button: number): boolean {
        return !!this.mouseButtonsReleased[button];
    }

    private static onContextMenu(e: Event): void {
        e.preventDefault();
    }

    private static onMouseDown(e: MouseEvent): void {
        if (this.mouseButtonsDown[e.button]) return;

        this.mouseButtonsDown[e.button] = true;
        this.mouseButtonsPressed[e.button] = true;

        this.onMouseMove(e);

        if (e.button === 2) {
            e.preventDefault();
            this.onRightMouseDown?.();
        }
    }

    private static onMouseUp(e: MouseEvent): void {
        this.mouseButtonsDown[e.button] = false;
        this.mouseButtonsReleased[e.button] = true;

        this.onMouseMove(e);

        if (e.button === 2) {
            console.log('Right mouse button released');
            e.preventDefault();
            this.onRightMouseUp?.();
        }
    }

    private static onMouseMove(e: MouseEvent): void {
        if (!this.domElement) return;
        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private static onKeyDown(e: KeyboardEvent): void {
        if (this.keysDown[e.code]) return;

        this.keysDown[e.code] = true;
        this.keysPressed[e.code] = true;

        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.isShift = true;
        if (e.code === 'AltLeft' || e.code === 'AltRight') this.isAlt = true;
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.isControl = true;

        // Don't prevent default if user is typing in an input field
        const target = e.target as HTMLElement;
        const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

        if (isInputField) return;

        const blockedKeys = [
            'Space',
            'AltLeft', 'AltRight',
            'ControlLeft', 'ControlRight',
            'ShiftLeft', 'ShiftRight',
            'MetaLeft', 'MetaRight',
            'Tab'
        ];

        const isModifierShortcut = e.metaKey || e.ctrlKey || e.altKey;

        if (blockedKeys.includes(e.code) || isModifierShortcut) {
            e.preventDefault();
        }
    }

    private static onKeyUp(e: KeyboardEvent): void {
        this.keysDown[e.code] = false;
        this.keysReleased[e.code] = true;

        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.isShift = false;
        if (e.code === 'AltLeft' || e.code === 'AltRight') this.isAlt = false;
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.isControl = false;
    }

    private static onBlur(): void {
        console.log('Window lost focus, resetting input state');
        this.reset();
        this.onRightMouseUp?.();
    }
}