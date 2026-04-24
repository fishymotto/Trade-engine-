import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://pyfcshzunlsjtktynvae.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_HiBmU9YKW5_Y0L8w86rp2A_p-RAMx7t';

const SUPABASE_URL = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  isAdmin?: boolean;
};

export type User = AuthUser;

export class AuthService {
  async signup(email: string, password: string, username?: string): Promise<AuthUser> {
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
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
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
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }

  onAuthStateChange(callback: (user: AuthUser | null) => void) {
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
