import { z } from 'zod';
import type { Agent, JsonSchema } from '../types/agent';
import { askFor, parseReply } from './ask';

const Schema = z.object({ answer: z.number() });

describe('parseReply', () => {
  it('reads a fenced json block, ignoring text around it', () => {
    expect(parseReply('Sure!\n```json\n{"answer": 4}\n```\nHope that helps.', Schema)).toEqual({
      ok: true,
      value: { answer: 4 },
    });
  });

  it('reads a bare object', () => {
    expect(parseReply('{"answer": 4}', Schema)).toEqual({ ok: true, value: { answer: 4 } });
  });

  it('explains what is wrong', () => {
    const noJson = parseReply('I would attack.', Schema);
    const badJson = parseReply('```json\n{"answer": 4,}\n```', Schema);
    const wrongShape = parseReply('{"answer": "four"}', Schema);
    expect(noJson.ok || noJson.error).toContain('no JSON object');
    expect(badJson.ok || badJson.error).toContain('could not be parsed');
    expect(wrongShape.ok || wrongShape.error).toContain('answer');
  });
});

class CannedAgent implements Agent {
  readonly id = 'red';
  readonly sent: { label: string; prompt: string; responseSchema?: JsonSchema }[] = [];
  constructor(private readonly replies: string[]) {}
  async send(label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    this.sent.push({ label, prompt, responseSchema });
    return this.replies.shift() ?? '';
  }
}

describe('askFor', () => {
  it('sends the schema as JSON Schema and returns the validated reply', async () => {
    const agent = new CannedAgent(['{"answer": 4}']);
    expect(await askFor(agent, 'q', 'What is 2 + 2?', Schema)).toEqual({ answer: 4 });
    expect(agent.sent[0]?.responseSchema).toMatchObject({
      type: 'object',
      properties: { answer: { type: 'number' } },
    });
  });

  it('sends a malformed reply back to the same agent to be fixed', async () => {
    const agent = new CannedAgent(['Four.', '{"answer": "four"}', '{"answer": 4}']);
    expect(await askFor(agent, 'q', 'What is 2 + 2?', Schema)).toEqual({ answer: 4 });
    expect(agent.sent.map((s) => s.label)).toEqual(['q', 'q (correction 1)', 'q (correction 2)']);
    expect(agent.sent[1]?.prompt).toContain('no JSON object');
    expect(agent.sent[2]?.prompt).toContain('answer');
  });

  it('gives up after the allowed corrections', async () => {
    const agent = new CannedAgent(['Four.', 'Four!', 'FOUR.']);
    await expect(askFor(agent, 'q', 'What is 2 + 2?', Schema)).rejects.toThrow("red (q): reply didn't match the schema");
    expect(agent.sent).toHaveLength(3);
  });
});
