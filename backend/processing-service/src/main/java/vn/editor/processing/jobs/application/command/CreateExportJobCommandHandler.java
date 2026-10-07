package vn.editor.processing.jobs.application.command;

import java.util.Map;
import java.util.UUID;
import vn.editor.processing.jobs.application.port.DocumentAccessPort;
import vn.editor.processing.jobs.application.port.JobCommandRepository;
import vn.editor.processing.jobs.domain.ExportRequest;

public final class CreateExportJobCommandHandler {
  private final JobCommandRepository commands;
  private final DocumentAccessPort documents;

  public CreateExportJobCommandHandler(
      JobCommandRepository commands, DocumentAccessPort documents) {
    this.commands = commands;
    this.documents = documents;
  }

  public Map<String, Object> handle(CreateExportJobCommand command) {
    var request = new ExportRequest(command.documentId(), command.revision(), command.type());
    UUID.fromString(command.idempotencyKey());
    documents.authorize(command.token(), request.documentId());
    var prior = commands.idempotent(command.actor(), command.idempotencyKey(), request.bodyHash());
    if (prior != null) return prior;
    var source = documents.snapshot(command.token(), request.documentId(), request.revision());
    // All HTTP/storage I/O has finished before the short repository quota/idempotency/outbox
    // transaction.
    return commands.create(command.actor(), command.idempotencyKey(), request, source);
  }
}
