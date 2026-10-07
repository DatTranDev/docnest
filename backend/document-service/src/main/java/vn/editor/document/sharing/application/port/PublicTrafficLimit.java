package vn.editor.document.sharing.application.port;

public interface PublicTrafficLimit {
  interface Lease extends AutoCloseable {
    void close();
  }

  void take(String address, boolean download);

  Lease acquireStream(String address);
}
