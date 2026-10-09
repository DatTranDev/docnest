import { MESSAGE } from '@/lib/i18n/messages';
import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { ActiveDocument } from '@/features/documents';
import { errorMessage } from '@/lib/http';
import { createExport, getJob } from '../api/jobs';
import type { Job } from '../model/types';
export function useExportJobs(
  active: RefObject<ActiveDocument | null>,
  save: () => Promise<void>,
  onError: (message: string) => void,
) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const start = useCallback(
    async (type: Job['type']) => {
      try {
        if (active.current?.model.dirty) await save();
        const document = active.current;
        if (!document?.document.headRevision || document.model.dirty)
          throw new Error(MESSAGE.saveTheCurrentVersionBeforeExporting);
        const job = await createExport(
          document.document.id,
          document.revision ?? document.document.headRevision,
          type,
        );
        setJobs((previous) => [job, ...previous]);
      } catch (error) {
        onError(errorMessage(error));
      }
    },
    [active, onError, save],
  );
  useEffect(() => {
    if (!jobs.some((job) => ['QUEUED', 'READY', 'RUNNING'].includes(job.state))) return;
    const timer = setInterval(() => {
      void Promise.all(jobs.map((job) => getJob(job.id)))
        .then(setJobs)
        .catch((error) => onError(errorMessage(error)));
    }, 1500);
    return () => clearInterval(timer);
  }, [jobs, onError]);
  return { jobs, setJobs, start };
}
