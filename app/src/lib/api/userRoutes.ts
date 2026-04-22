import { supabase } from '../Supabase';
import type { RouteData } from './navigation';

const API_BASE = `${import.meta.env.PUBLIC_GEORAIL_URL}/user-routes`;

async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    return {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
    };
}

export interface UserRouteSummary {
    id: string;
    name: string;
    description: string | null;
    osm_ref: string | null;
    osm_relation_id: number | null;
    point_count: number;
    country: string | null;
    total_plays: number;
    monthly_plays: Record<string, number>;
    created_at: string;
    updated_at: string;
}

export interface UserRouteCaps {
    maxRoutes: number;
    maxPoints: number;
    usedPoints: number;
}

export interface UserRouteFull extends UserRouteSummary {
    user_id: string;
    geometry: RouteData['geometry'];
    stops: Array<{
        station: string;
        code: string;
        track: string | null;
        arrivalTime: number;
        departureTime: number;
    }>;
}

// Publicly-fetchable shape (no user_id).
export type SharedUserRoute = Omit<UserRouteFull, 'user_id'>;

export interface CreateUserRouteInput {
    name: string;
    description?: string | null;
    osm_ref?: string | null;
    osm_relation_id?: number | null;
    country?: string | null;
    geometry: RouteData['geometry'];
    stops: UserRouteFull['stops'];
}

async function toJsonOrThrow(res: Response): Promise<any> {
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    return body;
}

export async function listMyUserRoutes(): Promise<{ routes: UserRouteSummary[]; caps: UserRouteCaps }> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/mine`, { headers });
    return toJsonOrThrow(res);
}

export async function fetchUserRoute(id: string): Promise<UserRouteFull> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { headers });
    return toJsonOrThrow(res);
}

export async function createUserRoute(input: CreateUserRouteInput): Promise<UserRouteFull> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
    });
    return toJsonOrThrow(res);
}

export async function updateUserRoute(id: string, patch: Partial<CreateUserRouteInput>): Promise<UserRouteFull> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
    });
    return toJsonOrThrow(res);
}

export async function deleteUserRoute(id: string): Promise<void> {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
    });
    await toJsonOrThrow(res);
}

// Unauthenticated; UUID is the share secret.
export async function fetchSharedUserRoute(id: string): Promise<SharedUserRoute> {
    const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
    });
    return toJsonOrThrow(res);
}
