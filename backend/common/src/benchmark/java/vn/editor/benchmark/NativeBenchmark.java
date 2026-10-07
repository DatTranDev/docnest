package vn.editor.benchmark;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import vn.editor.common.codec.NativeCodec;

/** Actual CPU validation measurements; browser/process memory benchmarks remain separate. */
public final class NativeBenchmark {
  public static void main(String[] args) throws Exception {
    if (args.length != 2)
      throw new IllegalArgumentException(
          "Usage: NativeBenchmark generated-fixture-directory report.json");
    Map<String, Object> report = new LinkedHashMap<>();
    report.put("java", System.getProperty("java.version"));
    report.put("unicode", com.ibm.icu.lang.UCharacter.getUnicodeVersion().toString());
    report.put("warmup", 5);
    report.put("samples", 30);
    report.put(
        "heapNote", "Sampled JVM heap is supplemental; not total process RAM or browser memory.");
    List<Map<String, Object>> workloads = new ArrayList<>();
    for (String file :
        List.of(
            "ascii-long-line-10MiB.tedoc",
            "million-lines.tedoc",
            "unicode-near-10MiB.tedoc",
            "dense-10MiB.tedoc")) {
      Path path = Path.of(args[0], file);
      for (int i = 0; i < 5; i++) NativeCodec.decode(path);
      double[] samples = new double[30];
      long peak = 0;
      NativeCodec.Decoded decoded = null;
      for (int i = 0; i < 30; i++) {
        long begin = System.nanoTime();
        decoded = NativeCodec.decode(path);
        samples[i] = (System.nanoTime() - begin) / 1000000.0;
        peak =
            Math.max(peak, Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
      }
      Arrays.sort(samples);
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("file", file);
      r.put("nativeBytes", decoded.nativeBytes());
      r.put("textUtf8Bytes", decoded.manifest().get("utf8Bytes"));
      r.put("utf16Length", decoded.text().length());
      r.put("logicalLines", decoded.manifest().get("logicalLines"));
      r.put("p50Ms", samples[14]);
      r.put("p95Ms", samples[28]);
      r.put("p99Ms", samples[29]);
      r.put("sampledPeakHeapBytes", peak);
      r.put("validationP95Target3000ms", samples[28] <= 3000);
      workloads.add(r);
      System.out.println(file + ": p95=" + Math.round(samples[28]) + "ms");
    }
    report.put("workloads", workloads);
    Path target = Path.of(args[1]);
    if (target.getParent() != null) Files.createDirectories(target.getParent());
    new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(target.toFile(), report);
  }
}
