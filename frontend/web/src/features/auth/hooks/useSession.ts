'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { logout, refresh } from '../api/auth';
import type { User } from '../model/types';
export function useSession() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const userGeneration = useRef(0);
  useEffect(() => {
    let disposed = false;
    void refresh()
      .then((session) => {
        if (!disposed) setUser(session?.user ?? null);
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
    userGeneration.current++;
    setUser(user);
  }, []);
  return { user, loading, onLogin, signOut };
}
