import { download, errorMessage } from '@/lib/http';
import { cancelJob, jobContent } from '../api/jobs';
import type { Job } from '../model/types';
export function ExportJobsPanel({
  jobs,
  onUpdate,
  onError,
}: {
  jobs: Job[];
  onUpdate: (updater: (jobs: Job[]) => Job[]) => void;
  onError: (message: string) => void;
}) {
  if (!jobs.length) return null;
  return (
    <section>
      <h3>Tác vụ xuất</h3>
      {jobs.map((job) => (
        <div className="row" key={job.id}>
          {job.type} · <span>{job.state}</span>
          {job.errorCode && <span>{job.errorCode}</span>}
          {job.state === 'SUCCEEDED' && (
            <button
              onClick={() => {
                void jobContent(job.id)
                  .then((bytes) =>
                    download(
                      bytes,
                      `export.${job.type === 'EXPORT_HTML' ? 'html' : 'txt'}`,
                      job.type === 'EXPORT_HTML' ? 'text/html' : 'text/plain',
                    ),
                  )
                  .catch((error) => onError(errorMessage(error)));
              }}
            >
              Tải kết quả
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
              Hủy
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
