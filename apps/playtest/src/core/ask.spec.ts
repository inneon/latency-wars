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
    await expect(askFor(agent, 'q', 'What is 2 + 2?', Schema)).rejects.toThrow('red (q): reply still malformed after 2 corrections');
    expect(agent.sent).toHaveLength(3);
  });

  it('sends a well-formed reply that fails the check back with the problems', async () => {
    const agent = new CannedAgent(['{"answer": 5}', '{"answer": 4}']);
    const corrections: string[] = [];
    const value = await askFor(agent, 'q', 'What is 2 + 2?', Schema, {
      check: (v) => (v.answer === 4 ? [] : [`${v.answer} is not 2 + 2`]),
      onCorrection: (problems) => corrections.push(problems),
    });
    expect(value).toEqual({ answer: 4 });
    expect(agent.sent[1]?.prompt).toContain('- 5 is not 2 + 2');
    expect(agent.sent[1]?.prompt).toContain('checks against the game state');
    expect(corrections).toEqual(['- 5 is not 2 + 2']);
  });

  it('accepts the last well-formed reply when only the check still fails, and reports it', async () => {
    const agent = new CannedAgent(['{"answer": 5}', '{"answer": 6}', '{"answer": 7}']);
    const unresolved: string[] = [];
    const value = await askFor(agent, 'q', 'What is 2 + 2?', Schema, {
      check: (v) => (v.answer === 4 ? [] : [`${v.answer} is not 2 + 2`]),
      onUnresolved: (problems) => unresolved.push(problems),
    });
    expect(value).toEqual({ answer: 7 });
    expect(agent.sent).toHaveLength(3);
    expect(unresolved).toEqual(['- 7 is not 2 + 2']);
  });

  it('still throws when the last reply is malformed, even if earlier ones only failed the check', async () => {
    const agent = new CannedAgent(['{"answer": 5}', '{"answer": 6}', 'Four.']);
    await expect(
      askFor(agent, 'q', 'What is 2 + 2?', Schema, { check: (v) => (v.answer === 4 ? [] : ['wrong']) }),
    ).rejects.toThrow('reply still malformed');
  });
});
