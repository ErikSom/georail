import { useState, useEffect } from 'preact/hooks';
import { trainInstance } from '../../store/train';
import { routeData, trainPath, stopStatuses, elapsedMinutes } from '../../store/journey';

export default function DebugPanel() {
    const [open, setOpen] = useState(false);
    const [jumpInput, setJumpInput] = useState('');

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'F3') {
                e.preventDefault();
                setOpen(prev => {
                    if (!prev) logStationTable();
                    return !prev;
                });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    if (!open) return null;

    const route = routeData.value;
    const stops = route?.properties?.stops ?? [];
    const stopIndices = route?.geometry?.stop_indices ?? [];

    const jumpTo = (pointIndex: number) => {
        const train = trainInstance.value;
        const path = trainPath.value;
        if (!train || !path) return;
        const distance = path.getDistanceAtPointIndex(pointIndex);
        if (!Number.isFinite(distance)) return;

        // Skip sub-paths whose end lies at or before the target so physics bounds
        // line up with the jumped-to position.
        while (train.getCurrentSegmentIndex() < path.getSegmentCount() - 1) {
            const bounds = path.getSegmentBounds(train.getCurrentSegmentIndex());
            if (distance <= bounds.endGlobal) break;
            if (!train.advanceToNextSegment()) break;
        }

        train.distanceTraveled = distance;

        // Mark every stop at-or-before the target as arrived + departed so the
        // Transit HUD matches what the player would have seen by driving there.
        const nowMinutes = elapsedMinutes.value;
        const existing = stopStatuses.value;
        const stopsArr = route?.properties?.stops ?? [];
        const indices = route?.geometry?.stop_indices ?? [];
        const updated = existing.map((status, i) => {
            const stopIdx = indices[i];
            if (stopIdx === undefined || stopIdx > pointIndex) return status;
            const expected = stopsArr[i];
            return {
                ...status,
                arrived: true,
                departed: true,
                actualArrivalTime: status.actualArrivalTime ?? expected?.arrivalTime ?? nowMinutes,
                actualDepartureTime: status.actualDepartureTime ?? expected?.departureTime ?? nowMinutes,
                arrivalDelta: status.arrivalDelta ?? 0,
                departureDelta: status.departureDelta ?? 0,
            };
        });
        stopStatuses.value = updated;
    };

    const handleJumpInput = () => {
        const n = parseInt(jumpInput, 10);
        if (Number.isFinite(n)) jumpTo(n);
    };

    const panel = {
        position: 'fixed' as const,
        top: 12,
        left: 12,
        zIndex: 9999,
        background: 'rgba(15, 15, 20, 0.92)',
        color: '#fff',
        border: '1px solid #3a3a3a',
        borderRadius: 6,
        padding: 12,
        fontFamily: 'monospace',
        fontSize: 12,
        minWidth: 260,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 8,
    };
    const row = {
        display: 'grid' as const,
        gridTemplateColumns: '48px 1fr auto',
        gap: 8,
        padding: '3px 4px',
        cursor: 'pointer',
        borderRadius: 3,
    };

    return (
        <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Debug · F3</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
                <input
                    type="number"
                    value={jumpInput}
                    onInput={(e) => setJumpInput((e.target as HTMLInputElement).value)}
                    placeholder="point index"
                    style={{ flex: 1, background: '#222', color: '#fff', border: '1px solid #3a3a3a', borderRadius: 3, padding: '4px 6px', fontFamily: 'monospace', fontSize: 12 }}
                />
                <button
                    onClick={handleJumpInput}
                    style={{ padding: '4px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}
                >Jump</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, marginTop: 4 }}>
                {stops.length === 0 && <div style={{ color: '#888' }}>No route loaded.</div>}
                {stops.map((s, i) => {
                    const idx = stopIndices[i] ?? -1;
                    return (
                        <div
                            key={i}
                            style={row}
                            onClick={() => jumpTo(idx)}
                            onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.background = '#1f2937'}
                            onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                        >
                            <span style={{ color: '#888' }}>{idx}</span>
                            <span>{s.station}</span>
                            <span style={{ color: '#6b7280' }}>{s.code}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function logStationTable() {
    const route = routeData.value;
    if (!route) return;
    const stops = route.properties?.stops ?? [];
    const stopIndices = route.geometry?.stop_indices ?? [];
    console.table(stops.map((s, i) => ({
        index: stopIndices[i] ?? -1,
        station: s.station,
        code: s.code,
        track: s.track ?? '—',
    })));
}
