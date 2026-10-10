package vn.editor.document.sharing.application.query;

import java.util.ArrayList;
import java.util.List;
import vn.editor.document.shared.application.Page;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.sharing.application.port.AccountDirectory;
import vn.editor.document.sharing.application.port.SharingReadRepository;

public final class SharingQueryHandler implements SharingQueryService {
  private final SharingReadRepository sharing;
  private final AccountDirectory accounts;

  public SharingQueryHandler(SharingReadRepository sharing, AccountDirectory accounts) {
    this.sharing = sharing;
    this.accounts = accounts;
  }

  public Page<PermissionView> handle(ListPermissionsQuery query) {
    Page<PermissionView> page = sharing.permissions(query);
    List<PermissionView> items = new ArrayList<>();
    for (PermissionView permission : page.items()) {
      try {
        AccountDirectory.Account account =
            accounts.user(permission.granteeUserId(), query.authorization());
        items.add(
            new PermissionView(
                permission.granteeUserId(),
                permission.role(),
                permission.updatedAt(),
                account.email(),
                account.displayName()));
      } catch (DomainException ex) {
        if (ex.status != 422 && ex.status != 503) throw ex;
        items.add(permission);
      }
    }
    return new Page<>(List.copyOf(items), page.nextCursor());
  }

  public Page<LinkView> handle(ListPublicLinksQuery query) {
    return sharing.links(query);
  }
}
