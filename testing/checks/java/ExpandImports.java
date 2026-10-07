import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import javax.lang.model.element.Element;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.TypeElement;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** One-time semantic import expansion. CI checks imports without modifying source. */
public final class ExpandImports {
  public static void main(String[] args) throws Exception {
    Path root = Path.of(args[0]).toAbsolutePath().normalize();
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    try (var manager = compiler.getStandardFileManager(null, null, null);
        var walk = Files.walk(root.resolve("backend"))) {
      List<Path> paths =
          walk.filter(p -> p.toString().endsWith(".java") && !p.toString().contains("target"))
              .toList();
      var diagnostics = new DiagnosticCollector<JavaFileObject>();
      var task =
          (JavacTask)
              compiler.getTask(
                  null,
                  manager,
                  diagnostics,
                  List.of(
                      "-proc:none",
                      "-classpath",
                      Files.readString(Path.of(args[1])),
                      "--release",
                      "21"),
                  null,
                  manager.getJavaFileObjectsFromPaths(paths));
      var units = new ArrayList<CompilationUnitTree>();
      task.parse().forEach(units::add);
      task.analyze();
      if (diagnostics.getDiagnostics().stream()
          .anyMatch(d -> d.getKind() == javax.tools.Diagnostic.Kind.ERROR)) {
        throw new IllegalStateException(
            "Compile source successfully before semantic import expansion: "
                + diagnostics.getDiagnostics().stream()
                    .filter(d -> d.getKind() == javax.tools.Diagnostic.Kind.ERROR)
                    .limit(5)
                    .toList());
      }
      Trees trees = Trees.instance(task);
      int changed = 0;
      for (var unit : units) {
        Map<String, TreeSet<String>> expanded = new HashMap<>();
        for (ImportTree item : unit.getImports()) {
          String name = item.getQualifiedIdentifier().toString();
          if (name.endsWith(".*"))
            expanded.put(
                (item.isStatic() ? "static " : "") + name.substring(0, name.length() - 2),
                new TreeSet<>());
        }
        if (expanded.isEmpty()) continue;
        new TreePathScanner<Void, Void>() {
          @Override
          public Void visitImport(ImportTree tree, Void unused) {
            return null;
          }

          @Override
          public Void visitIdentifier(IdentifierTree tree, Void unused) {
            Element element = trees.getElement(getCurrentPath());
            if (element instanceof TypeElement type) {
              String qualified = type.getQualifiedName().toString();
              int dot = qualified.lastIndexOf('.');
              if (dot > 0 && expanded.containsKey(qualified.substring(0, dot)))
                expanded.get(qualified.substring(0, dot)).add(qualified);
            }
            if (element != null
                && element.getModifiers().contains(Modifier.STATIC)
                && element.getEnclosingElement() instanceof TypeElement owner) {
              String key = "static " + owner.getQualifiedName();
              if (expanded.containsKey(key))
                expanded.get(key).add(owner.getQualifiedName() + "." + element.getSimpleName());
            }
            return super.visitIdentifier(tree, unused);
          }
        }.scan(unit, null);
        Path file = Path.of(unit.getSourceFile().toUri()).toAbsolutePath().normalize();
        if (!file.startsWith(root)) throw new IllegalStateException("Source escaped workspace");
        String text = Files.readString(file);
        for (var entry : expanded.entrySet()) {
          boolean isStatic = entry.getKey().startsWith("static ");
          String prefix = isStatic ? "static " : "";
          String name = isStatic ? entry.getKey().substring(7) : entry.getKey();
          String replacement =
              String.join(
                  "\n", entry.getValue().stream().map(n -> "import " + prefix + n + ";").toList());
          text = text.replace("import " + prefix + name + ".*;", replacement);
        }
        Files.writeString(file, text);
        changed++;
      }
      System.out.println("Expanded wildcard imports semantically in " + changed + " sources");
    }
  }
}
