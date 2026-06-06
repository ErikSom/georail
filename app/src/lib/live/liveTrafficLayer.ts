const DEFAULT_DOT_COUNT = 384;
const DOTS_TO_CREATE_PER_FRAME = 32;
const DOT_HIT_SIZE_PX = 32;

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

export class LiveTrafficLayer {
    public readonly root: HTMLDivElement;
    public readonly dots: HTMLDivElement[] = [];
    public readonly ownDot: HTMLDivElement;
    private visibleDotCount = 0;
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

            const trainDot = target.closest('.live-train-dot') as HTMLElement | null;
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

    public hideDots(): void {
        this.setVisibleDotCount(0);
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

    public dispose(): void {
        this.root.remove();
    }
}
