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
import { t, locale, withLocale } from '../i18n';

import styles from './GateScreen.module.css';

interface Props {
    session: Session;
    onLogout: () => void;
    onPremiumChange: () => void;
}

const DATE_LOCALES: Record<string, string> = { en: 'en-US', nl: 'nl-NL' };

export default function AccountScreen({ session, onLogout, onPremiumChange }: Props) {
    const [status, setStatus] = useState<SubscriptionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('stripe') === 'success') {
            setMessage({ type: 'success', text: t('account.messages.stripeSuccess') });
        } else if (params.get('discord') === 'linked') {
            setMessage({ type: 'success', text: t('account.messages.discordLinked') });
        } else if (params.get('patreon') === 'success') {
            setMessage({ type: 'success', text: t('account.messages.patreonSuccess') });
        } else if (params.get('patreon') === 'not_patron') {
            setMessage({ type: 'error', text: t('account.messages.patreonNotPatron') });
        } else if (params.get('discord') === 'error') {
            setMessage({ type: 'error', text: t('account.messages.discordError') });
        } else if (params.get('patreon') === 'error') {
            setMessage({ type: 'error', text: t('account.messages.patreonError') });
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
            setMessage({ type: 'error', text: t('account.messages.checkoutFailed') });
            setActionLoading(null);
        }
    }

    async function handleStripePortal() {
        setActionLoading('portal');
        const url = await createStripePortal();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: t('account.messages.portalFailed') });
            setActionLoading(null);
        }
    }

    async function handleConnectDiscord() {
        setActionLoading('discord');
        const url = await connectDiscord();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: t('account.messages.discordStartFailed') });
            setActionLoading(null);
        }
    }

    async function handleConnectPatreon() {
        setActionLoading('patreon');
        const url = await connectPatreon();
        if (url) window.location.href = url;
        else {
            setMessage({ type: 'error', text: t('account.messages.patreonStartFailed') });
            setActionLoading(null);
        }
    }

    if (loading) {
        return (
            <div className={styles.container}>
                <div className={styles.content}>
                    <TrainSpinner />
                    <p className={styles.loadingText}>{t('account.loading')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>{t('account.title')}</h1>
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
                                const sourceKeys: Record<string, string> = {
                                    stripe: 'account.premium.stripe',
                                    patreon: 'account.premium.patreon',
                                    vip: 'account.premium.vip',
                                    gift: 'account.premium.gift',
                                    influencer: 'account.premium.influencer',
                                };
                                const key = sourceKeys[status.premium_source || ''] || 'account.premium.fallback';
                                return t(key);
                            })()}
                            {status.premium_until && t('account.premium.renewsSuffix', {
                                date: new Date(status.premium_until).toLocaleDateString(DATE_LOCALES[locale.value] ?? 'en-US'),
                            })}
                        </div>

                        {status.premium_source === 'stripe' && (
                            <button
                                className={styles.secondaryBtn}
                                onClick={handleStripePortal}
                                disabled={actionLoading !== null}
                            >
                                {actionLoading === 'portal' ? t('account.premium.manageSubscriptionLoading') : t('account.premium.manageSubscription')}
                            </button>
                        )}

                        <div className={styles.divider}>{t('account.premium.connectionsDivider')}</div>

                        <div className={styles.connectionRow}>
                            <span className={styles.connectionLabel}>
                                <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/discord.svg)', WebkitMaskImage: 'url(/icons/discord.svg)' }} />
                                Discord
                            </span>
                            {status.discord_linked ? (
                                <span className={styles.connectedBadge}>{t('account.connections.connected')}</span>
                            ) : (
                                <button
                                    className={styles.connectBtn}
                                    onClick={handleConnectDiscord}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'discord' ? t('account.connections.connecting') : t('account.connections.connect')}
                                </button>
                            )}
                        </div>

                        <div className={styles.connectionRow}>
                            <span className={styles.connectionLabel}>
                                <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/patreon.svg)', WebkitMaskImage: 'url(/icons/patreon.svg)' }} />
                                Patreon
                            </span>
                            {status.patreon_linked ? (
                                <span className={styles.connectedBadge}>{t('account.connections.connected')}</span>
                            ) : (
                                <button
                                    className={styles.connectBtn}
                                    onClick={handleConnectPatreon}
                                    disabled={actionLoading !== null}
                                >
                                    {actionLoading === 'patreon' ? t('account.connections.connecting') : t('account.connections.connect')}
                                </button>
                            )}
                        </div>

                        <button className={styles.logoutBtn} onClick={onLogout}>{t('account.logout')}</button>
                    </>
                ) : (
                    <>
                        <div className={styles.earlyAccessBanner}>
                            <span className={styles.earlyAccessTag}>{t('account.subscribe.earlyAccessTag')}</span>
                            <p>
                                {t('account.subscribe.earlyAccessBefore')}
                                <a href={withLocale('/faq', locale.value)}>
                                    {t('account.subscribe.faqLinkText')}
                                </a>
                                {t('account.subscribe.earlyAccessMiddle')}
                                <a
                                    href="https://discord.gg/JTZBKZfq2h"
                                    target="_blank"
                                    rel="noreferrer noopener"
                                >
                                    {t('account.subscribe.discordLinkText')}
                                </a>
                                {t('account.subscribe.earlyAccessAfter')}
                            </p>
                        </div>
                        <p className={styles.subscribeText}>
                            {t('account.subscribe.callToAction')}
                        </p>
                        <button
                            className={styles.primaryBtn}
                            onClick={handleStripeCheckout}
                            disabled={actionLoading !== null}
                        >
                            {actionLoading === 'stripe' ? t('account.subscribe.subscribeLoading') : t('account.subscribe.subscribe')}
                        </button>
                        <div className={styles.divider}>{t('account.subscribe.or')}</div>
                        <button
                            className={styles.patreonBtn}
                            onClick={handleConnectPatreon}
                            disabled={actionLoading !== null}
                        >
                            <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/patreon.svg)', WebkitMaskImage: 'url(/icons/patreon.svg)' }} />
                            {actionLoading === 'patreon' ? t('account.subscribe.subscribePatreonLoading') : t('account.subscribe.subscribePatreon')}
                        </button>
                        <button className={styles.logoutBtn} onClick={onLogout}>{t('account.logout')}</button>
                    </>
                )}
            </div>
        </div>
    );
}
