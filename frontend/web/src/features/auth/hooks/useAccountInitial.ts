'use client';
import { useSyncExternalStore } from 'react';
import { subscribeAccount, readAccountInitial } from '../model/accountPresentation';
export function useAccountInitial() {
  return useSyncExternalStore(subscribeAccount, readAccountInitial, () => '');
}
