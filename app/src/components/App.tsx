import { useState, useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabase';
import { fetchUserProfile, clearProfileCache, type UserProfile } from '../lib/api/profile';
import MenuScreen from './MenuScreen';
import ThreeViewer from './ThreeViewer';
import BottomTabs, { type TabId } from './BottomTabs';
import SplashOverlay from './SplashOverlay';
import LanguageSelector from './LanguageSelector';
import { appScreen } from '../store/app';
import { startUserRouteJourney, refreshActiveSession } from '../store/journey';
import { fetchSharedUserRoute } from '../lib/api/userRoutes';
import type { RouteData } from '../lib/api/navigation';
import { stripLocale, withLocale, locale, detectLocaleFromPath } from '../i18n';

function currentTab(): TabId {
    if (typeof window === 'undefined') return 'journey';
    return stripLocale(window.location.pathname) === '/account' ? 'account' : 'journey';
}

function isCreditsRoute(): boolean {
    if (typeof window === 'undefined') return false;
    return stripLocale(window.location.pathname) === '/credits';
}

function isFaqRoute(): boolean {
    if (typeof window === 'undefined') return false;
    return stripLocale(window.location.pathname) === '/faq';
}

export default function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabId>(currentTab);
    const [showSplash, setShowSplash] = useState(true);
    const [recoveryMode, setRecoveryMode] = useState(false);
    const [showCredits, setShowCredits] = useState(isCreditsRoute);
    const [showFaq, setShowFaq] = useState(isFaqRoute);

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                setRecoveryMode(true);
                setSession(session);
                setLoading(false);
                return;
            }
            setSession(session);
            if (!session) {
                setProfile(null);
                clearProfileCache();
                setLoading(false);
            } else {
                setLoading(true);
                clearProfileCache();
                fetchUserProfile()
                    .then((p) => setProfile(p))
                    .catch(() => setProfile(null))
                    .finally(() => setLoading(false));
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleRecoveryComplete = () => {
        setRecoveryMode(false);
        // Refetch profile now that password is updated and user is fully signed in
        if (session) {
            setLoading(true);
            fetchUserProfile()
                .then((p) => setProfile(p))
                .catch(() => setProfile(null))
                .finally(() => setLoading(false));
        }
    };

    useEffect(() => {
        const onPopState = () => {
            locale.value = detectLocaleFromPath();
            setTab(currentTab());
            setShowCredits(isCreditsRoute());
            setShowFaq(isFaqRoute());
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // Probe for an in-flight journey once the user is signed in so the Archive
    // tab can badge itself.
    useEffect(() => {
        if (loading || !session) return;
        refreshActiveSession();
    }, [session, loading]);

    useEffect(() => {
        if (loading) return;
        if (!session) return;
        if (typeof window === 'undefined') return;
        const routeId = new URLSearchParams(window.location.search).get('route');
        if (!routeId) return;

        let cancelled = false;
        fetchSharedUserRoute(routeId)
            .then(full => {
                if (cancelled) return;
                const routeData: RouteData = {
                    geometry: full.geometry,
                    properties: { stops: full.stops },
                };
                startUserRouteJourney(routeData, full.id);
                appScreen.value = 'game';
                // Strip the query so exiting back to the menu doesn't re-trigger.
                window.history.replaceState({}, '', window.location.pathname);
            })
            .catch(err => {
                console.warn('[route] failed to load shared route:', err);
                window.history.replaceState({}, '', window.location.pathname);
            });

        return () => { cancelled = true; };
    }, [session, loading]);

    const openCredits = () => {
        setShowCredits(true);
        const target = withLocale('/credits', locale.value);
        if (window.location.pathname !== target) {
            window.history.pushState({}, '', target);
        }
    };

    const closeCredits = () => {
        setShowCredits(false);
        if (stripLocale(window.location.pathname) === '/credits') {
            const target = withLocale(tab === 'account' ? '/account' : '/', locale.value);
            window.history.pushState({}, '', target);
        }
    };

    const openFaq = () => {
        setShowFaq(true);
        const target = withLocale('/faq', locale.value);
        if (window.location.pathname !== target) {
            window.history.pushState({}, '', target);
        }
    };

    const closeFaq = () => {
        setShowFaq(false);
        if (stripLocale(window.location.pathname) === '/faq') {
            const target = withLocale(tab === 'account' ? '/account' : '/', locale.value);
            window.history.pushState({}, '', target);
        }
    };

    const isPremium = !!(session && !loading && profile?.is_premium);

    const navigate = (to: TabId) => {
        if (to === 'journey' && !isPremium) return;
        setTab(to);
        const path = withLocale(to === 'account' ? '/account' : '/', locale.value);
        if (window.location.pathname !== path) {
            window.history.pushState({}, '', path);
        }
    };

    const handleLogout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error?.code === 'session_not_found') {
            await supabase.auth.signOut({ scope: 'local' });
        }
    };

    const refreshProfile = async () => {
        clearProfileCache();
        try {
            const p = await fetchUserProfile();
            setProfile(p);
        } catch {
            setProfile(null);
        }
    };

    if (appScreen.value === 'game') {
        return <ThreeViewer />;
    }

    return (
        <>
            {showSplash && <SplashOverlay ready={!loading} onDone={() => setShowSplash(false)} />}
            <LanguageSelector floating />
            <MenuScreen
                session={session}
                profile={profile}
                checking={loading}
                activeTab={tab}
                recoveryMode={recoveryMode}
                showCredits={showCredits}
                showFaq={showFaq}
                onLogout={handleLogout}
                onPremiumChange={refreshProfile}
                onRecoveryComplete={handleRecoveryComplete}
                onOpenCredits={openCredits}
                onCloseCredits={closeCredits}
                onOpenFaq={openFaq}
                onCloseFaq={closeFaq}
            />
            {isPremium && !recoveryMode && <BottomTabs activeTab={tab} onTabChange={navigate} />}
        </>
    );
}
