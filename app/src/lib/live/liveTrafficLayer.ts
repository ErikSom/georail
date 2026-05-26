const DEFAULT_DOT_COUNT = 512;

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

    constructor(options: LiveTrafficLayerOptions) {
        const parent = options.parent ?? document.body;
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

        const maxDots = options.maxDots ?? DEFAULT_DOT_COUNT;
        for (let i = 0; i < maxDots; i++) {
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
            dot.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = dot.dataset.trainId;
                if (id) options.onSelectTrain(id);
            });
            this.root.appendChild(dot);
            this.dots.push(dot);
        }

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
        this.ownDot.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onSelectOwnTrain();
        });
        this.root.appendChild(this.ownDot);
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
