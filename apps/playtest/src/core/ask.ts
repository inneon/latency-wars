import { z } from 'zod';
import type { Agent, JsonSchema } from '../types/agent';

/** How many times a malformed reply is sent back to be fixed before the run fails. */
export const MAX_CORRECTIONS = 2;

export interface AskOptions<T> {
  /** Game-state checks on a well-formed reply. Returns the problems; empty means it passes. */
  check?: (value: T) => string[];
  /** Called with the problems each time a reply is sent back to be fixed. */
  onCorrection?: (problems: string) => void;
}

/**
 * Asks an agent for a reply matching `schema`, and validates it: first its
 * format, then `check`. A reply that fails either goes back to the same agent
 * with the problems, in the same conversation.
 */
export async function askFor<S extends z.ZodType>(
  agent: Agent,
  label: string,
  prompt: string,
  schema: S,
  { check, onCorrection }: AskOptions<z.infer<S>> = {},
): Promise<z.infer<S>> {
  const jsonSchema = z.toJSONSchema(schema) as JsonSchema;
  const validate = (reply: string): { ok: true; value: z.infer<S> } | { ok: false; error: string; prompt: string } => {
    const parsed = parseReply(reply, schema);
    if (!parsed.ok) return { ...parsed, prompt: correctionPrompt(parsed.error) };
    const problems = check?.(parsed.value) ?? [];
    if (problems.length === 0) return parsed;
    const error = problems.map((p) => `- ${p}`).join('\n');
    return { ok: false, error, prompt: checkCorrectionPrompt(error) };
  };

  let result = validate(await agent.send(label, prompt, jsonSchema));
  for (let attempt = 1; !result.ok && attempt <= MAX_CORRECTIONS; attempt++) {
    onCorrection?.(result.error);
    result = validate(await agent.send(`${label} (correction ${attempt})`, result.prompt, jsonSchema));
  }
  if (!result.ok) throw new Error(`${agent.id} (${label}): reply still failed after ${MAX_CORRECTIONS} corrections:\n${result.error}`);
  return result.value;
}

export type ParsedReply<T> = { ok: true; value: T } | { ok: false; error: string };

/** Reads a ```json block, or a bare object, out of a text reply and validates it. */
export function parseReply<S extends z.ZodType>(reply: string, schema: S): ParsedReply<z.infer<S>> {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/.exec(reply)?.[1];
  const text = fenced ?? reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  if (!text) return { ok: false, error: 'The reply contained no JSON object.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `The JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = schema.safeParse(data);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: z.prettifyError(result.error) };
}

export const correctionPrompt = (error: string) =>
  `Your last reply didn't match the required format:

${error}

Send the whole reply again as a single valid JSON object in a \`\`\`json code block. Keep the content the same; only fix the format.`;

export const checkCorrectionPrompt = (problems: string) =>
  `Your last reply breaks these checks against the game state:

${problems}

Fix them, and anything that depends on them, then send the whole reply again in the same format.`;
