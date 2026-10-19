'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { logout, refresh, refreshProfile } from '../api/auth';
import type { User } from '../model/types';
export function useSession() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const userGeneration = useRef(0);
  useEffect(() => {
    let disposed = false;
    void refresh()
      .then((session) => {
        if (disposed) return;
        setUser(session?.user ?? null);
        if (session) {
          const generation = userGeneration.current;
          void refreshProfile()
            .then((profile) => {
              if (!disposed && generation === userGeneration.current) setUser(profile);
            })
            .catch(() => {});
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const signOut = useCallback(async () => {
    const generation = ++userGeneration.current;
    try {
      await logout();
    } finally {
      if (generation === userGeneration.current) setUser(null);
    }
  }, []);
  const onLogin = useCallback((user: User) => {
    const generation = ++userGeneration.current;
    setUser(user);
    void refreshProfile()
      .then((profile) => {
        if (generation === userGeneration.current) setUser(profile);
      })
      .catch(() => {});
  }, []);
  return { user, loading, onLogin, onProfileUpdate: setUser, signOut };
}
