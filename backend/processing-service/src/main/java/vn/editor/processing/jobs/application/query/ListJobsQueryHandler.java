package vn.editor.processing.jobs.application.query;

import java.util.ArrayList;
import vn.editor.processing.jobs.application.JobFailure;
import vn.editor.processing.jobs.application.port.DocumentAccessPort;
import vn.editor.processing.jobs.application.port.JobReadRepository;

public final class ListJobsQueryHandler implements ListJobsQueryService {
  private final JobReadRepository reads;
  private final DocumentAccessPort documents;

  public ListJobsQueryHandler(JobReadRepository reads, DocumentAccessPort documents) {
    this.reads = reads;
    this.documents = documents;
  }

  public JobPage handle(ListJobsQuery query) {
    var page = reads.listOwned(query.actor(), query.limit(), query.cursor());
    var visible = new ArrayList<JobView>();
    for (var job : page.items())
      try {
        documents.authorize(query.token(), job.documentId());
        visible.add(job);
      } catch (JobFailure e) {
        if (e.status != 403 && e.status != 404) throw e;
      }
    return new JobPage(visible, page.nextCursor());
  }
}
