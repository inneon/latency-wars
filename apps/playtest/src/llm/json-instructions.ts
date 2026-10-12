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

/** For a conversation that has already been given the schema once. */
export const withFormatReference = (prompt: string, title: string) =>
  `${prompt}

Reply in the "${title}" format I gave you earlier: a single JSON object in a \`\`\`json code block, with nothing outside it.`;
