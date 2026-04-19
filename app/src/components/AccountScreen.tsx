import { useState, useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import {
    fetchSubscriptionStatus,
    createStripeCheckout,
    createStripePortal,
    connectDiscord,
    connectPatreon,
    type SubscriptionStatus
} from '../lib/api/subscription';
import TrainSpinner from './TrainSpinner';

import styles from './GateScreen.module.css';

interface Props {
    session: Session;
    onLogout: () => void;
    onPremiumChange: () => void;
}

export default function AccountScreen({ session, onLogout, onPremiumChange }: Props) {
    const [status, setStatus] = useState<SubscriptionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('stripe') === 'success') {
            setMessage({ type: 'success', text: 'Subscription activated! It may take a moment to update.' });
        } else if (params.get('discord') === 'linked') {
            setMessage({ type: 'success', text: 'Discord account connected!' });
        } else if (params.get('patreon') === 'success') {
            setMessage({ type: 'success', text: 'Patreon linked and premium activated!' });
        } else if (params.get('patreon') === 'not_patron') {
            setMessage({ type: 'error', text: 'Your Patreon account is linked but you are not an active patron.' });
        } else if (params.get('discord') === 'error') {
            setMessage({ type: 'error', text: 'Failed to connect Discord. Please try again.' });
        } else if (params.get('patreon') === 'error') {
            setMessage({ type: 'error', text: 'Failed to connect Patreon. Please try again.' });
        }

        if (params.toString()) {
            window.history.replaceState({}, '', window.location.pathname);
        }

        loadStatus();

        if (params.get('stripe') === 'success') {
            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                const data = await fetchSubscriptionStatus();
                if (data?.is_premium) {
                    setStatus(data);
                    setMessage(null);
                    onPremiumChange();
                    clearInterval(poll);
                } else if (attempts >= 5) {
                    clearInterval(poll);
                }
            }, 2000);
            return () => clearInterval(poll);
        }
    }, [session]);

    async function loadStatus() {
        setLoading(true);
        const data = await fetchSubscriptionStatus();
        setStatus(data);
        setLoading(false);
    }

    async function handleStripeCheckout() {
        setActionLoading('stripe');
        const url = await createStripeCheckout();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: 'Failed to start checkout.' });
            setActionLoading(null);
        }
    }

    async function handleStripePortal() {
        setActionLoading('portal');
        const url = await createStripePortal();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: 'Failed to open subscription management.' });
            setActionLoading(null);
        }
    }

    async function handleConnectDiscord() {
        setActionLoading('discord');
        const url = await connectDiscord();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: 'Failed to start Discord connection.' });
            setActionLoading(null);
        }
    }

    async function handleConnectPatreon() {
        setActionLoading('patreon');
        const url = await connectPatreon();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: 'Failed to start Patreon connection.' });
            setActionLoading(null);
        }
    }

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.content}>
                    <TrainSpinner />
                    <p className={styles.loadingText}>Departing shortly...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>Account</h1>
            <div className={styles.content}>
                <p className={styles.subscribeText}>{session.user.email}</p>

                {message && (
                    <div className={message.type === 'success' ? styles.successBanner : styles.errorText}>
                        {message.text}
                    </div>
                )}

                {status?.is_premium ? (
                    <>
                        <div className={styles.successBanner}>
                            {(() => {
                                const labels: Record<string, string> = {
                                    stripe: 'Premium — via Stripe',
                                    patreon: 'Premium — via Patreon',
                                    vip: 'VIP — First class',
                                    gift: 'Gift — Enjoy the ride!',
                                    influencer: 'Influencer — All aboard',
                                };
                                return labels[status.premium_source || ''] || 'Premium';
                            })()}
                            {status.premium_until && ` — renews ${new Date(status.premium_until).toLocaleDateString()}`}
                        </div>

                        {status.premium_source === 'stripe' && (
                            <button
                                className={styles.secondaryBtn}
                                onClick={handleStripePortal}
                                disabled={actionLoading !== null}
                            >
                                {actionLoading === 'portal' ? 'Opening...' : 'Manage Subscription'}
                            </button>
                        )}

                        <div className={styles.divider}>connections</div>

                        <div className={styles.connectionRow}>
                            <span className={styles.connectionLabel}>
                                <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/discord.svg)', WebkitMaskImage: 'url(/icons/discord.svg)' }} />
                                Discord
                            </span>
                            {status.discord_linked ? (
                                <span className={styles.connectedBadge}>Connected</span>
                            ) : (
                                <button
                                    className={styles.connectBtn}
                                    onClick={handleConnectDiscord}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'discord' ? 'Connecting...' : 'Connect'}
                                </button>
                            )}
                        </div>

                        <div className={styles.connectionRow}>
                            <span className={styles.connectionLabel}>
                                <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/patreon.svg)', WebkitMaskImage: 'url(/icons/patreon.svg)' }} />
                                Patreon
                            </span>
                            {status.patreon_linked ? (
                                <span className={styles.connectedBadge}>Connected</span>
                            ) : (
                                <button
                                    className={styles.connectBtn}
                                    onClick={handleConnectPatreon}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'patreon' ? 'Connecting...' : 'Connect'}
                                </button>
                            )}
                        </div>

                        <button className={styles.logoutBtn} onClick={onLogout}>Logout</button>
                    </>
                ) : (
                    <>
                        <div className={styles.earlyAccessBanner}>
                            <span className={styles.earlyAccessTag}>Early Access</span>
                            <p>
                                GeoRail is in active development. Features, content, and pricing will evolve over time.
                                Before subscribing, please read more about what the game is (and isn't) on our{' '}
                                <a
                                    href="https://discord.gg/JTZBKZfq2h"
                                    target="_blank"
                                    rel="noreferrer noopener"
                                >
                                    Discord
                                </a>
                                .
                            </p>
                        </div>
                        <p className={styles.subscribeText}>
                            Subscribe to get access to GeoRail and the premium Discord.
                        </p>
                        <button
                            className={styles.primaryBtn}
                            onClick={handleStripeCheckout}
                            disabled={actionLoading !== null}
                        >
                            {actionLoading === 'stripe' ? 'Redirecting...' : 'Subscribe'}
                        </button>
                        <div className={styles.divider}>or</div>
                        <button
                            className={styles.patreonBtn}
                            onClick={handleConnectPatreon}
                            disabled={actionLoading !== null}
                        >
                            <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/patreon.svg)', WebkitMaskImage: 'url(/icons/patreon.svg)' }} />
                            {actionLoading === 'patreon' ? 'Redirecting...' : 'Subscribe on Patreon'}
                        </button>
                        <button className={styles.logoutBtn} onClick={onLogout}>Logout</button>
                    </>
                )}
            </div>
        </div>
    );
}
