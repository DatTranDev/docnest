package vn.editor.document.documents.application.query;

import vn.editor.document.documents.application.port.SnapshotStore.ObjectReference;

public record DownloadView(
    String url, String expiresAt, VersionView version, ObjectReference objectRef) {}
