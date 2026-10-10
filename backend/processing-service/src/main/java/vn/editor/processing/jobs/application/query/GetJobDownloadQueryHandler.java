package vn.editor.processing.jobs.application.query;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.Map;
import vn.editor.processing.jobs.application.JobFailure;
import vn.editor.processing.jobs.application.port.ResultStoragePort;
import vn.editor.processing.jobs.domain.ExportFormat;
import vn.editor.processing.jobs.domain.JobLifecyclePolicy;
import vn.editor.processing.jobs.domain.JobPolicyViolation;

public final class GetJobDownloadQueryHandler implements GetJobDownloadQueryService {
  private final GetJobQueryHandler jobs;
  private final ResultStoragePort storage;
  private final String publicBase;

  public GetJobDownloadQueryHandler(
      GetJobQueryHandler jobs, ResultStoragePort storage, String publicBase) {
    this.jobs = jobs;
    this.storage = storage;
    this.publicBase = publicBase;
  }

  public JobDetails ready(GetJobQuery query) {
    var job = jobs.authorized(query);
    try {
      JobLifecyclePolicy.requireDownload(
          job.view().state(), job.outputRef() != null, job.expiresAt(), Instant.now());
    } catch (JobPolicyViolation e) {
      throw new JobFailure(e.code().equals("RESULT_EXPIRED") ? 410 : 409, e.code(), e.getMessage());
    }
    return job;
  }

  public Map<String, Object> descriptor(GetJobQuery query) {
    var job = ready(query);
    return Map.of(
        "url",
        publicBase + "/api/v1/jobs/" + query.jobId() + "/content",
        "expiresAt",
        Instant.now().plusSeconds(60).toString(),
        "bytes",
        job.bytes(),
        "contentType",
        contentType(job));
  }

  public InputStream open(JobDetails job) throws IOException {
    return storage.open(job.outputRef());
  }

  public String contentType(JobDetails job) {
    return ExportFormat.valueOf(job.view().type()).contentType();
  }
}
