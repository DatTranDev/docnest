package vn.editor.document;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vn.editor.document.documents.api.dto.ChangeDocumentMetadataRequestDto;
import vn.editor.document.documents.api.dto.CreateDocumentRequestDto;
import vn.editor.document.documents.api.dto.SaveVersionRequestDto;
import vn.editor.document.folders.api.dto.MoveFolderRequestDto;
import vn.editor.document.sharing.api.dto.CreatePublicLinkRequestDto;

class HttpRequestDtoTest {
  private final ObjectMapper json = new ObjectMapper();

  @Test
  void metadataPatchDistinguishesMissingFolderFromExplicitRootMove() throws Exception {
    ChangeDocumentMetadataRequestDto rename =
        json.readValue(
            "{\"expectedMetadataRevision\":2,\"title\":\"Renamed\"}",
            ChangeDocumentMetadataRequestDto.class);
    assertFalse(rename.folderChanged());

    ChangeDocumentMetadataRequestDto moveToRoot =
        json.readValue(
            "{\"expectedMetadataRevision\":2,\"folderId\":null}",
            ChangeDocumentMetadataRequestDto.class);
    assertTrue(moveToRoot.folderChanged());
    assertEquals(null, moveToRoot.folderId());

    MoveFolderRequestDto folder =
        json.readValue(
            "{\"expectedMetadataRevision\":2,\"parentId\":null}", MoveFolderRequestDto.class);
    assertTrue(folder.parentChanged());
  }

  @Test
  void strictDtosRejectUnknownMissingAndOutOfRangeFields() {
    assertThrows(
        JsonProcessingException.class,
        () ->
            json.readValue(
                "{\"title\":\"A\",\"folderId\":null,\"extra\":1}", CreateDocumentRequestDto.class));
    assertThrows(
        JsonProcessingException.class,
        () -> json.readValue("{\"title\":\"A\"}", CreateDocumentRequestDto.class));
    assertThrows(
        JsonProcessingException.class,
        () ->
            json.readValue(
                "{\"uploadId\":\"invalid\",\"expectedHeadRevision\":0}",
                SaveVersionRequestDto.class));
  }

  @Test
  void optionalPublicLinkLifetimeKeepsItsDefault() throws Exception {
    assertEquals(604800, json.readValue("{}", CreatePublicLinkRequestDto.class).expiresInSeconds());
  }
}
