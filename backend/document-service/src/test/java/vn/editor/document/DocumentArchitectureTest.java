package vn.editor.document;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(
    packages = "vn.editor.document",
    importOptions = ImportOption.DoNotIncludeTests.class)
class DocumentArchitectureTest {
  @ArchTest
  static final ArchRule domainIsPlainJava =
      classes()
          .that()
          .resideInAPackage("..domain..")
          .should()
          .onlyDependOnClassesThat()
          .resideInAnyPackage("java..", "..domain..");

  @ArchTest
  static final ArchRule applicationUsesDomainAndPorts =
      classes()
          .that()
          .resideInAPackage("..application..")
          .should()
          .onlyDependOnClassesThat()
          .resideInAnyPackage("java..", "..application..", "..domain..");

  @ArchTest
  static final ArchRule apiDelegates =
      noClasses()
          .that()
          .resideInAPackage("..api..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(
              "..infrastructure..",
              "org.springframework.jdbc..",
              "org.springframework.transaction..",
              "org.springframework.data.redis..",
              "org.springframework.kafka..",
              "vn.editor.common.codec..",
              "vn.editor.common.storage..",
              "vn.editor.common.messaging..");

  @ArchTest
  static final ArchRule infrastructureCannotCallApi =
      noClasses()
          .that()
          .resideInAPackage("..infrastructure..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("..api..");

  @ArchTest
  static final ArchRule foldersDoNotReachOtherImplementations =
      noClasses()
          .that()
          .resideInAPackage("..folders..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(
              "..documents.infrastructure..",
              "..documents.api..",
              "..sharing.infrastructure..",
              "..sharing.api..",
              "..documents.application.command..",
              "..sharing.application.command..");

  @ArchTest
  static final ArchRule documentsDoNotReachOtherImplementations =
      noClasses()
          .that()
          .resideInAPackage("..documents..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(
              "..folders.infrastructure..",
              "..folders.api..",
              "..sharing.infrastructure..",
              "..sharing.api..",
              "..folders.application.command..",
              "..sharing.application.command..");

  @ArchTest
  static final ArchRule sharingUsesDocumentAuthorizationPort =
      noClasses()
          .that()
          .resideInAPackage("..sharing..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(
              "..documents.infrastructure..",
              "..documents.api..",
              "..folders.infrastructure..",
              "..folders.api..",
              "..documents.application.command..",
              "..folders.application.command..");
}
