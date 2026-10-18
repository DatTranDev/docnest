package vn.editor.identity.auth.application.command;

import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.AvatarCodec;
import vn.editor.identity.auth.application.port.Transactions;

public final class ChangeAvatarHandler implements ChangeAvatarService {
  private final AccountCommandRepository accounts;
  private final AvatarCodec codec;
  private final Transactions transactions;

  public ChangeAvatarHandler(
      AccountCommandRepository accounts, AvatarCodec codec, Transactions transactions) {
    this.accounts = accounts;
    this.codec = codec;
    this.transactions = transactions;
  }

  @Override
  public void upload(String userId, byte[] source, String mime) {
    var image = codec.normalize(source, mime);
    transactions.execute(
        () -> {
          accounts.lockById(userId).requireActive();
          accounts.setCustomAvatar(userId, image.bytes(), image.mime());
          return null;
        });
  }

  @Override
  public void remove(String userId) {
    transactions.execute(
        () -> {
          accounts.lockById(userId).requireActive();
          accounts.removeCustomAvatar(userId);
          return null;
        });
  }
}
