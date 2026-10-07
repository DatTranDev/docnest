FROM maven:3.9.16-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320 AS build
WORKDIR /src
ENV MAVEN_OPTS="-Xms64m -Xmx384m -XX:ActiveProcessorCount=2 -XX:ReservedCodeCacheSize=128m"
COPY pom.xml ./
COPY backend ./backend
COPY docs/contracts ./docs/contracts
COPY testing/fixtures/native ./testing/fixtures/native
ARG SERVICE
RUN --mount=type=cache,target=/root/.m2,sharing=locked mvn -B -ntp -pl backend/${SERVICE} -am package -DskipTests
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 editor && useradd --uid 10001 --gid editor --create-home editor && mkdir -p /data/objects /data/keys && chown -R editor:editor /data
WORKDIR /app
ARG SERVICE
COPY --from=build /src/backend/${SERVICE}/target/${SERVICE}-1.0.0-SNAPSHOT.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
