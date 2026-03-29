import { supabase } from '../Supabase';

const API_URL = import.meta.env.PUBLIC_GEORAIL_URL;

async function getAuthHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
    };
}

export interface SubscriptionStatus {
    is_premium: boolean;
    premium_source: 'stripe' | 'patreon' | null;
    premium_until: string | null;
    discord_linked: boolean;
    patreon_linked: boolean;
}

export async function fetchSubscriptionStatus(): Promise<SubscriptionStatus | null> {
    const headers = await getAuthHeaders();
    if (!headers) return null;

    try {
        const response = await fetch(`${API_URL}/subscription/status`, { headers });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Error fetching subscription status:', error);
        return null;
    }
}

export async function createStripeCheckout(): Promise<string | null> {
    const headers = await getAuthHeaders();
    if (!headers) return null;

    try {
        const response = await fetch(`${API_URL}/subscription/stripe/checkout`, {
            method: 'POST',
            headers
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.url;
    } catch (error) {
        console.error('Error creating Stripe checkout:', error);
        return null;
    }
}

export async function createStripePortal(): Promise<string | null> {
    const headers = await getAuthHeaders();
    if (!headers) return null;

    try {
        const response = await fetch(`${API_URL}/subscription/stripe/portal`, {
            method: 'POST',
            headers
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.url;
    } catch (error) {
        console.error('Error creating Stripe portal:', error);
        return null;
    }
}

export async function connectDiscord(): Promise<string | null> {
    const headers = await getAuthHeaders();
    if (!headers) return null;

    try {
        const response = await fetch(`${API_URL}/subscription/discord/connect`, { headers });
        if (!response.ok) return null;
        const data = await response.json();
        return data.url;
    } catch (error) {
        console.error('Error getting Discord connect URL:', error);
        return null;
    }
}

export async function connectPatreon(): Promise<string | null> {
    const headers = await getAuthHeaders();
    if (!headers) return null;

    try {
        const response = await fetch(`${API_URL}/subscription/patreon/connect`, { headers });
        if (!response.ok) return null;
        const data = await response.json();
        return data.url;
    } catch (error) {
        console.error('Error getting Patreon connect URL:', error);
        return null;
    }
}
