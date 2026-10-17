# CI only: package the exact jar already produced by Maven verify on this runner.
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
ARG SECURITY_REFRESH
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 editor && useradd --uid 10001 --gid editor --create-home editor && mkdir -p /data/objects /data/keys && chown -R editor:editor /data
WORKDIR /app
COPY --chown=10001:10001 app.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
