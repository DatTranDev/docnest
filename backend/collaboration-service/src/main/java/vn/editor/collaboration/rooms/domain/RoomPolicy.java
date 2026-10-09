package vn.editor.collaboration.rooms.domain;

public final class RoomPolicy {
  public static final int MAX_UPDATE_BYTES = 12 * 1024 * 1024;
  public static final long MAX_LOG_BYTES = 64L * 1024 * 1024;
  public static final long MAX_UPDATES = 100_000;

  public static void update(byte[] payload) {
    if (payload == null || payload.length == 0 || payload.length > MAX_UPDATE_BYTES) {
      throw new RoomFailure("COLLABORATION_UPDATE_LIMIT");
    }
  }

  public static void append(long bytes, long sequence, int nextBytes) {
    if (bytes + nextBytes > MAX_LOG_BYTES || sequence >= MAX_UPDATES) {
      throw new RoomFailure("COLLABORATION_LOG_LIMIT");
    }
  }

  private RoomPolicy() {}
}
