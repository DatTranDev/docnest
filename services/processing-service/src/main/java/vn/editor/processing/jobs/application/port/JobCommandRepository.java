package vn.editor.processing.jobs.application.port;

import java.util.Map;
import vn.editor.processing.jobs.application.query.JobView;
import vn.editor.processing.jobs.domain.ExportRequest;

public interface JobCommandRepository {
  Map<String, Object> idempotent(String actor, String key, String hash);

  Map<String, Object> create(
      String actor, String key, ExportRequest request, SourceSnapshot snapshot);

  JobView cancel(String actor, String id);
}
