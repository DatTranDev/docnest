#!/bin/bash
set -euo pipefail
umask 077
# Only generated hexadecimal/base64url lab secrets. Reject JAAS metacharacters.
for name in KAFKA_BROKER_PASSWORD KAFKA_ADMIN_PASSWORD KAFKA_DOCUMENT_PASSWORD KAFKA_PROCESSING_PASSWORD KAFKA_OPERATOR_PASSWORD; do
  value=${!name:-}
  [[ "$value" =~ ^[a-zA-Z0-9_-]{20,128}$ ]] || { echo "Missing or invalid Kafka credential configuration" >&2; exit 1; }
done
mkdir -p /tmp/editor-kafka
cat > /tmp/editor-kafka/server-jaas.conf <<JAAS
KafkaServer {
  org.apache.kafka.common.security.plain.PlainLoginModule required
  username="broker"
  password="$KAFKA_BROKER_PASSWORD"
  user_broker="$KAFKA_BROKER_PASSWORD"
  user_admin="$KAFKA_ADMIN_PASSWORD"
  user_document="$KAFKA_DOCUMENT_PASSWORD"
  user_processing="$KAFKA_PROCESSING_PASSWORD"
  user_operator="$KAFKA_OPERATOR_PASSWORD";
};
JAAS
for user in admin document processing operator; do
  name="KAFKA_${user^^}_PASSWORD"
  value=${!name}
  cat > "/tmp/editor-kafka/$user.properties" <<CLIENT
security.protocol=SASL_PLAINTEXT
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="$user" password="$value";
CLIENT
done
export KAFKA_OPTS="${KAFKA_OPTS:-} -Djava.security.auth.login.config=/tmp/editor-kafka/server-jaas.conf"
# These are input secrets, not Kafka server properties; keep Docker's property renderer from seeing them.
unset KAFKA_BROKER_PASSWORD KAFKA_ADMIN_PASSWORD KAFKA_DOCUMENT_PASSWORD KAFKA_PROCESSING_PASSWORD KAFKA_OPERATOR_PASSWORD
exec /etc/kafka/docker/run
