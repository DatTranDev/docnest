#!/bin/bash
set -euo pipefail
bootstrap=${KAFKA_SETUP_BOOTSTRAP:-localhost:9092}
admin=/tmp/editor-kafka/admin.properties
topics=/opt/kafka/bin/kafka-topics.sh
acls=/opt/kafka/bin/kafka-acls.sh
for topic in document.version.saved.v1 processing.job.requested.v1 processing.job.completed.v1 editor.dead-letter.v1; do
  cap=65536; retention=86400000
  if [[ "$topic" == editor.dead-letter.v1 ]]; then cap=131072; retention=604800000; fi
  "$topics" --bootstrap-server "$bootstrap" --command-config "$admin" --create --if-not-exists --topic "$topic" --partitions 3 --replication-factor 1 --config "retention.ms=$retention" --config "max.message.bytes=$cap"
done
topic_acl() {
  local user=$1 topic=$2 operation=$3
  "$acls" --bootstrap-server "$bootstrap" --command-config "$admin" --add --allow-principal "User:$user" --topic "$topic" --operation "$operation" --operation Describe
}
group_acl() {
  "$acls" --bootstrap-server "$bootstrap" --command-config "$admin" --add --allow-principal "User:$1" --group "$2" --operation Read
}
# Producers cannot consume unrelated topics; consumers are restricted to exact groups.
topic_acl document document.version.saved.v1 Write
topic_acl document processing.job.completed.v1 Read
topic_acl document editor.dead-letter.v1 Write
group_acl document document-preview-projection-v1
topic_acl processing document.version.saved.v1 Read
topic_acl processing processing.job.requested.v1 Read
topic_acl processing processing.job.requested.v1 Write
topic_acl processing processing.job.completed.v1 Write
topic_acl processing editor.dead-letter.v1 Write
group_acl processing processing-preview-v1
group_acl processing processing-dispatch-v1
# An operator can read dead letters and republish validated envelopes, never anonymous traffic.
topic_acl operator editor.dead-letter.v1 Read
for topic in document.version.saved.v1 processing.job.requested.v1 processing.job.completed.v1; do topic_acl operator "$topic" Write; done
"$acls" --bootstrap-server "$bootstrap" --command-config "$admin" --add --allow-principal User:operator --group editor-operator- --resource-pattern-type prefixed --operation Read
for user in document processing operator; do
  "$acls" --bootstrap-server "$bootstrap" --command-config "$admin" --add --allow-principal "User:$user" --cluster --operation IdempotentWrite
done
echo "Kafka topics and service ACLs configured."
