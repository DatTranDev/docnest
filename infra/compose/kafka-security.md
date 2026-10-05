# Kafka lab authentication and topic authorization

Use SASL/PLAIN on private Docker/Kubernetes networking and StandardAuthorizer. This authenticates service principals and applies topic/group ACLs; PLAIN itself does not encrypt network traffic. For any connection across an untrusted network, use SASL_SSL with trusted broker certificates. Broker/controller ports stay internal; optional debug access is bound to localhost and still authenticated.

`kafka-start.sh` consumes five externally generated secrets (`KAFKA_BROKER_PASSWORD`, `KAFKA_ADMIN_PASSWORD`, `KAFKA_DOCUMENT_PASSWORD`, `KAFKA_PROCESSING_PASSWORD`, `KAFKA_OPERATOR_PASSWORD`). It writes mode-restricted JAAS/client files into the broker's ephemeral `/tmp/editor-kafka`; no secrets are written into an image or committed source. Mount this script and `kafka-init-acls.sh` read-only.

Broker configuration required in Compose/Kubernetes:

```yaml
command: [bash, /opt/editor-kafka/kafka-start.sh]
environment:
  KAFKA_LISTENERS: SASL_PLAINTEXT://:9092,CONTROLLER://:9093,DEBUG://:19092
  KAFKA_ADVERTISED_LISTENERS: SASL_PLAINTEXT://kafka:9092,DEBUG://localhost:19092
  KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: SASL_PLAINTEXT:SASL_PLAINTEXT,CONTROLLER:SASL_PLAINTEXT,DEBUG:SASL_PLAINTEXT
  KAFKA_INTER_BROKER_LISTENER_NAME: SASL_PLAINTEXT
  KAFKA_SASL_ENABLED_MECHANISMS: PLAIN
  KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL: PLAIN
  KAFKA_SASL_MECHANISM_CONTROLLER_PROTOCOL: PLAIN
  KAFKA_AUTHORIZER_CLASS_NAME: org.apache.kafka.metadata.authorizer.StandardAuthorizer
  KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND: 'false'
  KAFKA_SUPER_USERS: 'User:broker;User:admin'
```

Omit DEBUG from Kubernetes. Preserve the existing KRaft node/quorum and volume settings. Health checks call `/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 --command-config /tmp/editor-kafka/admin.properties`. Topic/ACL setup runs `bash /opt/editor-kafka/kafka-init-acls.sh` before starting the application services.

Document uses `KAFKA_SECURITY_PROTOCOL=SASL_PLAINTEXT`, `KAFKA_USERNAME=document`, and `KAFKA_PASSWORD` referencing the Document Kafka secret. Processing uses the Processing principal/secret. Identity receives no Kafka password. CLI operators use the operator properties file; administration uses the admin file. Never put JAAS passwords on a command line or print client property files.

| Principal    | Topic reads                                            | Topic writes                                                  | Consumer groups                               |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------- |
| Document     | processing.job.completed.v1                            | document.version.saved.v1, DLQ                                | document-preview-projection-v1                |
| Processing   | document.version.saved.v1, processing.job.requested.v1 | processing.job.requested.v1, processing.job.completed.v1, DLQ | processing-preview-v1, processing-dispatch-v1 |
| Operator     | DLQ                                                    | Three business topics for validated replay                    | editor-operator- prefix                       |
| Broker/admin | Superuser for KRaft and setup                          | Superuser                                                     | Superuser                                     |

IdempotentWrite cluster permission is granted only to the three producers. Anonymous requests are denied. Topic/group ACL setup is idempotent and has no auto-create grant to application principals.

Integration evidence must show allowed producer/consumer operations and denied anonymous, wrong-topic, wrong-group and wrong-password requests. Merely parsing this configuration does not pass the authorization gate.
