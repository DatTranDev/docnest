package vn.editor.identity.bootstrap;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.identity.auth.application.command.CheckLoginAttemptHandler;
import vn.editor.identity.auth.application.command.LoginHandler;
import vn.editor.identity.auth.application.command.LogoutHandler;
import vn.editor.identity.auth.application.command.RefreshSessionHandler;
import vn.editor.identity.auth.application.command.RegisterAccountHandler;
import vn.editor.identity.auth.application.command.SessionIssuer;
import vn.editor.identity.auth.application.port.AccessTokens;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.AccountReadRepository;
import vn.editor.identity.auth.application.port.CsrfTokens;
import vn.editor.identity.auth.application.port.LoginAttempts;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.RefreshSessionRepository;
import vn.editor.identity.auth.application.port.RefreshTokens;
import vn.editor.identity.auth.application.port.ServiceCaller;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.application.query.GetProfileHandler;
import vn.editor.identity.auth.application.query.GetSigningKeysHandler;
import vn.editor.identity.auth.application.query.IssueCsrfHandler;
import vn.editor.identity.auth.application.query.ResolveAccountHandler;
import vn.editor.identity.auth.infrastructure.persistence.SpringTransactions;
import vn.editor.identity.auth.infrastructure.security.Argon2PasswordHashes;
import vn.editor.identity.auth.infrastructure.security.DocumentServiceCaller;
import vn.editor.identity.auth.infrastructure.security.SecureRefreshTokens;

@Configuration
public class AuthenticationWiring {
  @Bean
  public Clock clock() {
    return Clock.systemUTC();
  }

  @Bean
  public Transactions transactions(PlatformTransactionManager manager) {
    return new SpringTransactions(new TransactionTemplate(manager));
  }

  @Bean
  public PasswordHashes passwordHashes(Argon2PasswordEncoder encoder) {
    return new Argon2PasswordHashes(encoder);
  }

  @Bean
  public RefreshTokens refreshTokens() {
    return new SecureRefreshTokens();
  }

  @Bean
  public ServiceCaller serviceCaller(@Value("${editor.auth.document-internal-key}") String key) {
    return new DocumentServiceCaller(key);
  }

  @Bean
  public SessionIssuer sessionIssuer(
      RefreshSessionRepository sessions, RefreshTokens refreshTokens, AccessTokens accessTokens) {
    return new SessionIssuer(sessions, refreshTokens, accessTokens);
  }

  @Bean
  public RegisterAccountHandler registerAccountHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      Transactions transactions,
      Clock clock,
      @Value("${editor.auth.max-users}") int maximum) {
    return new RegisterAccountHandler(accounts, passwords, transactions, clock, maximum);
  }

  @Bean
  public LoginHandler loginHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      Transactions transactions,
      SessionIssuer issuer,
      Clock clock) {
    return new LoginHandler(accounts, passwords, transactions, issuer, clock);
  }

  @Bean
  public RefreshSessionHandler refreshSessionHandler(
      AccountCommandRepository accounts,
      RefreshSessionRepository sessions,
      RefreshTokens tokens,
      Transactions transactions,
      SessionIssuer issuer,
      Clock clock) {
    return new RefreshSessionHandler(accounts, sessions, tokens, transactions, issuer, clock);
  }

  @Bean
  public LogoutHandler logoutHandler(
      AccountCommandRepository accounts,
      RefreshSessionRepository sessions,
      RefreshTokens tokens,
      Transactions transactions) {
    return new LogoutHandler(accounts, sessions, tokens, transactions);
  }

  @Bean
  public CheckLoginAttemptHandler loginAttemptHandler(LoginAttempts attempts) {
    return new CheckLoginAttemptHandler(attempts);
  }

  @Bean
  public GetProfileHandler getProfileHandler(AccountReadRepository accounts) {
    return new GetProfileHandler(accounts);
  }

  @Bean
  public ResolveAccountHandler resolveAccountHandler(
      AccountReadRepository accounts, ServiceCaller callers) {
    return new ResolveAccountHandler(accounts, callers);
  }

  @Bean
  public GetSigningKeysHandler signingKeysHandler(AccessTokens tokens) {
    return new GetSigningKeysHandler(tokens);
  }

  @Bean
  public IssueCsrfHandler csrfHandler(CsrfTokens tokens) {
    return new IssueCsrfHandler(tokens);
  }
}
