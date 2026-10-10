package vn.editor.processing.jobs.application.command;

import java.util.Map;

public interface CreateExportJobCommandService {
  Map<String, Object> handle(CreateExportJobCommand command);
}
