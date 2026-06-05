import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from '@/types/db';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let active = true;
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.warn('[auth] profile fetch failed:', error.message);
          return;
        }
        setProfile(data as Profile);
      });
    return () => {
      active = false;
    };
  }, [session]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        return { error: error?.message ?? null };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      }
    }),
    [session, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
