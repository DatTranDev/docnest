package vn.editor.processing.jobs.application.query;

import vn.editor.processing.jobs.application.port.DocumentAccessPort;
import vn.editor.processing.jobs.application.port.JobReadRepository;

public final class GetJobQueryHandler {
  private final JobReadRepository reads;
  private final DocumentAccessPort documents;

  public GetJobQueryHandler(JobReadRepository reads, DocumentAccessPort documents) {
    this.reads = reads;
    this.documents = documents;
  }

  public JobDetails authorized(GetJobQuery query) {
    var job = reads.ownedDetails(query.actor(), query.jobId());
    // Authorization touches only current Document ACL, not the retained-history input version.
    documents.authorize(query.token(), job.view().documentId());
    return job;
  }

  public JobView handle(GetJobQuery query) {
    return authorized(query).view();
  }
}
