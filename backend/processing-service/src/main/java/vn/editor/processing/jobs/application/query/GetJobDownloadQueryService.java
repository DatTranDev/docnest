package vn.editor.processing.jobs.application.query;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

public interface GetJobDownloadQueryService {
  JobDetails ready(GetJobQuery query);

  Map<String, Object> descriptor(GetJobQuery query);

  InputStream open(JobDetails job) throws IOException;

  String contentType(JobDetails job);
}
