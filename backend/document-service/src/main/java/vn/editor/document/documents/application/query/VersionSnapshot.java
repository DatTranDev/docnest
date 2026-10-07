package vn.editor.document.documents.application.query;

import vn.editor.document.documents.application.port.SnapshotStore.ObjectReference;

public record VersionSnapshot(VersionView version, ObjectReference reference) {}
