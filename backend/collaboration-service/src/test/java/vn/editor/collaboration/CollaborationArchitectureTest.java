package vn.editor.collaboration;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

class CollaborationArchitectureTest {
  @Test
  void portsProtectServiceAndLayerOwnership() {
    var production =
        new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("vn.editor.collaboration");
    classes()
        .that()
        .resideInAPackage("..domain..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..domain..")
        .check(production);
    classes()
        .that()
        .resideInAPackage("..application..")
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "..application..", "..domain..")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..api..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("..infrastructure..", "..bootstrap..")
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..api..")
        .should()
        .dependOnClassesThat(
            JavaClass.Predicates.resideInAPackage("..application..")
                .and(JavaClass.Predicates.simpleNameEndingWith("Handler")))
        .check(production);
    noClasses()
        .that()
        .resideInAPackage("..infrastructure..")
        .should()
        .dependOnClassesThat()
        .resideInAPackage("..api..")
        .check(production);
    noClasses()
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage(
            "vn.editor.identity..", "vn.editor.document..", "vn.editor.processing..")
        .check(production);
  }
}
