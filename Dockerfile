FROM node:22-bookworm-slim AS build
WORKDIR /srv
COPY package.json tsconfig.json ./
RUN npm install --ignore-scripts
COPY src ./src
RUN npm run build

FROM eclipse-temurin:17-jdk-jammy
ENV ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_HOME=/opt/android-sdk GRADLE_BIN=/opt/gradle/bin/gradle
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/* \
 && mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools /opt/gradle /opt/appforge /artifacts /tmp/gradle-cache \
 && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmd.zip \
 && unzip -q /tmp/cmd.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
 && mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
 && yes | ${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_SDK_ROOT} --licenses >/dev/null \
 && ${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_SDK_ROOT} "platform-tools" "platforms;android-35" "build-tools;35.0.0" \
 && curl -fsSL https://services.gradle.org/distributions/gradle-8.9-bin.zip -o /tmp/gradle.zip \
 && unzip -q /tmp/gradle.zip -d /opt/gradle \
 && ln -s /opt/gradle/gradle-8.9 /opt/gradle/current \
 && ln -s /opt/gradle/gradle-8.9/bin/gradle /opt/gradle/bin/gradle \
 && rm -f /tmp/cmd.zip /tmp/gradle.zip
WORKDIR /srv
COPY --from=build /srv/package.json ./package.json
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/dist ./dist
COPY android/webview-template /opt/appforge/template
RUN useradd --system --uid 10001 --create-home worker && chown -R worker:worker /artifacts /tmp/gradle-cache /opt/appforge
USER worker
CMD ["node", "dist/worker.js"]
