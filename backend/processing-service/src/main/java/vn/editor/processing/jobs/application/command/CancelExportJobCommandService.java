package vn.editor.processing.jobs.application.command;

import vn.editor.processing.jobs.application.query.JobView;

public interface CancelExportJobCommandService {
  JobView handle(CancelExportJobCommand command);
}
