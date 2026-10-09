package vn.editor.collaboration;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import vn.editor.collaboration.subscriptions.domain.PlanGrant;

class SubscriptionPolicyTest {
  @Test
  void projectionsExpireAndOnlyNewGenerationsCanSupersede() {
    var grant =
        new PlanGrant(
            UUID.randomUUID(), UUID.randomUUID(), 2, "APPLY", "PRO_MONTHLY", Instant.EPOCH);
    assertEquals("FREE", grant.effective(Instant.now()));
    assertTrue(grant.supersedes(1));
    assertFalse(grant.supersedes(2));
    assertFalse(grant.canApply(false));
    assertTrue(
        new PlanGrant(grant.userId(), grant.sagaId(), 3, "APPLY", "FREE", null).canApply(false));
  }

  @Test
  void subscriptionDomainAndApplicationStayIndependent() {
    var source =
        new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("vn.editor.collaboration.subscriptions");
    classes()
        .that()
        .resideInAPackage("..subscriptions.domain..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..subscriptions.domain..")
        .check(source);
    classes()
        .that()
        .resideInAPackage("..subscriptions.application..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..subscriptions.domain..", "..subscriptions.application..")
        .check(source);
  }
}
