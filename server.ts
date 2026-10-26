import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const redis = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", { maxRetriesPerRequest: null });
const queue = new Queue("android-builds", { connection: redis });
const token = process.env.BUILD_API_TOKEN;
if (!token || token.length < 32) throw new Error("BUILD_API_TOKEN must be set to a random secret of at least 32 characters");
await app.register(cors, { origin: (process.env.FRONTEND_ORIGIN ?? "http://localhost:8080").split(","), methods: ["GET", "POST"] });
await app.register(rateLimit, { max: 10, timeWindow: "1 minute" });
function authorized(value: unknown) {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value), b = Buffer.from(token!);
  return a.length === b.length && timingSafeEqual(a, b);
}
app.addHook("preHandler", async (req, reply) => {
  if (req.url === "/health") return;
  if (!authorized(req.headers.authorization?.replace(/^Bearer\s+/i, ""))) return reply.code(401).send({ error: "Unauthorized" });
});
app.get("/health", async () => ({ status: "ok", service: "appforge-api", workerQueue: "bullmq" }));
const BuildRequest = z.object({
  projectId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  appName: z.string().trim().min(1).max(48).regex(/^[\p{L}\p{N} ._-]+$/u),
  packageId: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,5}$/).max(180),
  websiteUrl: z.string().url().max(2048).refine(v => { try { const u = new URL(v); return u.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(u.hostname); } catch { return false; } }, "Only public HTTPS websites are allowed"),
  target: z.enum(["apk", "aab"]).default("apk"),
  buildType: z.enum(["debug", "release"]).default("debug")
});
app.post("/api/builds", async (request, reply) => {
  const parsed = BuildRequest.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid build request", details: parsed.error.flatten() });
  const id = randomUUID();
  await queue.add("build", { ...parsed.data, id, createdAt: new Date().toISOString() }, { jobId: id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
  return reply.code(202).send({ id, status: "queued", statusUrl: `/api/builds/${id}`, message: "Build queued" });
});
app.get("/api/builds/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: "Invalid build ID" });
  const job = await queue.getJob(id);
  if (!job) return reply.code(404).send({ error: "Build not found or expired" });
  const state = await job.getState();
  const result = job.returnvalue as any;
  return { id, status: state, progress: job.progress, ...(result?.artifact ? { artifact: result.artifact } : {}), ...(job.failedReason ? { error: job.failedReason.slice(0, 500) } : {}) };
});
const port = Number(process.env.PORT ?? 8787);
await app.listen({ host: "0.0.0.0", port });
