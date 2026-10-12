import type { AgentDocument } from '../types/agent';
import { ClipboardAgent, type Relay, splitMessage } from './clipboard-agent';

class ScriptedRelay implements Relay {
  readonly sent: { chat: string; message: string; attachments?: AgentDocument[] }[] = [];
  async exchange(chat: string, message: string, attachments?: AgentDocument[]): Promise<string> {
    this.sent.push({ chat, message, attachments });
    return `reply ${this.sent.length}`;
  }
}

const system = {
  documents: [
    { name: 'game-mechanics.md', content: 'THE RULES', shared: true },
    { name: 'red-briefing.md', content: 'YOUR SECRETS', shared: false },
  ],
  instructions: 'YOU ARE RED',
};
const turnSchema = { title: 'PlayerTurn', type: 'object', properties: { orders: { type: 'array' } } };

describe('ClipboardAgent', () => {
  it('attaches the documents to the first message only, and puts the instructions in it', async () => {
    const relay = new ScriptedRelay();
    const agent = new ClipboardAgent('red', 'Red', system, relay);

    expect(await agent.send('turn 1', 'Turn 1 prompt')).toBe('reply 1');
    await agent.send('turn 2', 'Turn 2 prompt');

    const [first, second] = relay.sent;
    expect(first?.attachments?.map((d) => d.name)).toEqual(['game-mechanics.md', 'red-briefing.md']);
    expect(first?.message).toContain('YOU ARE RED');
    expect(first?.message).toContain('game-mechanics.md, red-briefing.md');
    expect(first?.message).toContain('Turn 1 prompt');
    expect(first?.message).not.toContain('THE RULES');
    expect(second?.attachments).toBeUndefined();
    expect(second?.message).toBe('Turn 2 prompt');
  });

  it('sends each response format in full once, then refers to it by name', async () => {
    const relay = new ScriptedRelay();
    const agent = new ClipboardAgent('red', 'Red', system, relay);

    await agent.send('turn 1', 'Turn 1 prompt', turnSchema);
    await agent.send('turn 2', 'Turn 2 prompt', turnSchema);
    await agent.send('synthesis', 'Write the report');

    expect(relay.sent[0]?.message).toContain('"orders"');
    expect(relay.sent[1]?.message).not.toContain('"orders"');
    expect(relay.sent[1]?.message).toContain('the "PlayerTurn" format I gave you earlier');
    expect(relay.sent[2]?.message).toBe('Write the report');
  });
});

describe('splitMessage', () => {
  it('leaves a message under the limit alone', () => {
    expect(splitMessage('short', 8000)).toEqual(['short']);
    expect(splitMessage('x'.repeat(20000))).toHaveLength(1);
  });

  it('splits at paragraph breaks into labelled parts within the limit', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(60)}`);
    const parts = splitMessage(paragraphs.join('\n\n'), 2000);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(2000);
    expect(parts[0]).toMatch(/^\[Part 1 of \d+ of one message\. Reply only "OK"/);
    expect(parts.at(-1)).toMatch(/You now have the whole message/);
    // Nothing lost or duplicated, and no paragraph cut in half.
    const body = parts.map((p) => p.slice(p.indexOf(']\n\n') + 3)).join('\n\n');
    expect(body).toBe(paragraphs.join('\n\n'));
  });

  it('hard-cuts text with no line breaks', () => {
    const parts = splitMessage('x'.repeat(5000), 1000);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1000);
    expect(parts.map((p) => p.slice(p.indexOf(']\n\n') + 3)).join('')).toBe('x'.repeat(5000));
  });
});
