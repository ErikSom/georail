import { useState, useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabase';
import { fetchUserProfile, clearProfileCache, type UserProfile } from '../lib/api/profile';
import MenuScreen from './MenuScreen';
import AccountScreen from './AccountScreen';
import ThreeViewer from './ThreeViewer';
import BottomTabs, { type TabId } from './BottomTabs';
import { appScreen } from '../store/app';

function currentTab(): TabId {
    if (typeof window === 'undefined') return 'journey';
    return window.location.pathname === '/account' ? 'account' : 'journey';
}

export default function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [checking, setChecking] = useState(true);
    const [tab, setTab] = useState<TabId>(currentTab);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setProfile(null);
            clearProfileCache();
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!session) {
            setChecking(false);
            setProfile(null);
            return;
        }
        setChecking(true);
        fetchUserProfile().then((p) => {
            setProfile(p);
            setChecking(false);
        });
    }, [session]);

    // Sync tab state with browser navigation
    useEffect(() => {
        const onPopState = () => setTab(currentTab());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const isPremium = !!(session && !checking && profile?.is_premium);

    // Non-premium users are always forced to account
    const activeTab = isPremium ? tab : 'account';

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
        const p = await fetchUserProfile();
        setProfile(p);
    };

    if (appScreen.value === 'game') {
        return <ThreeViewer />;
    }

    return (
        <>
            {activeTab === 'journey' ? (
                <MenuScreen
                    session={session}
                    profile={profile}
                    checking={checking}
                    onLogout={handleLogout}
                />
            ) : (
                <AccountScreen
                    session={session}
                    onLogout={handleLogout}
                    onPremiumChange={refreshProfile}
                />
            )}
            <BottomTabs activeTab={activeTab} onTabChange={navigate} />
        </>
    );
}
