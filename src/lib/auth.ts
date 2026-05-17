import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  isAdmin?: boolean;
};

export type User = AuthUser;

export const OFFLINE_WORKSPACE_USER: AuthUser = {
  id: 'local-workspace',
  email: '',
  username: 'Offline Workspace',
  isAdmin: false,
};

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const SUPABASE_URL = env?.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = env?.VITE_SUPABASE_ANON_KEY?.trim();
const hasSupabaseEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const REMOTE_SYNC_ENABLED = false;
const SUPABASE_FALLBACK_URL = 'https://placeholder.supabase.co';
const SUPABASE_FALLBACK_ANON_KEY = 'placeholder-anon-key';

if (!REMOTE_SYNC_ENABLED) {
  console.warn('Supabase integration is disabled for this build. Trade Engine will stay in offline workspace mode.');
} else if (!hasSupabaseEnv) {
  console.warn(
    'Remote sync is not configured for this build. Trade Engine will continue in offline workspace mode.'
  );
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL ?? SUPABASE_FALLBACK_URL,
  SUPABASE_ANON_KEY ?? SUPABASE_FALLBACK_ANON_KEY
);
export const isSupabaseConfigured = REMOTE_SYNC_ENABLED && hasSupabaseEnv;

export class AuthService {
  private ensureSupabaseConfigured(): void {
    if (!isSupabaseConfigured) {
      throw new Error(
        'Remote sync is disabled for this build. Trade Engine saves locally on this device. Use Send Workspace and Receive Workspace on the Imports page to move data between computers.'
      );
    }
  }

  async signup(email: string, password: string, username?: string): Promise<AuthUser> {
    this.ensureSupabaseConfigured();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || email.split('@')[0],
        },
      },
    });

    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Signup failed');

    // Create user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert([
        {
          id: data.user.id,
          email,
          username: username || email.split('@')[0],
        },
      ]);

    if (profileError) {
      console.warn('Profile creation warning:', profileError);
      // Continue even if profile fails (it might already exist)
    }

    return {
      id: data.user.id,
      email: data.user.email || email,
      username: username || email.split('@')[0],
      isAdmin: false,
    };
  }

  async login(email: string, password: string): Promise<AuthUser> {
    this.ensureSupabaseConfigured();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Login failed');

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) console.warn('Profile fetch warning:', profileError);

    return {
      id: data.user.id,
      email: profile?.email || data.user.email || email,
      username: profile?.username || email.split('@')[0],
      isAdmin: Boolean(profile?.is_admin),
    };
  }

  async logout(): Promise<void> {
    if (!isSupabaseConfigured) {
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!isSupabaseConfigured) {
      return null;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.warn('Profile fetch warning:', profileError);
    }

    if (!profile) {
      return {
        id: user.id,
        email: user.email || '',
        username: user.user_metadata?.username,
        isAdmin: false,
      };
    }

    return {
      id: profile.id,
      email: profile.email,
      username: profile.username,
      isAdmin: Boolean(profile.is_admin),
    };
  }

  async getSession() {
    if (!isSupabaseConfigured) {
      return null;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }

  onAuthStateChange(callback: (user: AuthUser | null) => void) {
    if (!isSupabaseConfigured) {
      callback(null);
      return {
        data: {
          subscription: {
            unsubscribe: () => undefined
          }
        }
      };
    }

    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const user = await this.getCurrentUser();
        callback(user);
      } else {
        callback(null);
      }
    });
  }
}

export const authService = new AuthService();
