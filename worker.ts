import { Worker } from "bullmq";
import IORedis from "ioredis";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", { maxRetriesPerRequest: null });
const template = process.env.ANDROID_TEMPLATE ?? "/opt/appforge/template";
const outputRoot = process.env.ARTIFACT_DIR ?? "/artifacts";
const gradle = process.env.GRADLE_BIN ?? "/opt/gradle/bin/gradle";
await mkdir(outputRoot, { recursive: true });
function run(cmd: string, args: string[], cwd: string, timeoutMs = 8 * 60 * 1000) {
 return new Promise<void>((resolve, reject) => {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, GRADLE_USER_HOME: "/tmp/gradle-cache" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; const collect = (b: Buffer) => { output = (output + b.toString()).slice(-12000); };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.on("error", e => { clearTimeout(timer); reject(e); });
  child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Gradle failed (exit ${code}). ${output.slice(-3000)}`)); });
 });
}
const worker = new Worker("android-builds", async job => {
 const d = job.data as { id:string; appName:string; packageId:string; websiteUrl:string; target:"apk"|"aab"; buildType:"debug"|"release" };
 const work = await mkdtemp(path.join(tmpdir(), "appforge-"));
 try {
  // Copy a trusted, versioned template; user input is never treated as source code or a shell command.
  await run("cp", ["-R", `${template}/.`, work], "/");
  const activity = path.join(work, "app/src/main/java/com/appforge/template/MainActivity.kt");
  let kotlin = await readFile(activity, "utf8");
  const escapedUrl = JSON.stringify(d.websiteUrl);
  kotlin = kotlin.replace('const val DEFAULT_URL = "https://example.com"', `const val DEFAULT_URL = ${escapedUrl}`);
  await writeFile(activity, kotlin);
  const manifest = path.join(work, "app/src/main/AndroidManifest.xml");
  let xml = await readFile(manifest, "utf8");
  xml = xml.replace(/package="[^"]+"/, `package="${d.packageId}"`);
  await writeFile(manifest, xml);
  const gradleFile = path.join(work, "app/build.gradle.kts");
  let gradleText = await readFile(gradleFile, "utf8");
  gradleText = gradleText.replace(/namespace = "[^"]+"/, `namespace = "${d.packageId}"`).replace(/applicationId = "[^"]+"/, `applicationId = "${d.packageId}"`);
  await writeFile(gradleFile, gradleText);
  await job.updateProgress(10);
  const task = d.target === "aab" ? (d.buildType === "release" ? "bundleRelease" : "bundleDebug") : (d.buildType === "release" ? "assembleRelease" : "assembleDebug");
  await run(gradle, ["--no-daemon", "--stacktrace", task], work);
  await job.updateProgress(90);
  const variant = d.buildType === "release" ? "release" : "debug";
  const ext = d.target === "aab" ? "aab" : "apk";
  const source = path.join(work, "app/build/outputs", d.target, variant, `app-${variant}.${ext}`);
  const st = await stat(source);
  if (!st.isFile() || st.size < 1024) throw new Error("Build output missing or invalid");
  const filename = `${d.id}.${ext}`;
  await copyFile(source, path.join(outputRoot, filename));
  await job.updateProgress(100);
  return { artifact: `/artifacts/${filename}`, sizeBytes: st.size, target: d.target, buildType: d.buildType, note: d.buildType === "release" ? "Release build is not signed for Play Store distribution unless signing is configured." : "Debug artifact" };
 } finally { await rm(work, { recursive: true, force: true }); }
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1), lockDuration: 10 * 60 * 1000 });
worker.on("failed", (job, err) => console.error("Build failed", job?.id, err.message));
console.log("AppForge Android build worker online");
