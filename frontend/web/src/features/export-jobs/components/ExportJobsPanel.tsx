'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { download, errorMessage } from '@/lib/http';
import { cancelJob, jobContent } from '../api/jobs';
import { EXPORT_FORMATS } from '../model/formats';
import type { Job } from '../model/types';
const JOB_LABELS: Record<string, string> = {
  QUEUED: MESSAGE.queued,
  READY: MESSAGE.ready,
  RUNNING: MESSAGE.running,
  SUCCEEDED: MESSAGE.succeeded,
  FAILED: MESSAGE.failed,
  CANCELLED: MESSAGE.cancelled,
};
export function ExportJobsPanel({
  jobs,
  onUpdate,
  onError,
}: {
  jobs: Job[];
  onUpdate: (updater: (jobs: Job[]) => Job[]) => void;
  onError: (message: string) => void;
}) {
  const { t, localize, errorText } = useI18n();

  if (!jobs.length) return null;
  return (
    <section>
      <h3>{t(MESSAGE.exportJobs)}</h3>
      {jobs.map((job) => (
        <div className="row" key={job.id}>
          {t(EXPORT_FORMATS[job.type].label)} ·{' '}
          <span>{localize(JOB_LABELS[job.state] ?? job.state)}</span>
          {job.errorCode && <span>{errorText(job.errorCode)}</span>}
          {job.state === 'SUCCEEDED' && (
            <button
              onClick={() => {
                void jobContent(job.id)
                  .then((bytes) =>
                    download(
                      bytes,
                      `export.${EXPORT_FORMATS[job.type].extension}`,
                      EXPORT_FORMATS[job.type].mime,
                    ),
                  )
                  .catch((error) => onError(errorMessage(error)));
              }}
            >
              {t(MESSAGE.downloadResult)}{' '}
            </button>
          )}
          {['QUEUED', 'READY', 'RUNNING'].includes(job.state) && (
            <button
              onClick={() => {
                void cancelJob(job.id)
                  .then((result) =>
                    onUpdate((previous) =>
                      previous.map((existing) => (existing.id === job.id ? result : existing)),
                    ),
                  )
                  .catch((error) => onError(errorMessage(error)));
              }}
            >
              {t(MESSAGE.cancel)}{' '}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
