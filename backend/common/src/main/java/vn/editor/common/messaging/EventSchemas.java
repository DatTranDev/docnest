package vn.editor.common.messaging;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class EventSchemas {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Map<String, JsonSchema> SCHEMAS = new HashMap<>();

  static {
    for (String topic :
        List.of(
            "document.version.saved.v1",
            "processing.job.requested.v1",
            "processing.job.completed.v1",
            "editor.dead-letter.v1",
            "billing.identity.command.v1",
            "billing.document.command.v1",
            "billing.processing.command.v1",
            "billing.collaboration.command.v1",
            "billing.identity.reply.v1",
            "billing.document.reply.v1",
            "billing.processing.reply.v1",
            "billing.collaboration.reply.v1")) {
      try (var in =
          EventSchemas.class.getResourceAsStream("/contracts/events/" + topic + ".schema.json")) {
        if (in == null) throw new IllegalStateException("Missing event schema " + topic);
        SCHEMAS.put(
            topic,
            JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)
                .getSchema(
                    in, SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build()));
      } catch (Exception ex) {
        throw new ExceptionInInitializerError(ex);
      }
    }
  }

  public static boolean valid(String topic, String value) {
    if (value == null
        || value.getBytes(StandardCharsets.UTF_8).length
            > (topic.equals("editor.dead-letter.v1") ? 131072 : 65536)) return false;
    try {
      return SCHEMAS.containsKey(topic)
          && SCHEMAS.get(topic).validate(JSON.readTree(value)).isEmpty();
    } catch (Exception ex) {
      return false;
    }
  }

  private EventSchemas() {}
}
