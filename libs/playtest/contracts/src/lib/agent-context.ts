/** A JSON Schema object, as sent to an agent to describe the reply it should give. */
export type JsonSchema = { [key: string]: unknown };

/** Reference material for an agent. Each backend decides how to deliver it. */
export interface AgentDocument {
  /** A file name, which the instructions use to refer to the document. */
  name: string;
  content: string;
  /** Identical for every agent in a run (the rules), so it can be cached once and shared. Listed first. */
  shared: boolean;
}

/** An agent's standing context: what to read, and how to behave. */
export interface SystemPrompt {
  documents: AgentDocument[];
  instructions: string;
}
