package vn.editor.document.folders.domain;

import java.util.List;
import vn.editor.document.shared.domain.DomainException;

public final class FolderTreePolicy {
  public static final int MAX_DEPTH = 20;

  private FolderTreePolicy() {}

  public static void placement(String folderId, List<String> parentAncestors, int subtreeHeight) {
    if (folderId != null && parentAncestors.contains(folderId))
      throw new DomainException(409, "FOLDER_CYCLE");
    if (parentAncestors.stream().distinct().count() != parentAncestors.size())
      throw new DomainException(409, "FOLDER_CYCLE");
    if (parentAncestors.size() + subtreeHeight > MAX_DEPTH)
      throw new DomainException(409, "FOLDER_DEPTH_EXCEEDED");
  }

  public static void deletion(long children) {
    if (children > 0) throw new DomainException(409, "FOLDER_NOT_EMPTY");
  }
}
