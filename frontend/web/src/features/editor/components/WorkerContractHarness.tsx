'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EditorModel, TextAdapter, StyleTree, decodeNative } from '@ted/editor-core';
import { ReplicaBridge } from '../model/ReplicaBridge';
const contractImports = { ReplicaBridge, EditorModel, TextAdapter, StyleTree, decodeNative };
declare global {
  interface Window {
    workerContractImports?: typeof contractImports;
    harnessNavigate?: (href: '/benchmark' | '/worker-contract') => void;
  }
}
export function WorkerContractHarness() {
  const router = useRouter();
  useEffect(() => {
    window.workerContractImports = contractImports;
    window.harnessNavigate = (href) => router.push(href);
    return () => {
      delete window.workerContractImports;
      delete window.harnessNavigate;
    };
  }, [router]);
  return <main>Worker protocol contract harness</main>;
}
