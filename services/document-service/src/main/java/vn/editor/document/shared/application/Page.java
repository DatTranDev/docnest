package vn.editor.document.shared.application;

import java.util.List;

public record Page<T>(List<T> items, String nextCursor) {}
