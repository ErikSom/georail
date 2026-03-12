export type PatchStatus = 'editing' | 'pending' | 'approved' | 'declined';

export interface Patch {
    id: number;
    user_id: string;
    status: PatchStatus;
    created_at: string;
    reviewed_at?: string;
    reviewed_by?: string;
    decline_reason?: string;
    // Route information
    from_station?: string;
    from_track?: string;
    to_station?: string;
    to_track?: string;
    via_stops?: ViaStop[];
    description?: string;
}

export interface PatchData {
    patch_id: number;
    segment_id: number;
    point_index: number;
    world_offset: [number, number, number]; // [x, y, z]
    keynode: boolean;
}

export interface PatchWithData extends Patch {
    data: PatchData[];
}

export interface PatchDataInput {
    segment_id: number;
    index: number;
    world_offset_x: number;
    world_offset_y: number;
    world_offset_z: number;
    keynode?: boolean;
}

export interface SubmitPatchInput {
    data: PatchDataInput[];
    patchId?: number; // For updating existing patch
    fromStation?: string;
    fromTrack?: string;
    toStation?: string;
    toTrack?: string;
    viaStops?: ViaStop[];
    description?: string;
}

export interface ViaStop {
    station: string;
    stationCode: string;
    track: string;
}

export interface RouteInfo {
    fromStation: string;
    fromStationCode: string;
    fromTrack: string;
    toStation: string;
    toStationCode: string;
    toTrack: string;
    viaStops?: ViaStop[];
    description?: string;
}

export interface LineCoverage {
    line_ref: string;
    description: string | null;
    segment_count: number;
    total_points: number;
    covered_points: number;
    coverage_pct: number | null;
    length_km: number;
}

export interface NetworkCoverage {
    summary: {
        total_segments: number;
        total_points: number;
        covered_points: number;
        coverage_pct: number | null;
        total_length_km: number;
    };
    lines: LineCoverage[];
}

export interface OpenRoute {
    station_a: string;
    station_b: string;
    code_a: string;
    code_b: string;
    line_ref: string | null;
    line_description: string | null;
    segment_count: number;
    points_to_do: number;
    length_km: number;
}
