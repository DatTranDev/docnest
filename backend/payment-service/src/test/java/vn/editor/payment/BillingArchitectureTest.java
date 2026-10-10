package vn.editor.payment;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

class BillingArchitectureTest {
  @Test
  void enforceOwnershipAndLayers() {
    var source =
        new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("vn.editor.payment");
    classes()
        .that()
        .resideInAPackage("..billing.domain..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..billing.domain..")
        .check(source);
    classes()
        .that()
        .resideInAPackage("..billing.application..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..billing.application..", "..billing.domain..")
        .check(source);
    noClasses()
        .that()
        .resideInAPackage("..billing.api..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("..billing.infrastructure..", "..bootstrap..")
        .check(source);
    noClasses()
        .that()
        .resideInAPackage("..billing.api..")
        .should()
        .dependOnClassesThat(
            JavaClass.Predicates.resideInAPackage("..billing.application..")
                .and(JavaClass.Predicates.simpleNameEndingWith("Handler")))
        .check(source);
    noClasses()
        .that()
        .resideInAPackage("..billing.infrastructure..")
        .should()
        .dependOnClassesThat()
        .resideInAPackage("..billing.api..")
        .check(source);
    noClasses()
        .that()
        .resideInAPackage("vn.editor.payment..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage(
            "vn.editor.identity..",
            "vn.editor.document..",
            "vn.editor.processing..",
            "vn.editor.collaboration..")
        .check(source);
  }
}
