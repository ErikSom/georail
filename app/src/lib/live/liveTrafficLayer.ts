const DEFAULT_DOT_COUNT = 384;
const DOTS_TO_CREATE_PER_FRAME = 32;
const DOT_HIT_SIZE_PX = 32;

export type LiveTrafficLabelVariant = 'default' | 'selected' | 'own';

export interface LiveTrafficLayerOptions {
    parent?: HTMLElement | null;
    wheelTarget?: HTMLElement | null;
    maxDots?: number;
    onSelectTrain: (id: string) => void;
    onSelectOwnTrain: () => void;
}

function assignStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
    Object.assign(element.style, styles);
}

const LABEL_VARIANT_STYLES: Record<LiveTrafficLabelVariant, Partial<CSSStyleDeclaration>> = {
    default: {
        border: '1px solid rgba(245, 247, 243, 0.18)',
        background: 'rgba(30, 31, 36, 0.86)',
        boxShadow: '0 8px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
    },
    selected: {
        border: '1px solid rgba(255, 190, 107, 0.96)',
        background: 'rgba(30, 31, 36, 0.96)',
        boxShadow: '0 9px 22px rgba(0, 0, 0, 0.42), 0 0 0 2px rgba(255, 190, 107, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    },
    own: {
        border: '1px solid rgba(52, 115, 230, 0.7)',
        background: 'rgba(30, 31, 36, 0.96)',
        boxShadow: '0 9px 22px rgba(0, 0, 0, 0.42), 0 0 0 2px rgba(52, 115, 230, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    },
};

export class LiveTrafficLayer {
    public readonly root: HTMLDivElement;
    public readonly dots: HTMLDivElement[] = [];
    public readonly labels: HTMLDivElement[] = [];
    public readonly ownDot: HTMLDivElement;
    public readonly ownLabel: HTMLDivElement;
    private visibleDotCount = 0;
    private visibleLabelCount = 0;
    private readonly maxDots: number;
    private readonly wheelTarget: HTMLElement | null;

    constructor(options: LiveTrafficLayerOptions) {
        const parent = options.parent ?? document.body;
        this.maxDots = options.maxDots ?? DEFAULT_DOT_COUNT;
        this.wheelTarget = options.wheelTarget ?? null;
        this.root = document.createElement('div');
        this.root.className = 'live-traffic-overlay';
        assignStyles(this.root, {
            position: parent === document.body ? 'fixed' : 'absolute',
            inset: '0',
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: parent === document.body ? '1' : '',
        });
        parent.appendChild(this.root);
        this.root.addEventListener('wheel', (event) => this.forwardWheelToCanvas(event), { passive: false });
        this.root.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const ownDot = target.closest('.live-train-own-dot');
            if (ownDot && this.root.contains(ownDot)) {
                event.preventDefault();
                event.stopPropagation();
                options.onSelectOwnTrain();
                return;
            }

            const trainDot = target.closest('.live-train-dot, .live-train-label') as HTMLElement | null;
            if (!trainDot || !this.root.contains(trainDot)) return;

            const id = trainDot.dataset.trainId;
            if (!id) return;

            event.preventDefault();
            event.stopPropagation();
            options.onSelectTrain(id);
        });

        this.ownDot = document.createElement('div');
        this.ownDot.className = 'live-traffic-own-dot live-train-own-dot';
        assignStyles(this.ownDot, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: `${DOT_HIT_SIZE_PX}px`,
            height: `${DOT_HIT_SIZE_PX}px`,
            borderRadius: '999px',
            display: 'none',
            willChange: 'transform',
            pointerEvents: 'auto',
            cursor: 'pointer',
            touchAction: 'none',
        });
        this.ownDot.appendChild(this.createDotVisual('live-traffic-own-dot-visual'));
        this.root.appendChild(this.ownDot);

        this.ownLabel = this.createLabelElement('live-traffic-own-label live-train-own-dot');
        this.root.appendChild(this.ownLabel);
    }

    private forwardWheelToCanvas(event: WheelEvent): void {
        if (!this.wheelTarget || event.defaultPrevented) return;

        const forwarded = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            composed: true,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            deltaMode: event.deltaMode,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            button: event.button,
            buttons: event.buttons,
        });
        this.wheelTarget.dispatchEvent(forwarded);
        if (forwarded.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    private createDotVisual(className: string): HTMLDivElement {
        const visual = document.createElement('div');
        visual.className = className;
        assignStyles(visual, {
            position: 'absolute',
            left: '50%',
            top: '50%',
            borderRadius: '999px',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
        });
        return visual;
    }

    public ensureDotCapacity(targetCount: number): void {
        const wanted = Math.max(0, Math.min(this.maxDots, targetCount));
        const limit = Math.min(wanted, this.dots.length + DOTS_TO_CREATE_PER_FRAME);
        while (this.dots.length < limit) {
            const dot = document.createElement('div');
            dot.className = 'live-traffic-dot live-train-dot';
            assignStyles(dot, {
                position: 'absolute',
                left: '0',
                top: '0',
                width: `${DOT_HIT_SIZE_PX}px`,
                height: `${DOT_HIT_SIZE_PX}px`,
                borderRadius: '999px',
                display: 'none',
                willChange: 'transform',
                pointerEvents: 'auto',
                cursor: 'pointer',
                touchAction: 'none',
            });
            dot.appendChild(this.createDotVisual('live-traffic-dot-visual'));
            this.root.appendChild(dot);
            this.dots.push(dot);
        }
    }

    public ensureLabelCapacity(targetCount: number): void {
        const wanted = Math.max(0, Math.min(this.maxDots, targetCount));
        const limit = Math.min(wanted, this.labels.length + DOTS_TO_CREATE_PER_FRAME);
        while (this.labels.length < limit) {
            const label = this.createLabelElement('live-traffic-label live-train-label');
            this.root.appendChild(label);
            this.labels.push(label);
        }
    }

    private createLabelElement(className: string): HTMLDivElement {
        const label = document.createElement('div');
        label.className = className;
        assignStyles(label, {
            position: 'absolute',
            left: '0',
            top: '0',
            minWidth: '0',
            height: '34px',
            boxSizing: 'border-box',
            display: 'none',
            alignItems: 'center',
            gap: '7px',
            padding: '4px 10px 4px 4px',
            borderRadius: '999px',
            border: LABEL_VARIANT_STYLES.default.border ?? '',
            background: LABEL_VARIANT_STYLES.default.background ?? '',
            boxShadow: LABEL_VARIANT_STYLES.default.boxShadow ?? '',
            backdropFilter: 'blur(8px)',
            webkitBackdropFilter: 'blur(8px)',
            color: 'var(--menu-light, #f5f7f3)',
            font: '700 12px/14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            letterSpacing: '0',
            whiteSpace: 'nowrap',
            willChange: 'transform',
            pointerEvents: 'auto',
            cursor: 'pointer',
            touchAction: 'none',
            userSelect: 'none',
            transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
        });

        const img = document.createElement('img');
        img.className = 'live-traffic-label-avatar';
        img.alt = '';
        img.draggable = false;
        assignStyles(img, {
            width: '24px',
            height: '24px',
            borderRadius: '999px',
            objectFit: 'cover',
            background: 'var(--menu-light, #f5f7f3)',
            border: '1px solid rgba(245, 247, 243, 0.2)',
            flex: '0 0 auto',
            pointerEvents: 'none',
        });

        const text = document.createElement('span');
        text.className = 'live-traffic-label-text';
        assignStyles(text, {
            display: 'block',
            maxWidth: '86px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.55)',
            fontVariantNumeric: 'tabular-nums',
        });

        label.append(img, text);
        return label;
    }

    public setLabelContent(label: HTMLElement, text: string, avatarUrl: string | null): void {
        const avatar = label.querySelector<HTMLImageElement>('.live-traffic-label-avatar');
        const textEl = label.querySelector<HTMLElement>('.live-traffic-label-text');
        if (textEl) textEl.textContent = text;
        if (!avatar) return;
        if (avatarUrl) {
            avatar.src = avatarUrl;
            avatar.style.display = '';
            label.style.padding = '4px 10px 4px 4px';
            label.style.gap = '7px';
        } else {
            avatar.removeAttribute('src');
            avatar.style.display = 'none';
            label.style.padding = '7px 12px';
            label.style.gap = '0';
        }
    }

    public setLabelVariant(label: HTMLElement, variant: LiveTrafficLabelVariant): void {
        assignStyles(label, LABEL_VARIANT_STYLES[variant]);
        label.classList.toggle('is-selected', variant === 'selected');
        label.classList.toggle('is-own', variant === 'own');
    }

    public hideDots(): void {
        this.setVisibleDotCount(0);
    }

    public hideLabels(): void {
        this.setVisibleLabelCount(0);
    }

    public setVisibleDotCount(count: number): void {
        const nextCount = Math.max(0, Math.min(this.dots.length, count));
        for (let i = nextCount; i < this.visibleDotCount; i++) {
            const dot = this.dots[i];
            dot.dataset.trainId = '';
            dot.classList.remove('is-selected');
            dot.style.display = 'none';
        }
        this.visibleDotCount = nextCount;
    }

    public setVisibleLabelCount(count: number): void {
        const nextCount = Math.max(0, Math.min(this.labels.length, count));
        for (let i = nextCount; i < this.visibleLabelCount; i++) {
            const label = this.labels[i];
            label.dataset.trainId = '';
            label.classList.remove('is-selected');
            label.style.display = 'none';
        }
        this.visibleLabelCount = nextCount;
    }

    public dispose(): void {
        this.root.remove();
    }
}
