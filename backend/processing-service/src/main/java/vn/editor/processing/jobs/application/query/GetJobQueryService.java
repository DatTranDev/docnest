package vn.editor.processing.jobs.application.query;

public interface GetJobQueryService {
  JobDetails authorized(GetJobQuery query);

  JobView handle(GetJobQuery query);
}
