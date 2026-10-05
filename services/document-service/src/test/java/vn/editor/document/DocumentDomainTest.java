package vn.editor.document;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import vn.editor.document.documents.domain.DocumentAccess;
import vn.editor.document.documents.domain.RetentionPolicy;
import vn.editor.document.documents.domain.UploadTicket;
import vn.editor.document.documents.domain.VersionCommitPolicy;
import vn.editor.document.folders.domain.Folder;
import vn.editor.document.folders.domain.FolderTreePolicy;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.domain.SharingPolicy;

class DocumentDomainTest {
  @Test
  void placementPropertyRejectsCyclesAndDepth() {
    Random random = new Random(87921);
    for (int sample = 0; sample < 500; sample++) {
      int depth = random.nextInt(25), height = 1 + random.nextInt(6);
      List<String> ancestors = new ArrayList<>();
      for (int i = 0; i < depth; i++) ancestors.add("node" + i);
      if (depth + height > 20)
        assertEquals(
            "FOLDER_DEPTH_EXCEEDED",
            assertThrows(
                    DomainException.class,
                    () -> FolderTreePolicy.placement("moved", ancestors, height))
                .code);
      else FolderTreePolicy.placement("moved", ancestors, height);
      if (depth > 0)
        assertEquals(
            "FOLDER_CYCLE",
            assertThrows(
                    DomainException.class,
                    () -> FolderTreePolicy.placement(ancestors.getFirst(), ancestors, height))
                .code);
    }
  }

  @Test
  void folderRevisionAndUnicodeAreDomainInvariants() {
    String id = UUID.randomUUID().toString(), owner = UUID.randomUUID().toString();
    Folder folder = new Folder(id, owner, null, "Re\u0301sume\u0301", 4);
    assertEquals("R\u00e9sum\u00e9", folder.name());
    assertEquals(5, folder.move(4, "renamed", null).metadataRevision());
    assertEquals(
        "METADATA_CONFLICT",
        assertThrows(DomainException.class, () -> folder.move(3, "stale", null)).code);
    assertThrows(DomainException.class, () -> Values.name("bad\nname", 120));
  }

  @Test
  void deletedDocumentsRemainVisibleOnlyToOwner() {
    new DocumentAccess("OWNER", true).requireVisible(true);
    assertEquals(
        404,
        assertThrows(
                DomainException.class,
                () -> new DocumentAccess("EDITOR", true).requireVisible(true))
            .status);
    assertEquals(
        "READ_ONLY",
        assertThrows(
                DomainException.class, () -> new DocumentAccess("VIEWER", false).requireEditor())
            .code);
    assertEquals(
        "OWNER_REQUIRED",
        assertThrows(
                DomainException.class, () -> new DocumentAccess("EDITOR", false).requireOwner())
            .code);
  }

  @Test
  void saveBindingExpiryAndConflictPolicies() {
    Instant now = Instant.now();
    UploadTicket ticket =
        new UploadTicket(
            "u", "d", "k", "LOCAL", null, "CREATED", 2, 20, "hash", now.plusSeconds(1));
    ticket.requireBinding("d", 2);
    ticket.requireLocalWrite(20, now);
    assertEquals(
        "INVALID_REQUEST",
        assertThrows(DomainException.class, () -> ticket.requireBinding("other", 2)).code);
    assertEquals(
        "UPLOAD_EXPIRED",
        assertThrows(DomainException.class, () -> ticket.requireUnexpired(now.plusSeconds(2)))
            .code);
    assertEquals(
        "REVISION_CONFLICT",
        assertThrows(DomainException.class, () -> VersionCommitPolicy.requireExpectedHead(3, 2))
            .code);
    assertTrue(VersionCommitPolicy.unchanged("a", "a"));
    assertFalse(VersionCommitPolicy.unchanged(null, "a"));
  }

  @Test
  void retentionHonorsHeadAndReadGrace() {
    Instant now = Instant.now();
    assertFalse(
        RetentionPolicy.canDeleteVersion(true, false, now.minusSeconds(7200), "head", "head", now));
    assertFalse(
        RetentionPolicy.canDeleteVersion(true, false, now.minusSeconds(3599), "old", "head", now));
    assertTrue(
        RetentionPolicy.canDeleteVersion(true, false, now.minusSeconds(3601), "old", "head", now));
    assertThrows(
        DomainException.class,
        () ->
            RetentionPolicy.requireRestorable(
                now.minusSeconds(RetentionPolicy.TRASH_SECONDS + 1), now));
  }

  @Test
  void sharingPermissionsAndExpiryStayBounded() {
    String owner = UUID.randomUUID().toString();
    assertThrows(DomainException.class, () -> SharingPolicy.grantee(owner, owner, owner));
    assertThrows(DomainException.class, () -> SharingPolicy.role("OWNER"));
    assertThrows(DomainException.class, () -> SharingPolicy.lifetime(3599));
    assertEquals(2592000, SharingPolicy.lifetime(2592000));
    assertThrows(DomainException.class, () -> SharingPolicy.publicToken("guess"));
  }
}
