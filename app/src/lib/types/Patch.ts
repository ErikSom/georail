export type PatchStatus = 'editing' | 'pending' | 'approved' | 'declined';

export interface Patch {
    id: number;
    user_id: string;
    status: PatchStatus;
    created_at: string;
    reviewed_at?: string;
    reviewed_by?: string;
    // Route information
    from_station?: string;
    from_track?: string;
    to_station?: string;
    to_track?: string;
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
    description?: string;
}

export interface RouteInfo {
    fromStation: string;
    fromTrack: string;
    toStation: string;
    toTrack: string;
    description?: string;
}
