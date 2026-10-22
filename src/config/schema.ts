import { z } from 'zod';
const selector = z.string().min(1).max(400);
const host = z.string().regex(/^[a-z\d.-]+$/i);
const step = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string().min(1).max(2048) }),
  z.object({ type: z.literal('click'), selector }),
  z.object({ type: z.literal('fill'), selector, env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
  z.object({ type: z.literal('expectVisible'), selector }),
  z.object({ type: z.literal('expectText'), selector, text: z.string().max(2000) }),
  z.object({ type: z.literal('expectURL'), pattern: z.string().min(1).max(500) })
]);
export const configSchema = z.object({
  version: z.literal(1),
  projectRoot: z.string().min(1).default('.'),
  baseUrl: z.string().url(),
  allowedHosts: z.array(host).min(1).max(20),
  flows: z.array(z.object({ id: z.string().regex(/^[\w-]{1,80}$/), steps: z.array(step).min(1).max(30) })).min(1).max(50),
  artifactsDir: z.string().default('.flywheel/artifacts'),
  models: z.object({ fast: z.string().default('claude-sonnet-5-5'), strong: z.string().default('claude-opus-5-5') }).default({}),
  limits: z.object({
    flowTimeoutMs: z.number().int().min(1000).max(120000).default(30000),
    workflowTimeoutMs: z.number().int().min(5000).max(600000).default(180000),
    maxAgentCalls: z.number().int().min(1).max(12).default(6),
    maxPatchAttempts: z.number().int().min(0).max(3).default(2),
    maxFilesChanged: z.number().int().min(1).max(6).default(3),
    maxBytesPerFile: z.number().int().min(1000).max(50000).default(25000)
  }).default({}),
  patch: z.object({
    mode: z.enum(['disabled', 'dry-run', 'draft-pr']).default('dry-run'),
    allowPaths: z.array(z.string().regex(/^[a-zA-Z0-9_./-]+\/$/)).min(1).default(['src/']),
    confidenceThreshold: z.number().min(0).max(1).default(0.7)
  }).default({}),
  sandbox: z.object({
    image: z.string().min(1).max(200).default('node:22-bookworm-slim'),
    commands: z.array(z.array(z.string().min(1).max(400)).min(1).max(15)).min(1).max(6).default([['npm', 'run', 'test:unit']]),
    timeoutMs: z.number().int().min(1000).max(180000).default(60000)
  }).default({}),
  github: z.object({ owner: z.string().regex(/^[\w-]+$/), repo: z.string().regex(/^[\w.-]+$/), base: z.string().regex(/^[\w./-]+$/).default('main') }).optional()
});
export type FlywheelConfig = z.infer<typeof configSchema>;
export type Flow = FlywheelConfig['flows'][number];
