import { useEffect, useState } from 'preact/hooks';
import { getDefaultTrainConfig, type TrainConfig } from '../lib/train/TrainConfig';
import {
    chooserOpen,
    currentSavedTrainId,
    currentIsPersisted,
    refresh,
    loadSavedConfig,
    deleteSaved,
    toggleEnabled,
    renameSaved,
    exportSaved,
    importFromFile,
} from '../store/savedTrains';
import { userTrainRecords } from '../lib/train/configs/UserTrainsCatalog';
import styles from './TrainEditorChooser.module.css';

type Tab = 'new' | 'saved' | 'import';

interface Props {
    canClose: boolean;
    onChoose: (config: TrainConfig, dispose: (() => void) | null, savedId: string | null) => void;
}

export default function TrainEditorChooser({ canClose, onChoose }: Props) {
    const [tab, setTab] = useState<Tab>('saved');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void refresh();
    }, []);

    if (!chooserOpen.value) return null;

    const records = userTrainRecords.value;

    const handleNew = () => {
        const config = getDefaultTrainConfig();
        currentIsPersisted.value = false;
        onChoose(config, null, config.display.id);
        chooserOpen.value = false;
    };

    const handleLoad = async (id: string) => {
        setError(null);
        try {
            const { config, dispose } = await loadSavedConfig(id);
            onChoose(config, dispose, id);
            chooserOpen.value = false;
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const handleImport = async (e: Event) => {
        setError(null);
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            await importFromFile(file);
            await refresh();
            setTab('saved');
        } catch (err) {
            setError((err as Error).message);
        }
        input.value = '';
    };

    const close = () => {
        if (!canClose) return;
        chooserOpen.value = false;
    };

    return (
        <div className={styles.backdrop} onClick={close}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Train Editor</h2>
                    {canClose && (
                        <button className={styles.closeBtn} onClick={close} aria-label="Close">
                            ×
                        </button>
                    )}
                </div>

                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${tab === 'saved' ? styles.tabActive : ''}`}
                        onClick={() => setTab('saved')}
                    >
                        Saved ({records.length})
                    </button>
                    <button
                        className={`${styles.tab} ${tab === 'new' ? styles.tabActive : ''}`}
                        onClick={() => setTab('new')}
                    >
                        New
                    </button>
                    <button
                        className={`${styles.tab} ${tab === 'import' ? styles.tabActive : ''}`}
                        onClick={() => setTab('import')}
                    >
                        Import
                    </button>
                </div>

                <div className={styles.content}>
                    {error && <div className={styles.error}>{error}</div>}

                    {tab === 'new' && (
                        <div>
                            <p style={{ marginTop: 0, color: 'var(--menu-light-06)', fontSize: 14 }}>
                                Start from a blank train. Save it when ready to keep it.
                            </p>
                            <button className={styles.primaryBtn} onClick={handleNew}>
                                Start new train
                            </button>
                        </div>
                    )}

                    {tab === 'saved' && (
                        <SavedList
                            records={records}
                            currentId={currentSavedTrainId.value}
                            onLoad={handleLoad}
                        />
                    )}

                    {tab === 'import' && (
                        <div className={styles.importBox}>
                            <p style={{ margin: 0, color: 'var(--menu-light-06)', fontSize: 14 }}>
                                Pick a <code>.georail-train</code> file to add it to your saved trains.
                            </p>
                            <label className={styles.fileLabel}>
                                Choose file…
                                <input
                                    type="file"
                                    accept=".georail-train,application/octet-stream"
                                    onChange={handleImport}
                                />
                            </label>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

interface SavedListProps {
    records: typeof userTrainRecords.value;
    currentId: string | null;
    onLoad: (id: string) => void;
}

function SavedList({ records, currentId, onLoad }: SavedListProps) {
    const [busyId, setBusyId] = useState<string | null>(null);

    if (records.length === 0) {
        return <div className={styles.empty}>No saved trains yet. Use New or Import to add one.</div>;
    }

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
        setBusyId(id);
        try {
            await deleteSaved(id);
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const handleRename = async (id: string, current: string) => {
        const next = prompt('Rename train:', current);
        if (!next || next === current) return;
        setBusyId(id);
        try {
            await renameSaved(id, next.trim());
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const handleToggle = async (id: string) => {
        setBusyId(id);
        try {
            await toggleEnabled(id);
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const handleExport = async (id: string) => {
        setBusyId(id);
        try {
            await exportSaved(id);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div>
            {records.map(r => {
                const isCurrent = r.id === currentId;
                return (
                    <div key={r.id} className={styles.savedRow}>
                        <div className={styles.savedName}>
                            <div className={styles.savedTitle}>
                                {r.name}{isCurrent && ' (loaded)'}
                            </div>
                            <div className={styles.savedMeta}>
                                Updated {new Date(r.updatedAt).toLocaleDateString()}
                            </div>
                        </div>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={r.enabled}
                                disabled={busyId === r.id}
                                onChange={() => handleToggle(r.id)}
                            />
                            In game
                        </label>
                        <div className={styles.rowActions}>
                            <button
                                className={styles.primaryBtn}
                                disabled={busyId === r.id}
                                onClick={() => onLoad(r.id)}
                            >
                                Load
                            </button>
                            <button
                                className={styles.ghostBtn}
                                disabled={busyId === r.id}
                                onClick={() => handleRename(r.id, r.name)}
                            >
                                Rename
                            </button>
                            <button
                                className={styles.ghostBtn}
                                disabled={busyId === r.id}
                                onClick={() => handleExport(r.id)}
                            >
                                Export
                            </button>
                            <button
                                className={styles.dangerBtn}
                                disabled={busyId === r.id}
                                onClick={() => handleDelete(r.id, r.name)}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
