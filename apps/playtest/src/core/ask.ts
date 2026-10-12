import { z } from 'zod';
import type { Agent, JsonSchema } from '../types/agent';

/** How many times a malformed reply is sent back to be fixed before the run fails. */
export const MAX_CORRECTIONS = 2;

/**
 * Asks an agent for a reply matching `schema`, and validates it. A malformed
 * reply goes back to the same agent with the errors, in the same conversation.
 */
export async function askFor<S extends z.ZodType>(
  agent: Agent,
  label: string,
  prompt: string,
  schema: S,
): Promise<z.infer<S>> {
  const jsonSchema = z.toJSONSchema(schema) as JsonSchema;
  let parsed = parseReply(await agent.send(label, prompt, jsonSchema), schema);
  for (let attempt = 1; !parsed.ok && attempt <= MAX_CORRECTIONS; attempt++) {
    parsed = parseReply(await agent.send(`${label} (correction ${attempt})`, correctionPrompt(parsed.error), jsonSchema), schema);
  }
  if (!parsed.ok) throw new Error(`${agent.id} (${label}): reply didn't match the schema:\n${parsed.error}`);
  return parsed.value;
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
