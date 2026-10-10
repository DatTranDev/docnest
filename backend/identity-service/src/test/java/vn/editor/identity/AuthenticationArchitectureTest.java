package vn.editor.identity;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

class AuthenticationArchitectureTest {
  private final com.tngtech.archunit.core.domain.JavaClasses production =
      new ClassFileImporter()
          .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
          .importPackages("vn.editor.identity");

  @Test
  void domainIsPlainJavaAndOwnsNoExternalInfrastructure() {
    ArchRule rule =
        classes()
            .that()
            .resideInAPackage("..auth.domain..")
            .should()
            .onlyDependOnClassesThat()
            .resideInAnyPackage("java..", "..auth.domain..");
    rule.check(production);
  }

  @Test
  void applicationsDependOnlyOnDomainAndApplicationPorts() {
    classes()
        .that()
        .resideInAPackage("..auth.application..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..auth.application..", "..auth.domain..")
        .check(production);
  }

  @Test
  void apiAndInfrastructureDoNotReachThroughLayersOrOtherServices() {
    noClasses()
        .that()
        .resideInAPackage("..auth.api..")
        .should()
        .dependOnClassesThat(
            JavaClass.Predicates.resideInAPackage("..auth.application..")
                .and(JavaClass.Predicates.simpleNameEndingWith("Handler")))
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..auth.api..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("..auth.infrastructure..", "..bootstrap..")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("vn.editor.identity..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("vn.editor.document..", "vn.editor.processing..")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..auth.infrastructure..")
        .should()
        .dependOnClassesThat()
        .resideInAPackage("..auth.api..")
        .check(production);
  }
}
