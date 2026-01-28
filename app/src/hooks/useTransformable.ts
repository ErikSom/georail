import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import { h } from 'preact';
import styles from './useTransformable.module.css';

export type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br' | null;

export interface TransformablePosition {
    x: number;
    y: number;
}

export interface UseTransformableOptions {
    /** Default position when no stored state exists. */
    initialPosition: TransformablePosition;
    /** If provided, enables resizing. If omitted, only dragging is enabled. */
    initialSize?: number;
    /** Minimum size when resizing is enabled. Defaults to 100. */
    minSize?: number;
    /** Grid size for snapping position on load and drag end. Defaults to 10. */
    gridSize?: number;
    /** Padding from viewport edges. Defaults to 10. */
    padding?: number;
    /** If provided, persists state to localStorage under this key. */
    storageKey?: string;
    onPositionChange?: (position: TransformablePosition) => void;
    onSizeChange?: (size: number) => void;
    onSelectedChange?: (selected: boolean) => void;
    onResizeEnd?: () => void;
}

export interface UseTransformableReturn {
    position: TransformablePosition;
    /** Size value. Only meaningful when resizing is enabled. */
    size: number | undefined;
    selected: boolean;
    ready: boolean;
    containerRef: preact.RefObject<HTMLDivElement>;
    setPosition: (position: TransformablePosition) => void;
    setSize: (size: number) => void;
    setSelected: (selected: boolean) => void;
    handleContainerPointerDown: (e: PointerEvent) => void;
    /** Whether resizing is enabled for this instance. */
    resizable: boolean;
    /** Renders resize handles. Only renders when resizable and selected. */
    renderResizeHandles: () => preact.VNode | null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

interface StoredState {
    x: number;
    y: number;
    size?: number;
}

function loadStoredState(key: string): StoredState | null {
    if (typeof window === 'undefined') return null;
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                return {
                    x: parsed.x,
                    y: parsed.y,
                    size: typeof parsed.size === 'number' ? parsed.size : undefined,
                };
            }
        }
    } catch {
        // Ignore parse errors
    }
    return null;
}

function saveStoredState(key: string, state: StoredState): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(state));
    } catch {
        // Ignore storage errors
    }
}

export function useTransformable(options: UseTransformableOptions): UseTransformableReturn {
    const {
        initialPosition,
        initialSize,
        minSize = 100,
        gridSize = 10,
        padding = 10,
        storageKey,
        onPositionChange,
        onSizeChange,
        onSelectedChange,
        onResizeEnd,
    } = options;

    // Load initial state from storage if key provided
    const storedState = useRef<StoredState | null | undefined>(undefined);
    if (storageKey && storedState.current === undefined) {
        storedState.current = loadStoredState(storageKey);
    }

    const effectiveInitialPosition = storedState.current
        ? { x: storedState.current.x, y: storedState.current.y }
        : initialPosition;
    const effectiveInitialSize = storedState.current?.size ?? initialSize;

    const snapToGrid = useCallback((value: number): number => {
        if (gridSize <= 1) return value;
        return Math.round(value / gridSize) * gridSize;
    }, [gridSize]);

    const resizable = initialSize !== undefined;

    const containerRef = useRef<HTMLDivElement | null>(null);

    const [position, setPositionState] = useState<TransformablePosition>(effectiveInitialPosition);
    const [size, setSizeState] = useState(effectiveInitialSize);
    const [selected, setSelectedState] = useState(false);
    const [ready, setReady] = useState(false);

    const dragState = useRef<{
        isDragging: boolean;
        isResizing: ResizeCorner;
        pointerId: number | null;
        startX: number;
        startY: number;
        startPosX: number;
        startPosY: number;
        startSize: number;
    }>({
        isDragging: false,
        isResizing: null,
        pointerId: null,
        startX: 0,
        startY: 0,
        startPosX: 0,
        startPosY: 0,
        startSize: 0,
    });

    // Track active pointers to detect multi-touch
    const activePointers = useRef<Set<number>>(new Set());

    // Track if initial snap has been done
    const initialSnapDone = useRef(false);

    // Clamp position to keep container within screen bounds with padding
    const clampPosition = useCallback((x: number, y: number, sz?: number, snap = false): TransformablePosition => {
        if (typeof window === 'undefined') return { x, y };

        // Use explicit size if provided, otherwise measure the container element
        let effectiveWidth = sz ?? 0;
        let effectiveHeight = sz ?? 0;
        if (sz === undefined && containerRef.current) {
            effectiveWidth = containerRef.current.offsetWidth;
            effectiveHeight = containerRef.current.offsetHeight;
        }

        const maxX = window.innerWidth - effectiveWidth - padding;
        const maxY = window.innerHeight - effectiveHeight - padding;
        let clampedX = clamp(x, padding, Math.max(padding, maxX));
        let clampedY = clamp(y, padding, Math.max(padding, maxY));
        if (snap) {
            clampedX = snapToGrid(clampedX);
            clampedY = snapToGrid(clampedY);
        }
        return { x: clampedX, y: clampedY };
    }, [padding, snapToGrid]);

    // Wrapped setters that also call callbacks
    const setPosition = useCallback((newPosition: TransformablePosition) => {
        setPositionState(newPosition);
        onPositionChange?.(newPosition);
    }, [onPositionChange]);

    const setSize = useCallback((newSize: number) => {
        if (!resizable) return;
        setSizeState(newSize);
        onSizeChange?.(newSize);
    }, [resizable, onSizeChange]);

    const setSelected = useCallback((newSelected: boolean) => {
        setSelectedState(newSelected);
        onSelectedChange?.(newSelected);
    }, [onSelectedChange]);

    // Persist state to localStorage when it changes
    useEffect(() => {
        if (!storageKey) return;
        saveStoredState(storageKey, { x: position.x, y: position.y, size });
    }, [storageKey, position.x, position.y, size]);

    // Initialize and handle window resize
    useEffect(() => {
        const clampAndUpdate = (snap: boolean) => {
            setPositionState(currentPos => {
                const clamped = clampPosition(currentPos.x, currentPos.y, size, snap);
                if (clamped.x !== currentPos.x || clamped.y !== currentPos.y) {
                    onPositionChange?.(clamped);
                }
                return clamped;
            });
        };

        const handleWindowResize = () => clampAndUpdate(false);

        // Only snap on very first mount, not on effect re-runs
        if (!initialSnapDone.current) {
            clampAndUpdate(true);
            initialSnapDone.current = true;
        }

        window.addEventListener('resize', handleWindowResize);
        setReady(true);

        return () => {
            window.removeEventListener('resize', handleWindowResize);
        };
    }, [clampPosition, size, onPositionChange]);

    // Handle click outside to deselect
    useEffect(() => {
        const handlePointerDown = (e: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setSelected(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [setSelected]);

    // Handle drag and resize pointer events
    useEffect(() => {
        const cancelDrag = () => {
            const capturedPointerId = dragState.current.pointerId;
            dragState.current.isDragging = false;
            dragState.current.isResizing = null;
            dragState.current.pointerId = null;
            // Release pointer capture so events flow to underlying canvas
            if (capturedPointerId !== null && containerRef.current) {
                try {
                    containerRef.current.releasePointerCapture(capturedPointerId);
                } catch (_) { /* ignore if already released */ }
            }
        };

        const handlePointerDown = (e: PointerEvent) => {
            activePointers.current.add(e.pointerId);
            // Cancel drag/resize if a second finger touches
            if (activePointers.current.size > 1) {
                cancelDrag();
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            const state = dragState.current;
            if (state.pointerId !== e.pointerId) return;
            // Cancel drag/resize if multi-touch detected
            if (activePointers.current.size > 1) {
                cancelDrag();
                return;
            }

            if (state.isDragging) {
                const dx = e.clientX - state.startX;
                const dy = e.clientY - state.startY;
                const newPos = clampPosition(
                    state.startPosX + dx,
                    state.startPosY + dy,
                    size
                );
                setPosition(newPos);
            } else if (state.isResizing && resizable) {
                const dx = e.clientX - state.startX;
                const dy = e.clientY - state.startY;
                const corner = state.isResizing;

                // Calculate delta based on corner - drag direction determines growth
                let delta: number;
                if (corner === 'br') {
                    delta = (dx + dy) / 2;
                } else if (corner === 'bl') {
                    delta = (-dx + dy) / 2;
                } else if (corner === 'tr') {
                    delta = (dx - dy) / 2;
                } else {
                    delta = (-dx - dy) / 2;
                }

                const newSize = Math.max(minSize, state.startSize + delta);
                const sizeDiff = newSize - state.startSize;

                let newX = state.startPosX;
                let newY = state.startPosY;

                // Adjust position for corners that resize from top or left
                if (corner === 'tl') {
                    newX = state.startPosX - sizeDiff;
                    newY = state.startPosY - sizeDiff;
                } else if (corner === 'tr') {
                    newY = state.startPosY - sizeDiff;
                } else if (corner === 'bl') {
                    newX = state.startPosX - sizeDiff;
                }

                // Clamp position
                const clamped = clampPosition(newX, newY, newSize);

                setSize(newSize);
                setPosition(clamped);
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            activePointers.current.delete(e.pointerId);

            if (dragState.current.pointerId !== e.pointerId) return;

            const wasDragging = dragState.current.isDragging;
            const wasResizing = dragState.current.isResizing !== null;

            dragState.current.isDragging = false;
            dragState.current.isResizing = null;
            dragState.current.pointerId = null;

            // Snap to grid on drag/resize end
            if (wasDragging || wasResizing) {
                setPositionState(currentPos => {
                    const snapped = clampPosition(currentPos.x, currentPos.y, size, true);
                    if (snapped.x !== currentPos.x || snapped.y !== currentPos.y) {
                        onPositionChange?.(snapped);
                    }
                    return snapped;
                });
            }

            if (wasResizing) {
                onResizeEnd?.();
            }
        };

        // Use capture phase for pointerdown so we track pointers before container handler runs
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [size, minSize, resizable, clampPosition, setPosition, setSize, onPositionChange, onResizeEnd]);

    const handleContainerPointerDown = useCallback((e: PointerEvent) => {
        const target = e.target as HTMLElement;
        // Check if clicking on a resize handle - look for data attribute
        if (target.dataset.resizeHandle) {
            return;
        }

        // Don't start drag if multi-touch (let inner canvas handle it)
        if (activePointers.current.size > 1) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        containerRef.current?.setPointerCapture(e.pointerId);
        setSelected(true);
        dragState.current = {
            isDragging: true,
            isResizing: null,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startPosX: position.x,
            startPosY: position.y,
            startSize: size ?? 0,
        };
    }, [position.x, position.y, size, setSelected]);

    const handleResizePointerDown = useCallback((corner: ResizeCorner) => (e: PointerEvent) => {
        if (!resizable) return;

        // Don't start resize if multi-touch
        if (activePointers.current.size > 1) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragState.current = {
            isDragging: false,
            isResizing: corner,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startPosX: position.x,
            startPosY: position.y,
            startSize: size ?? 0,
        };
    }, [resizable, position.x, position.y, size]);

    const renderResizeHandles = useCallback(() => {
        if (!resizable || !selected) return null;

        return h('div', null,
            h('div', {
                className: `${styles.resizeHandle} ${styles.handleTL}`,
                'data-resize-handle': true,
                onPointerDown: handleResizePointerDown('tl'),
            }),
            h('div', {
                className: `${styles.resizeHandle} ${styles.handleTR}`,
                'data-resize-handle': true,
                onPointerDown: handleResizePointerDown('tr'),
            }),
            h('div', {
                className: `${styles.resizeHandle} ${styles.handleBL}`,
                'data-resize-handle': true,
                onPointerDown: handleResizePointerDown('bl'),
            }),
            h('div', {
                className: `${styles.resizeHandle} ${styles.handleBR}`,
                'data-resize-handle': true,
                onPointerDown: handleResizePointerDown('br'),
            }),
        );
    }, [resizable, selected, handleResizePointerDown]);

    return {
        position,
        size,
        selected,
        ready,
        containerRef,
        setPosition,
        setSize,
        setSelected,
        handleContainerPointerDown,
        resizable,
        renderResizeHandles,
    };
}
