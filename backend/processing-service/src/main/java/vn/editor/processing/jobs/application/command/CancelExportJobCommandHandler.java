package vn.editor.processing.jobs.application.command;

import vn.editor.processing.jobs.application.port.DocumentAccessPort;
import vn.editor.processing.jobs.application.port.JobCommandRepository;
import vn.editor.processing.jobs.application.port.JobReadRepository;
import vn.editor.processing.jobs.application.query.JobView;

public final class CancelExportJobCommandHandler implements CancelExportJobCommandService {
  private final JobCommandRepository commands;
  private final JobReadRepository reads;
  private final DocumentAccessPort documents;

  public CancelExportJobCommandHandler(
      JobCommandRepository commands, JobReadRepository reads, DocumentAccessPort documents) {
    this.commands = commands;
    this.reads = reads;
    this.documents = documents;
  }

  public JobView handle(CancelExportJobCommand command) {
    var job = reads.ownedDetails(command.actor(), command.jobId());
    documents.authorize(command.token(), job.view().documentId());
    return commands.cancel(command.actor(), command.jobId());
  }
}
