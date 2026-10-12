import type { AgentDocument, SystemPrompt } from '../types/agent';

/** For transports that take documents inline, as tagged blocks in the system prompt. */
export const renderDocuments = (docs: AgentDocument[]) =>
  docs.map((d) => `<document name="${d.name}">\n${d.content}\n</document>`).join('\n\n');

export const renderSystemPrompt = ({ documents, instructions }: SystemPrompt) =>
  `${renderDocuments(documents)}\n\n${instructions}`;
