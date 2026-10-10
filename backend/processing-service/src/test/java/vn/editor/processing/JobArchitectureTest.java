package vn.editor.processing;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

class JobArchitectureTest {
  private final com.tngtech.archunit.core.domain.JavaClasses production =
      new ClassFileImporter()
          .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
          .importPackages("vn.editor.processing");

  @Test
  void domainIsIndependentOfFrameworksAndInfrastructure() {
    classes()
        .that()
        .resideInAPackage("..jobs.domain..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..jobs.domain..")
        .check(production);
  }

  @Test
  void applicationUsesDomainAndPortsWithoutExternalImplementations() {
    classes()
        .that()
        .resideInAPackage("..jobs.application..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage(
            "java..", "..jobs.application..", "..jobs.domain..", "vn.editor.common.storage..")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..jobs.application..")
        .should()
        .dependOnClassesThat()
        .haveSimpleName("GcsStorage")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..jobs.application..")
        .should()
        .dependOnClassesThat()
        .haveSimpleName("LocalStorage")
        .check(production);
  }

  @Test
  void apiDelegatesThroughApplicationBoundaries() {
    noClasses()
        .that()
        .resideInAPackage("..jobs.api..")
        .should()
        .dependOnClassesThat(
            JavaClass.Predicates.resideInAPackage("..jobs.application..")
                .and(JavaClass.Predicates.simpleNameEndingWith("Handler")))
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..jobs.api..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage(
            "..jobs.infrastructure..", "..bootstrap..", "vn.editor.common.storage..")
        .check(production);
  }

  @Test
  void infrastructureCannotReachHttpOrOtherServices() {
    noClasses()
        .that()
        .resideInAPackage("..jobs.infrastructure..")
        .should()
        .dependOnClassesThat()
        .resideInAPackage("..jobs.api..")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("vn.editor.processing..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("vn.editor.document..", "vn.editor.identity..")
        .check(production);
  }
}
