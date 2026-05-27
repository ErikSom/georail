const DEFAULT_DOT_COUNT = 384;
const DOTS_TO_CREATE_PER_FRAME = 32;

export interface LiveTrafficLayerOptions {
    parent?: HTMLElement | null;
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

    constructor(options: LiveTrafficLayerOptions) {
        const parent = options.parent ?? document.body;
        this.maxDots = options.maxDots ?? DEFAULT_DOT_COUNT;
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
            borderRadius: '999px',
            display: 'none',
            willChange: 'transform',
            pointerEvents: 'auto',
            cursor: 'pointer',
        });
        this.root.appendChild(this.ownDot);
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
                borderRadius: '999px',
                display: 'none',
                willChange: 'transform',
                pointerEvents: 'auto',
                cursor: 'pointer',
            });
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
