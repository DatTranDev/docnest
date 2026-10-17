FROM maven:3.9.16-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320 AS source
WORKDIR /src
ENV MAVEN_OPTS="-Xms64m -Xmx384m -XX:ActiveProcessorCount=2 -XX:ReservedCodeCacheSize=128m"
COPY pom.xml ./
COPY backend ./backend
COPY docs/contracts ./docs/contracts
FROM source AS build-all
ARG MAVEN_PROJECTS=backend/identity-service,backend/document-service,backend/processing-service,backend/collaboration-service,backend/payment-service
RUN --mount=type=cache,target=/root/.m2,sharing=locked mvn -B -ntp -pl "$MAVEN_PROJECTS" -am package -DskipTests

FROM source AS build
ARG SERVICE
RUN --mount=type=cache,target=/root/.m2,sharing=locked mvn -B -ntp -pl backend/${SERVICE} -am package -DskipTests
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5 AS runtime
ARG SECURITY_REFRESH
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 editor && useradd --uid 10001 --gid editor --create-home editor && mkdir -p /data/objects /data/keys && chown -R editor:editor /data
WORKDIR /app
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]

# Cloud builds share one reactor; local Compose retains the selected-service build.
FROM runtime AS cloud
ARG SERVICE
COPY --from=build-all /src/backend/${SERVICE}/target/${SERVICE}-1.0.0-SNAPSHOT.jar /app/app.jar

FROM runtime AS local
ARG SERVICE
COPY --from=build /src/backend/${SERVICE}/target/${SERVICE}-1.0.0-SNAPSHOT.jar /app/app.jar
