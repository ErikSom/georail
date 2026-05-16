import { useState } from 'preact/hooks';
import { chooserOpen, currentSavedTrainId, currentIsPersisted, saveCurrent, exportSaved } from '../store/savedTrains';
import { get as getRecord } from '../lib/train/saved/TrainStore';
import type { TrainConfig } from '../lib/train/TrainConfig';

interface Props {
    getCurrentConfig: () => TrainConfig | null;
}

export default function TrainEditorToolbar({ getCurrentConfig }: Props) {
    const [busy, setBusy] = useState(false);

    const handleSave = async () => {
        const cfg = getCurrentConfig();
        if (!cfg) return;
        const currentId = currentSavedTrainId.value;
        let suggestedName = cfg.display?.name?.trim() || 'My Train';
        if (currentId) {
            const existing = await getRecord(currentId);
            if (existing) suggestedName = existing.name;
        }
        const name = prompt('Save train as:', suggestedName);
        if (!name) return;
        setBusy(true);
        try {
            await saveCurrent(name.trim(), cfg);
        } finally {
            setBusy(false);
        }
    };

    const handleExport = async () => {
        const id = currentSavedTrainId.value;
        if (!id || !currentIsPersisted.value) {
            alert('Save the train first, then you can export it.');
            return;
        }
        setBusy(true);
        try {
            await exportSaved(id);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 16,
            left: 16,
            display: 'flex',
            gap: 8,
            zIndex: 50,
        }}>
            <button
                style={btnStyle}
                onClick={() => { chooserOpen.value = true; }}
                disabled={busy}
            >
                Trains
            </button>
            <button
                style={primaryBtnStyle}
                onClick={handleSave}
                disabled={busy}
            >
                Save
            </button>
            <button
                style={btnStyle}
                onClick={handleExport}
                disabled={busy || !currentIsPersisted.value}
                title={currentIsPersisted.value ? 'Export as .georail-train' : 'Save first to enable export'}
            >
                Export
            </button>
        </div>
    );
}

const btnStyle: any = {
    background: '#1a1d24',
    color: '#f5f7f3',
    border: 'none',
    borderRadius: 10,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
};

const primaryBtnStyle: any = {
    ...btnStyle,
    background: 'var(--menu-accent)',
};
