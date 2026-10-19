package vn.editor.identity.auth.api.dto;

import vn.editor.identity.auth.application.query.UserView;

public record UserResponseDto(String id, String email, String displayName) {
  public static UserResponseDto from(UserView user) {
    return new UserResponseDto(user.id(), user.email(), user.displayName());
  }
}
