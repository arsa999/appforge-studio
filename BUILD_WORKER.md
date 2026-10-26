# Android SDK + Gradle Build Worker

This implementation adds a real queued WebView Android build pipeline for **public HTTPS website URLs**. It builds only from the trusted checked-in Android template; it does not execute uploaded Kotlin/Gradle/scripts. Native visual-builder code generation and user-specific accounts/projects are not implemented by this worker.

## Requirements
- Docker Engine and Docker Compose plugin on a Linux host with at least 4 GB RAM and 10 GB free disk (more recommended).
- Internet access during the first image build to download Android SDK packages and Gradle.
- A reverse proxy with HTTPS for remote access. Do not expose Redis or the worker.

## Start
```sh
cp .env.example .env
# Edit .env and set BUILD_API_TOKEN to a random secret (e.g. openssl rand -hex 32)
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:8787/health
```

The API binds to loopback only. Put an HTTPS reverse proxy in front of it before remote use. Set `FRONTEND_ORIGIN` to the exact frontend origin. Do not commit `.env`.

## Request a build
```sh
curl -X POST http://127.0.0.1:8787/api/builds \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $BUILD_API_TOKEN" \
  -d '{"projectId":"demo-1","appName":"Demo App","packageId":"com.example.demo","websiteUrl":"https://example.com","target":"apk","buildType":"debug"}'
```
Poll `GET /api/builds/<id>` with the same Authorization header. `status` progresses through BullMQ states; successful response includes an artifact path. Artifacts are stored in a private Docker volume, not exposed publicly. Download them only through an authenticated artifact endpoint or an authenticated reverse-proxy route you add; do not publish the volume directory. This starter deliberately does not expose arbitrary artifact downloads without per-user authorization.

## Important constraints
- API bearer token is a starter-level shared secret, not user login. Add per-user authentication, ownership checks, quotas, audit logs and persistent build metadata before public launch.
- Release builds are **not Play Store-ready** until a signing-key management flow is implemented. Never bake signing secrets into images or logs.
- Build artifacts remain in the private `build-artifacts` volume; set retention and authenticated download handling before production.
- Worker uses a trusted template and bounded concurrency, memory, CPU, process count, read-only root filesystem and dropped Linux capabilities. Review Docker/kernel hardening and outbound network policy for production.
- Website-to-app output is a WebView wrapper; it cannot automatically turn a website into native Android screens. Websites that block WebView, require special permissions, or rely on unsupported browser APIs may not work as expected.
- Docker images and Android dependencies can change; update and pin versions, scan images, and test builds in CI before production.
