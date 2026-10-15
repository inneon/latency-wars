import type { JsonSchema } from '../types/agent';

// For transports with no native structured output: ask for the JSON in the prompt itself.

export const withJsonInstructions = (prompt: string, schema: JsonSchema) =>
  `${prompt}

Reply with a single JSON object, in a \`\`\`json code block, that matches this JSON Schema${
    typeof schema['title'] === 'string' ? ` (the "${schema['title']}" format)` : ''
  }. Put nothing outside the code block.

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\``;

/** For a conversation that already has the schema: earlier in the chat, or in an attached file. */
export const withFormatReference = (prompt: string, title: string, file?: string) =>
  `${prompt}

Reply in the "${title}" format ${file ? `described in ${file}` : 'I gave you earlier'}: a single JSON object in a \`\`\`json code block, with nothing outside it.`;

/** Every reply format a participant will use, as one document to attach. */
export const formatsDocument = (schemas: readonly JsonSchema[]) =>
  `# Response formats

Every reply you send is a single JSON object, in a \`\`\`json code block, with nothing outside it. Each message says which of these formats to use.

${schemas
  .map((schema) => `## ${String(schema['title'] ?? 'Reply')}\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``)
  .join('\n\n')}
`;
