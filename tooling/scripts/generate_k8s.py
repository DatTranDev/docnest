"""Generate reviewable Kubernetes lab resources. Does not contact a cluster."""

import pathlib, yaml

root = pathlib.Path(__file__).resolve().parents[2]
base = root / "infra/k8s/base"
overlay = root / "infra/k8s/overlays/lab"
base.mkdir(parents=True, exist_ok=True)
overlay.mkdir(parents=True, exist_ok=True)
resources = []


def write(name, docs):
    (base / name).write_text(
        yaml.safe_dump_all(docs, sort_keys=False), encoding="utf-8"
    )
    resources.append(name)


def meta(name):
    return {"name": name, "labels": {"app": name, "application": "text-editor"}}


def service(name, port):
    return {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": meta(name),
        "spec": {
            "selector": {"app": name},
            "ports": [{"port": port, "targetPort": port}],
        },
    }


def envsecret(key):
    return {
        "name": key,
        "valueFrom": {"secretKeyRef": {"name": "editor-secrets", "key": key}},
    }


write(
    "namespace.yaml",
    [
        {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {
                "name": "editor-lab",
                "labels": {"pod-security.kubernetes.io/enforce": "baseline"},
            },
        }
    ],
)
write(
    "config.yaml",
    [
        {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": "editor-config"},
            "data": {
                "PORT": "8080",
                "SPRING_PROFILES_ACTIVE": "cloud",
                "FLYWAY_ENABLED": "false",
                "SPRING_FLYWAY_ENABLED": "false",
                "MYSQL_HOST": "mysql",
                "IDENTITY_DB_URL": "jdbc:mysql://mysql:3306/identity_db?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
                "IDENTITY_DB_USER": "identity",
                "DATABASE_URL": "jdbc:mysql://mysql:3306/document_db?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
                "DOCUMENT_DB_USER": "document",
                "PROCESSING_DB_URL": "jdbc:mysql://mysql:3306/processing_db?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
                "PROCESSING_DB_USER": "processing",
                "COLLABORATION_DB_URL": "jdbc:mysql://mysql:3306/collaboration_db?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
                "COLLABORATION_DB_USER": "collaboration",
                "PAYMENT_DB_URL": "jdbc:mysql://mysql:3306/payment_db?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
                "PAYMENT_DB_USER": "payment",
                "STRIPE_PRO_MONTHLY_PRICE": "price_CONFIGURE_MONTHLY",
                "STRIPE_PRO_YEARLY_PRICE": "price_CONFIGURE_YEARLY",
                "KAFKA_BOOTSTRAP_SERVERS": "kafka:9092",
                "SPRING_KAFKA_BOOTSTRAP_SERVERS": "kafka:9092",
                "REDIS_HOST": "redis",
                "SPRING_DATA_REDIS_HOST": "redis",
                "JWT_ISSUER": "https://YOUR_DOMAIN",
                "JWT_AUDIENCE": "editor-api",
                "JWT_JWK_URI": "http://identity-service:8080/.well-known/jwks.json",
                "IDENTITY_BASE_URL": "http://identity-service:8080",
                "DOCUMENT_URL": "http://document-service:8080",
                "WEB_ORIGIN": "https://YOUR_DOMAIN",
                "ALLOWED_ORIGINS": "https://YOUR_DOMAIN",
                "PUBLIC_BASE_URL": "https://YOUR_DOMAIN",
                "STORAGE_PROVIDER": "GCS",
                "STORAGE_ROOT": "/data/objects",
                "SNAPSHOTS_BUCKET": "YOUR_PRIVATE_SNAPSHOTS_BUCKET",
                "GCS_BUCKET": "YOUR_PRIVATE_RESULTS_BUCKET",
                "JWT_KEY_PATH": "/keys/identity-key.pem",
                "JWT_ALLOW_KEY_GENERATION": "false",
                "SECURE_COOKIES": "true",
                "JAVA_TOOL_OPTIONS": "-XX:MaxRAMPercentage=60 -Dfile.encoding=UTF-8",
            },
        }
    ],
)
for name in [
    "identity-service",
    "document-service",
    "processing-service",
    "collaboration-service",
    "payment-service",
    "web",
]:
    isweb = name == "web"
    small = name in [
        "web",
        "identity-service",
        "collaboration-service",
        "payment-service",
    ]
    req = "128Mi" if small else "256Mi"
    limit = "512Mi" if small else "768Mi"
    cont = {
        "name": name,
        "image": f"YOUR_REGION-docker.pkg.dev/YOUR_PROJECT/editor/{name}:REPLACE_WITH_DIGEST",
        "ports": [{"containerPort": 8080}],
        "resources": {
            "requests": {"cpu": "100m", "memory": req},
            "limits": {"cpu": "1000m", "memory": limit},
        },
        "securityContext": {
            "runAsNonRoot": True,
            "runAsUser": 1000 if isweb else 10001,
            "allowPrivilegeEscalation": False,
            "capabilities": {"drop": ["ALL"]},
        },
        "startupProbe": {
            "httpGet": {
                "path": "/healthz" if isweb else "/actuator/health/liveness",
                "port": 8080,
            },
            "failureThreshold": 60,
            "periodSeconds": 5,
        },
        "readinessProbe": {
            "httpGet": {
                "path": "/healthz" if isweb else "/actuator/health/readiness",
                "port": 8080,
            },
            "periodSeconds": 10,
        },
        "livenessProbe": {
            "httpGet": {
                "path": "/healthz" if isweb else "/actuator/health/liveness",
                "port": 8080,
            },
            "periodSeconds": 15,
        },
        "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}],
    }
    volumes = [{"name": "tmp", "emptyDir": {}}]
    if not isweb:
        cont["envFrom"] = [{"configMapRef": {"name": "editor-config"}}]
        cont["env"] = [
            envsecret(name.split("-")[0].upper() + "_DB_PASSWORD"),
        ]
        if name not in ["collaboration-service", "payment-service"]:
            cont["env"] += [
                envsecret("DOCUMENT_INTERNAL_KEY"),
                envsecret("PROCESSING_INTERNAL_KEY"),
            ]
        cont["volumeMounts"].append({"name": "data", "mountPath": "/data"})
        volumes.append({"name": "data", "emptyDir": {}})
    if name == "identity-service":
        cont["volumeMounts"].append(
            {"name": "jwt", "mountPath": "/keys", "readOnly": True}
        )
        volumes.append({"name": "jwt", "secret": {"secretName": "editor-jwt"}})
    if name in [
        "identity-service",
        "document-service",
        "processing-service",
        "collaboration-service",
        "payment-service",
    ]:
        principal = name.split("-")[0]
        cont["env"] += [
            {"name": "KAFKA_SECURITY_PROTOCOL", "value": "SASL_PLAINTEXT"},
            {"name": "KAFKA_USERNAME", "value": principal},
            {
                "name": "KAFKA_PASSWORD",
                "valueFrom": {
                    "secretKeyRef": {
                        "name": "editor-secrets",
                        "key": "KAFKA_" + principal.upper() + "_PASSWORD",
                    }
                },
            },
        ]
    if name == "payment-service":
        cont["env"] += [
            envsecret(key) for key in ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
        ]
    if isweb:
        cont["env"] = [
            {"name": key, "value": value}
            for key, value in {
                "NODE_ENV": "production",
                "NODE_OPTIONS": "--max-old-space-size=256",
                "PORT": "8080",
                "NEXT_INTERNAL_PORT": "3000",
                "IDENTITY_INTERNAL_ORIGIN": "http://identity-service:8080",
                "DOCUMENT_INTERNAL_ORIGIN": "http://document-service:8080",
                "PROCESSING_INTERNAL_ORIGIN": "http://processing-service:8080",
                "COLLABORATION_INTERNAL_ORIGIN": "http://collaboration-service:8080",
                "PAYMENT_INTERNAL_ORIGIN": "http://payment-service:8080",
                "TRUSTED_PROXY_CIDRS": "",
            }.items()
        ]
    pod = {
        "serviceAccountName": name,
        "terminationGracePeriodSeconds": 45,
        "containers": [cont],
        "volumes": volumes,
    }
    if isweb:
        pod["securityContext"] = {"fsGroup": 1000}
    serviceaccount = meta(name)
    if name not in ["web", "collaboration-service", "payment-service"]:
        serviceaccount["annotations"] = {
            "iam.gke.io/gcp-service-account": f'editor-{name.split("-")[0]}@YOUR_PROJECT.iam.gserviceaccount.com'
        }
    webservice = service(name, 8080)
    if isweb:
        webservice["metadata"]["annotations"] = {
            "cloud.google.com/neg": '{"ingress":true}'
        }
    docs = [
        {"apiVersion": "v1", "kind": "ServiceAccount", "metadata": serviceaccount},
        {
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": meta(name),
            "spec": {
                "replicas": 1,
                "selector": {"matchLabels": {"app": name}},
                "strategy": {
                    "type": "RollingUpdate",
                    "rollingUpdate": {"maxSurge": 0, "maxUnavailable": 1},
                },
                "template": {
                    "metadata": {"labels": {"app": name, "application": "text-editor"}},
                    "spec": pod,
                },
            },
        },
        webservice,
    ]
    write(name + ".yaml", docs)
    if not isweb:
        migration = {
            **cont,
            "name": "migrate",
            "args": ["--editor.migrate-only=true", "--spring.flyway.enabled=true"],
            "env": cont["env"]
            + [
                {"name": "SPRING_MAIN_WEB_APPLICATION_TYPE", "value": "none"},
                {"name": "FLYWAY_ENABLED", "value": "true"},
            ],
        }
        for k in ["startupProbe", "readinessProbe", "livenessProbe", "ports"]:
            migration.pop(k, None)
        job = {
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": meta("migrate-" + name),
            "spec": {
                "backoffLimit": 1,
                "activeDeadlineSeconds": 300,
                "ttlSecondsAfterFinished": 3600,
                "template": {
                    "metadata": {"labels": {"app": name, "application": "text-editor"}},
                    "spec": {
                        **pod,
                        "restartPolicy": "Never",
                        "containers": [migration],
                    },
                },
            },
        }
        (base / ("migrate-" + name + ".yaml")).write_text(
            yaml.safe_dump(job, sort_keys=False), encoding="utf-8"
        )
mysql = {
    "name": "mysql",
    "image": "mysql:8.4.7@sha256:0426ec38c7a10aa45ba383887df7878f74ee70e2fd589c7b69207f3577901903",
    "ports": [{"containerPort": 3306}],
    "env": [
        envsecret(x)
        for x in [
            "MYSQL_ROOT_PASSWORD",
            "IDENTITY_DB_PASSWORD",
            "DOCUMENT_DB_PASSWORD",
            "PROCESSING_DB_PASSWORD",
            "COLLABORATION_DB_PASSWORD",
            "PAYMENT_DB_PASSWORD",
        ]
    ],
    "args": ["--innodb-buffer-pool-size=256M", "--max-connections=100"],
    "volumeMounts": [
        {"name": "data", "mountPath": "/var/lib/mysql"},
        {"name": "init", "mountPath": "/docker-entrypoint-initdb.d"},
    ],
    "resources": {
        "requests": {"cpu": "250m", "memory": "384Mi"},
        "limits": {"cpu": "1000m", "memory": "768Mi"},
    },
    "readinessProbe": {
        "exec": {
            "command": [
                "bash",
                "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -uroot --silent',
            ]
        },
        "periodSeconds": 10,
    },
    "startupProbe": {
        "exec": {
            "command": [
                "bash",
                "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -uroot --silent',
            ]
        },
        "failureThreshold": 60,
        "periodSeconds": 5,
    },
}
kafka = {
    "name": "kafka",
    "image": "apache/kafka:4.1.1@sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40",
    "ports": [{"containerPort": 9092}, {"containerPort": 9093}],
    "env": [
        {"name": k, "value": v}
        for k, v in {
            "CLUSTER_ID": "MkU3OEVBNTcwNTJENDM2Qk",
            "KAFKA_NODE_ID": "1",
            "KAFKA_PROCESS_ROLES": "broker,controller",
            "KAFKA_LISTENERS": "PLAINTEXT://:9092,CONTROLLER://:9093",
            "KAFKA_ADVERTISED_LISTENERS": "PLAINTEXT://kafka:9092",
            "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP": "PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT",
            "KAFKA_CONTROLLER_LISTENER_NAMES": "CONTROLLER",
            "KAFKA_INTER_BROKER_LISTENER_NAME": "PLAINTEXT",
            "KAFKA_CONTROLLER_QUORUM_VOTERS": "1@kafka:9093",
            "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR": "1",
            "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR": "1",
            "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR": "1",
            "KAFKA_AUTO_CREATE_TOPICS_ENABLE": "false",
            "KAFKA_LOG_DIRS": "/var/lib/kafka/data",
            "KAFKA_HEAP_OPTS": "-Xmx768m -Xms256m",
        }.items()
    ],
    "volumeMounts": [{"name": "data", "mountPath": "/var/lib/kafka/data"}],
    "resources": {
        "requests": {"cpu": "250m", "memory": "768Mi"},
        "limits": {"cpu": "1000m", "memory": "1536Mi"},
    },
    "readinessProbe": {"tcpSocket": {"port": 9092}, "periodSeconds": 10},
    "startupProbe": {
        "tcpSocket": {"port": 9092},
        "periodSeconds": 5,
        "failureThreshold": 60,
    },
}
# Kafka authenticates the controller as well as clients; there is no anonymous superuser.
kafka["command"] = ["bash", "/opt/editor-kafka/kafka-start.sh"]
security = {
    "KAFKA_LISTENERS": "SASL_PLAINTEXT://:9092,CONTROLLER://:9093",
    "KAFKA_ADVERTISED_LISTENERS": "SASL_PLAINTEXT://kafka:9092",
    "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP": "SASL_PLAINTEXT:SASL_PLAINTEXT,CONTROLLER:SASL_PLAINTEXT",
    "KAFKA_INTER_BROKER_LISTENER_NAME": "SASL_PLAINTEXT",
    "KAFKA_SASL_ENABLED_MECHANISMS": "PLAIN",
    "KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL": "PLAIN",
    "KAFKA_SASL_MECHANISM_CONTROLLER_PROTOCOL": "PLAIN",
    "KAFKA_AUTHORIZER_CLASS_NAME": "org.apache.kafka.metadata.authorizer.StandardAuthorizer",
    "KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND": "false",
    "KAFKA_SUPER_USERS": "User:broker;User:admin",
}
kafka["env"] = (
    [e for e in kafka["env"] if e["name"] not in security]
    + [{"name": k, "value": v} for k, v in security.items()]
    + [
        envsecret("KAFKA_" + p + "_PASSWORD")
        for p in [
            "BROKER",
            "ADMIN",
            "DOCUMENT",
            "PROCESSING",
            "OPERATOR",
            "IDENTITY",
            "COLLABORATION",
            "PAYMENT",
        ]
    ]
)
kafka["volumeMounts"].append(
    {"name": "auth-config", "mountPath": "/opt/editor-kafka", "readOnly": True}
)
probe = {
    "exec": {
        "command": [
            "bash",
            "-c",
            "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 --command-config /tmp/editor-kafka/admin.properties >/dev/null 2>&1",
        ]
    },
    "periodSeconds": 10,
    "timeoutSeconds": 10,
}
kafka["readinessProbe"] = probe
kafka["startupProbe"] = {**probe, "failureThreshold": 60}
for name, cont, size in [("mysql", mysql, "20Gi"), ("kafka", kafka, "10Gi")]:
    pod = {
        "containers": [cont],
        "terminationGracePeriodSeconds": 60,
        "securityContext": {"fsGroup": 1000} if name == "kafka" else {},
    }
    if name == "mysql":
        pod["volumes"] = [
            {"name": "init", "configMap": {"name": "mysql-init", "defaultMode": 493}}
        ]
    if name == "kafka":
        pod["volumes"] = [
            {
                "name": "auth-config",
                "configMap": {"name": "kafka-auth", "defaultMode": 493},
            }
        ]
    write(
        name + ".yaml",
        [
            {
                "apiVersion": "apps/v1",
                "kind": "StatefulSet",
                "metadata": meta(name),
                "spec": {
                    "serviceName": name,
                    "replicas": 1,
                    "selector": {"matchLabels": {"app": name}},
                    "template": {
                        "metadata": {
                            "labels": {"app": name, "application": "text-editor"}
                        },
                        "spec": pod,
                    },
                    "volumeClaimTemplates": [
                        {
                            "metadata": {"name": "data"},
                            "spec": {
                                "accessModes": ["ReadWriteOnce"],
                                "storageClassName": "standard-rwo",
                                "resources": {"requests": {"storage": size}},
                            },
                        }
                    ],
                },
            },
            service(name, 3306 if name == "mysql" else 9092),
        ],
    )
write(
    "redis.yaml",
    [
        {
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": meta("redis"),
            "spec": {
                "replicas": 1,
                "selector": {"matchLabels": {"app": "redis"}},
                "template": {
                    "metadata": {
                        "labels": {"app": "redis", "application": "text-editor"}
                    },
                    "spec": {
                        "containers": [
                            {
                                "name": "redis",
                                "image": "redis:8.4.0@sha256:c22af04bb576503bf16b3e34a1fd2fd82de0f765afd866d2e380145e0af30d78",
                                "args": [
                                    "redis-server",
                                    "--maxmemory",
                                    "128mb",
                                    "--maxmemory-policy",
                                    "allkeys-lru",
                                ],
                                "ports": [{"containerPort": 6379}],
                                "resources": {
                                    "requests": {"cpu": "50m", "memory": "32Mi"},
                                    "limits": {"cpu": "500m", "memory": "256Mi"},
                                },
                                "readinessProbe": {
                                    "exec": {"command": ["redis-cli", "ping"]},
                                    "periodSeconds": 10,
                                },
                            }
                        ]
                    },
                },
            },
        },
        service("redis", 6379),
    ],
)
write(
    "network.yaml",
    [
        {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "NetworkPolicy",
            "metadata": {"name": "default-deny-ingress"},
            "spec": {"podSelector": {}, "policyTypes": ["Ingress"]},
        },
        {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "NetworkPolicy",
            "metadata": {"name": "application-internal"},
            "spec": {
                "podSelector": {"matchLabels": {"application": "text-editor"}},
                "policyTypes": ["Ingress", "Egress"],
                "ingress": [
                    {
                        "from": [
                            {
                                "podSelector": {
                                    "matchLabels": {"application": "text-editor"}
                                }
                            }
                        ]
                    }
                ],
                "egress": [
                    {
                        "to": [
                            {
                                "podSelector": {
                                    "matchLabels": {"application": "text-editor"}
                                }
                            }
                        ]
                    },
                    {
                        "to": [
                            {
                                "namespaceSelector": {
                                    "matchLabels": {
                                        "kubernetes.io/metadata.name": "kube-system"
                                    }
                                }
                            }
                        ],
                        "ports": [
                            {"protocol": "UDP", "port": 53},
                            {"protocol": "TCP", "port": 53},
                        ],
                    },
                    {
                        "to": [{"ipBlock": {"cidr": "0.0.0.0/0"}}],
                        "ports": [{"port": 443, "protocol": "TCP"}],
                    },
                    {
                        "to": [
                            {"ipBlock": {"cidr": "169.254.169.254/32"}},
                            {"ipBlock": {"cidr": "169.254.169.252/32"}},
                        ],
                        "ports": [
                            {"protocol": "TCP", "port": 80},
                            {"protocol": "TCP", "port": 988},
                        ],
                    },
                ],
            },
        },
    ],
)
(base / "mysql-init.sh").write_bytes(
    (root / "infra/compose/mysql-init.sh").read_bytes()
)
for filename in ["kafka-start.sh", "kafka-init-acls.sh"]:
    (base / filename).write_text(
        (root / "infra/compose" / filename).read_text(encoding="utf-8"),
        encoding="utf-8",
        newline="\n",
    )
(base / "kustomization.yaml").write_text(
    yaml.safe_dump(
        {
            "apiVersion": "kustomize.config.k8s.io/v1beta1",
            "kind": "Kustomization",
            "namespace": "editor-lab",
            "resources": resources,
            "configMapGenerator": [
                {"name": "mysql-init", "files": ["mysql-init.sh"]},
                {
                    "name": "kafka-auth",
                    "files": ["kafka-start.sh", "kafka-init-acls.sh"],
                },
            ],
            "generatorOptions": {"disableNameSuffixHash": True},
        },
        sort_keys=False,
    )
)
(overlay / "kustomization.yaml").write_text(
    yaml.safe_dump(
        {
            "apiVersion": "kustomize.config.k8s.io/v1beta1",
            "kind": "Kustomization",
            "namespace": "editor-lab",
            "resources": ["../../base"],
        },
        sort_keys=False,
    )
)
print(
    "Generated Kubernetes base and lab overlay. Migration jobs are applied separately before application rollout."
)
