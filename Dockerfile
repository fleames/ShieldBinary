# Stage 1: Build Go API and worker
FROM golang:1.22-alpine AS go-builder
WORKDIR /build
COPY go.mod go.sum* ./
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /api ./cmd/api
RUN CGO_ENABLED=0 go build -o /worker ./cmd/worker

# Stage 2: Build JVM engine
FROM maven:3.9-eclipse-temurin-17-alpine AS jvm-builder
WORKDIR /build
COPY engine-jvm/pom.xml .
COPY engine-jvm/src ./src
RUN mvn package -q

# Stage 3: Build .NET engine
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS dotnet-builder
WORKDIR /build
COPY engine/ .
RUN dotnet publish -c Release -r linux-x64 --self-contained -o /engine

# Stage 4: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# Stage 5: Runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=go-builder /api /app/api
COPY --from=go-builder /worker /app/worker
COPY --from=dotnet-builder /engine /app/engine
COPY --from=jvm-builder /build/target/shieldbinary-jvm-engine.jar /app/engine-jvm/shieldbinary-jvm-engine.jar
COPY --from=frontend-builder /build/dist /app/web

ENV SHIELD_ENGINE_PATH=/app/engine/shieldbinary-engine
ENV SHIELD_JVM_ENGINE_PATH=/app/engine-jvm/shieldbinary-jvm-engine.jar
ENV SHIELD_WEB_ROOT=/app/web
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
EXPOSE 8080

# Default: run API. Use `docker run ... /app/worker` for worker.
# Native PE packing is not supported in Linux; use a Windows worker for native binaries.
CMD ["/app/api"]
