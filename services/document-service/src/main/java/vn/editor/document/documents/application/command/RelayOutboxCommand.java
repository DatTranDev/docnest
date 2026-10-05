package vn.editor.document.documents.application.command;

import vn.editor.document.shared.domain.Values;

public record RelayOutboxCommand(int batchSize) {
  public RelayOutboxCommand {
    Values.integer(batchSize, 1, 100);
  }
}
