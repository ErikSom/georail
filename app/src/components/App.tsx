import { useState, useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabase';
import { fetchUserProfile, clearProfileCache, type UserProfile } from '../lib/api/profile';
import MenuScreen from './MenuScreen';
import AccountScreen from './AccountScreen';
import ThreeViewer from './ThreeViewer';
import BottomTabs, { type TabId } from './BottomTabs';
import SplashOverlay from './SplashOverlay';
import { appScreen } from '../store/app';

function currentTab(): TabId {
    if (typeof window === 'undefined') return 'journey';
    return window.location.pathname === '/account' ? 'account' : 'journey';
}

export default function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabId>(currentTab);
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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


    useEffect(() => {
        const onPopState = () => setTab(currentTab());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const isPremium = !!(session && !loading && profile?.is_premium);

    const navigate = (to: TabId) => {
        if (to === 'journey' && !isPremium) return;
        setTab(to);
        const path = to === 'account' ? '/account' : '/';
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

    // Determine the content to show behind the splash
    const content = (() => {
        if (!session || loading) {
            return <MenuScreen session={null} profile={null} checking={false} onLogout={handleLogout} />;
        }
        if (!isPremium) {
            return <AccountScreen session={session} onLogout={handleLogout} onPremiumChange={refreshProfile} />;
        }
        return (
            <>
                {tab === 'journey' ? (
                    <MenuScreen session={session} profile={profile} checking={false} onLogout={handleLogout} />
                ) : (
                    <AccountScreen session={session} onLogout={handleLogout} onPremiumChange={refreshProfile} />
                )}
                <BottomTabs activeTab={tab} onTabChange={navigate} />
            </>
        );
    })();

    return (
        <>
            {showSplash && <SplashOverlay ready={!loading} onDone={() => setShowSplash(false)} />}
            {content}
        </>
    );
}
