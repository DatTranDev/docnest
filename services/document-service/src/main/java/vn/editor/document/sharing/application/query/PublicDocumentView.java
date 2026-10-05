package vn.editor.document.sharing.application.query;

public record PublicDocumentView(
    String documentId, String title, long headRevision, boolean empty, String contentPath) {}
