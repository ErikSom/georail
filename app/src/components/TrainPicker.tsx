import { useEffect, useRef, useState } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { TrainPickerWorld } from '../lib/TrainPickerWorld';
import { trainCatalog, getOperators, type TrainOperator, type TrainCatalogEntry } from '../lib/train/configs/TrainCatalog';
import { selectedTrainId } from '../store/train';
import { appScreen } from '../store/app';
import TrainSpinner from './TrainSpinner';
import styles from './TrainPicker.module.css';

type OperatorFilter = 'all' | TrainOperator;

export default function TrainPicker() {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const worldRef = useRef<TrainPickerWorld | null>(null);

    const initialId = selectedTrainId.value;
    const previewing = useSignal<string>(initialId);
    const [operatorFilter, setOperatorFilter] = useState<OperatorFilter>('all');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!mountRef.current || worldRef.current) return;

        const world = new TrainPickerWorld(mountRef.current, initialId, setLoading);
        world.init();
        worldRef.current = world;

        return () => {
            world.cleanup();
            worldRef.current = null;
        };
    }, []);

    const operators = getOperators();
    const showOperatorTabs = operators.length > 1;
    const visibleTrains = operatorFilter === 'all'
        ? trainCatalog
        : trainCatalog.filter(e => e.operator === operatorFilter);

    const previewedEntry: TrainCatalogEntry =
        trainCatalog.find(e => e.id === previewing.value) ?? trainCatalog[0];

    const handlePreview = (id: string) => {
        if (previewing.value === id) return;
        previewing.value = id;
        worldRef.current?.selectTrain(id);
    };

    const handleConfirm = () => {
        selectedTrainId.value = previewing.value;
        appScreen.value = 'game';
    };

    const handleBack = () => {
        appScreen.value = 'menu';
    };

    return (
        <div className={styles.root}>
            <div ref={mountRef} className={styles.canvasMount} />

            {loading && (
                <div className={styles.spinnerWrap}>
                    <TrainSpinner />
                </div>
            )}

            <div className={styles.topBar}>
                <button className={styles.backButton} onClick={handleBack}>
                    ← Change route
                </button>
                <h1 className={styles.title}>Select your train</h1>
                <div className={styles.titleSpacer} />
            </div>

            {showOperatorTabs && (
                <div className={styles.operatorTabs}>
                    <button
                        className={`${styles.operatorTab} ${operatorFilter === 'all' ? styles.operatorTabActive : ''}`}
                        onClick={() => setOperatorFilter('all')}
                    >
                        All
                    </button>
                    {operators.map(op => (
                        <button
                            key={op}
                            className={`${styles.operatorTab} ${operatorFilter === op ? styles.operatorTabActive : ''}`}
                            onClick={() => setOperatorFilter(op)}
                        >
                            {op}
                        </button>
                    ))}
                </div>
            )}

            <div className={styles.detailPanel}>
                <p className={styles.detailOperator}>{previewedEntry.operator}</p>
                <h2 className={styles.detailName}>{previewedEntry.name}</h2>
                <div className={styles.detailStats}>
                    <div className={styles.detailStat}>
                        <span className={styles.detailStatLabel}>Top speed</span>
                        <span className={styles.detailStatValue}>{previewedEntry.topSpeedKmh} km/h</span>
                    </div>
                    {previewedEntry.era && (
                        <div className={styles.detailStat}>
                            <span className={styles.detailStatLabel}>Era</span>
                            <span className={styles.detailStatValue}>{previewedEntry.era}</span>
                        </div>
                    )}
                </div>
                {previewedEntry.description && (
                    <p className={styles.detailDescription}>{previewedEntry.description}</p>
                )}
            </div>

            <button className={styles.selectButton} onClick={handleConfirm}>
                Select {previewedEntry.name} →
            </button>

            <div className={styles.cardStrip}>
                {visibleTrains.map(entry => (
                    <button
                        key={entry.id}
                        className={`${styles.card} ${previewing.value === entry.id ? styles.cardActive : ''}`}
                        onClick={() => handlePreview(entry.id)}
                    >
                        <div className={styles.cardOperator}>{entry.operator}</div>
                        <div className={styles.cardName}>{entry.name}</div>
                        <div className={styles.cardTopSpeed}>{entry.topSpeedKmh} km/h</div>
                    </button>
                ))}
                <div className={styles.cardSoon} aria-disabled="true">
                    <div className={styles.cardSoonLabel}>More trains</div>
                    <div className={styles.cardSoonSub}>coming soon</div>
                </div>
            </div>
        </div>
    );
}
