package vn.editor.collaboration.rooms.domain;

public final class RoomFailure extends RuntimeException {
  public RoomFailure(String code) {
    super(code);
  }
}
