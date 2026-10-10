package vn.editor.identity.auth.application.query;

public interface GetProfileService {
  UserView handle(GetProfileQuery query);
}
