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

import gateStyles from './GateScreen.module.css';
import menuStyles from './MenuScreen.module.css';

interface Props {
    session: Session | null;
    onLogout: () => void;
    onPremiumChange: () => void;
}

export default function AccountScreen({ session, onLogout, onPremiumChange }: Props) {
    const [status, setStatus] = useState<SubscriptionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        if (!session) {
            setLoading(false);
            return;
        }

        // Check URL params for status messages
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

        // If returning from Stripe, poll for webhook to process
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

    const renderContent = () => {
        if (!session) {
            return (
                <div className={gateStyles.container}>
                    <div className={gateStyles.content}>
                        <p className={gateStyles.subscribeText}>Please log in to manage your account.</p>
                    </div>
                </div>
            );
        }

        if (loading) {
            return (
                <div className={gateStyles.container}>
                    <div className={gateStyles.content}>
                        <p className={gateStyles.loadingText}>Loading account...</p>
                    </div>
                </div>
            );
        }

        return (
            <div className={gateStyles.container}>
                <h1 className={gateStyles.title}>Account</h1>
                <div className={gateStyles.content}>
                    <p className={gateStyles.subscribeText}>{session.user.email}</p>

                    {message && (
                        <div className={message.type === 'success' ? gateStyles.successBanner : gateStyles.errorText}>
                            {message.text}
                        </div>
                    )}

                    {status?.is_premium ? (
                        <>
                            <div className={gateStyles.successBanner}>
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
                                    className={gateStyles.secondaryBtn}
                                    onClick={handleStripePortal}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'portal' ? 'Opening...' : 'Manage Subscription'}
                                </button>
                            )}

                            <div className={gateStyles.divider}>connections</div>

                            <div className={gateStyles.connectionRow}>
                                <span className={gateStyles.connectionLabel}>Discord</span>
                                {status.discord_linked ? (
                                    <span className={gateStyles.connectedBadge}>Connected</span>
                                ) : (
                                    <button
                                        className={gateStyles.connectBtn}
                                        onClick={handleConnectDiscord}
                                        disabled={actionLoading !== null}
                                    >
                                        {actionLoading === 'discord' ? 'Connecting...' : 'Connect'}
                                    </button>
                                )}
                            </div>

                            <div className={gateStyles.connectionRow}>
                                <span className={gateStyles.connectionLabel}>Patreon</span>
                                {status.patreon_linked ? (
                                    <span className={gateStyles.connectedBadge}>Connected</span>
                                ) : (
                                    <button
                                        className={gateStyles.connectBtn}
                                        onClick={handleConnectPatreon}
                                        disabled={actionLoading !== null}
                                    >
                                        {actionLoading === 'patreon' ? 'Connecting...' : 'Connect'}
                                    </button>
                                )}
                            </div>

                            <button className={gateStyles.logoutBtn} onClick={onLogout}>Logout</button>
                        </>
                    ) : (
                        <>
                            <p className={gateStyles.subscribeText}>
                                Subscribe to get access to GeoRail and the premium Discord.
                            </p>
                            <button
                                className={gateStyles.primaryBtn}
                                onClick={handleStripeCheckout}
                                disabled={actionLoading !== null}
                            >
                                {actionLoading === 'stripe' ? 'Redirecting...' : 'Subscribe with Stripe'}
                            </button>
                            <div className={gateStyles.divider}>or</div>
                            <button
                                className={gateStyles.patreonBtn}
                                onClick={handleConnectPatreon}
                                disabled={actionLoading !== null}
                            >
                                {actionLoading === 'patreon' ? 'Redirecting...' : "I'm a Patron"}
                            </button>
                            <button className={gateStyles.logoutBtn} onClick={onLogout}>Logout</button>
                        </>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={menuStyles.screen}>
            <div className={menuStyles.logoWrapper}>
                <div className={menuStyles.trapezoid} />
                <img src="/logo.svg" alt="Georail" className={menuStyles.logo} />
            </div>
            {renderContent()}
            <footer className={menuStyles.footer}>&copy; 2025 Terminarch Games</footer>
        </div>
    );
}
