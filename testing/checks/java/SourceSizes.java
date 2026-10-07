import com.sun.source.tree.MethodTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import javax.tools.ToolProvider;

/** AST-based review signals only. File/function size is not an architecture pass/fail rule. */
public final class SourceSizes {
  public static void main(String[] args) throws Exception {
    Path root = Path.of(args[0]).toAbsolutePath();
    var compiler = ToolProvider.getSystemJavaCompiler();
    try (var manager = compiler.getStandardFileManager(null, null, null);
        var walk = Files.walk(root.resolve("backend"))) {
      var files =
          walk.filter(
                  path ->
                      path.toString().endsWith(".java")
                          && path.toString().contains("src" + java.io.File.separator + "main")
                          && !path.toString().contains("target"))
              .toList();
      var task =
          (JavacTask)
              compiler.getTask(
                  null,
                  manager,
                  null,
                  List.of("-proc:none"),
                  null,
                  manager.getJavaFileObjectsFromPaths(files));
      var positions = Trees.instance(task).getSourcePositions();
      for (var unit : task.parse()) {
        String file =
            root.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace('\\', '/');
        new TreePathScanner<Void, Void>() {
          @Override
          public Void visitMethod(MethodTree method, Void unused) {
            long start = positions.getStartPosition(unit, method),
                end = positions.getEndPosition(unit, method);
            if (start >= 0 && end >= start) {
              long lines =
                  unit.getLineMap().getLineNumber(end) - unit.getLineMap().getLineNumber(start) + 1;
              if (lines > 100) System.out.println(file + "\t" + method.getName() + "\t" + lines);
            }
            return super.visitMethod(method, unused);
          }
        }.scan(unit, null);
      }
    }
  }
}
