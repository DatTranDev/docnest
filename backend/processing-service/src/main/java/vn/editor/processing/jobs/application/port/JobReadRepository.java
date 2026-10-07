package vn.editor.processing.jobs.application.port;

import vn.editor.processing.jobs.application.query.JobDetails;
import vn.editor.processing.jobs.application.query.JobPage;

public interface JobReadRepository {
  JobDetails ownedDetails(String actor, String id);

  JobPage listOwned(String actor, int limit, String cursor);
}
