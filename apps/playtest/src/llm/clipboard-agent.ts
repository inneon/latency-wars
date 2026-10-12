import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import type { Agent, AgentDocument, JsonSchema, SystemPrompt } from '../types/agent';
import { withFormatReference, withJsonInstructions } from './json-instructions';

/** Platform clipboard commands, in order of preference. */
const CLIPBOARDS: { copy: [string, ...string[]]; paste: [string, ...string[]] }[] = [
  { copy: ['pbcopy'], paste: ['pbpaste'] },
  { copy: ['wl-copy'], paste: ['wl-paste', '--no-newline'] },
  { copy: ['xclip', '-selection', 'clipboard'], paste: ['xclip', '-selection', 'clipboard', '-o'] },
];

type Clipboard = { copy(text: string): void; paste(): string };

function findClipboard(): Clipboard | null {
  for (const { copy: [copyCmd, ...copyArgs], paste: [pasteCmd, ...pasteArgs] } of CLIPBOARDS) {
    try {
      execFileSync('which', [copyCmd], { stdio: 'ignore' });
      return {
        copy: (text) => execFileSync(copyCmd, copyArgs, { input: text }),
        paste: () => execFileSync(pasteCmd, pasteArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
      };
    } catch {
      // Not installed; try the next one.
    }
  }
  return null;
}

/** Carries one message to a chat and brings back its reply. */
export interface Relay {
  /** `attachments` is set on the first message to a chat: the files to upload with it. */
  exchange(chat: string, message: string, attachments?: AgentDocument[]): Promise<string>;
}

/**
 * The terminal side of a copy-paste session. Every chat goes through one relay,
 * which queues exchanges so you only ever handle one at a time.
 */
export class ClipboardRelay implements Relay {
  private readonly rl: Interface = createInterface({ input: process.stdin, output: process.stdout });
  private readonly clipboard = findClipboard();
  private queue: Promise<unknown> = Promise.resolve();
  private count = 0;

  /** `pasteLimit` is the most characters the chat app accepts in one message. */
  constructor(
    private readonly dir: string,
    private readonly pasteLimit?: number,
  ) {
    mkdirSync(dir, { recursive: true });
    console.log(`
Copy-paste mode. Open one chat per participant, and name each one so you can tell them apart.
Use a fresh chat with memory off (for example an incognito chat) for each, so no chat can see
another's information. ${this.clipboard ? 'Prompts are copied to your clipboard for you.' : 'No clipboard tool found: open each saved prompt file and copy it yourself.'}
Every prompt and reply is saved in ${dir}.
`);
  }

  exchange(chat: string, message: string, attachments?: AgentDocument[]): Promise<string> {
    const next = this.queue.then(() => this.run(chat, message, attachments));
    this.queue = next.catch(() => undefined);
    return next;
  }

  close(): void {
    this.rl.close();
  }

  private async run(chat: string, message: string, attachments?: AgentDocument[]): Promise<string> {
    const n = String(++this.count).padStart(3, '0');
    const slug = chat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeFileSync(path.join(this.dir, `${n}-${slug}-prompt.md`), message);

    console.log(`\n━━━ Exchange ${n} → ${chat.toUpperCase()} chat`);
    if (attachments) {
      const folder = path.join(this.dir, 'attachments', slug);
      mkdirSync(folder, { recursive: true });
      for (const doc of attachments) writeFileSync(path.join(folder, doc.name), doc.content);
      console.log(`Start a NEW chat named "${chat}", and attach these files from ${folder}:`);
      for (const doc of attachments) console.log(`  ${doc.name}`);
    }

    const parts = splitMessage(message, this.pasteLimit);
    for (const [i, part] of parts.entries()) {
      const label = parts.length > 1 ? `Part ${i + 1} of ${parts.length}` : 'The prompt';
      const last = i === parts.length - 1;
      if (this.clipboard) {
        this.clipboard.copy(part);
        console.log(`${label} is on your clipboard. Paste it into the ${chat} chat${attachments && i === 0 ? ' with the files' : ''}.`);
      } else {
        const file = path.join(this.dir, `${n}-${slug}-part-${i + 1}.md`);
        writeFileSync(file, part);
        console.log(`Copy ${label.toLowerCase()} from ${file} into the ${chat} chat.`);
      }
      if (!last) await this.rl.question('[Enter once it is sent. No need to copy its reply.] ');
    }

    const reply = await this.readReply(parts.at(-1) ?? message);
    writeFileSync(path.join(this.dir, `${n}-${slug}-reply.md`), reply);
    return reply;
  }

  private async readReply(prompt: string): Promise<string> {
    if (!this.clipboard) {
      console.log('When the reply is complete, paste all of it below, then type a line containing only "." to finish.');
      const lines: string[] = [];
      for (;;) {
        const line = await this.rl.question('');
        if (line.trim() === '.') return lines.join('\n');
        lines.push(line);
      }
    }
    for (;;) {
      await this.rl.question('[When the reply is complete, copy all of it and press Enter] ');
      const reply = this.clipboard.paste();
      if (reply.trim() && reply !== prompt) return reply;
      console.log('The clipboard still holds the prompt, or nothing. Copy the reply, then press Enter.');
    }
  }
}

const partHeader = (i: number, n: number) =>
  i < n
    ? `[Part ${i} of ${n} of one message. Reply only "OK" and wait for the rest.]\n\n`
    : `[Part ${n} of ${n}. You now have the whole message: reply to all of it.]\n\n`;

/** Splits a message into labelled parts no longer than `limit`, breaking at paragraphs where it can. */
export function splitMessage(message: string, limit?: number): string[] {
  if (!limit || message.length <= limit) return [message];
  const budget = limit - partHeader(999, 999).length;
  if (budget < 100) throw new Error(`--paste-limit ${limit} is too small`);

  const chunks: string[] = [];
  let rest = message;
  while (rest.length > budget) {
    let cut = rest.lastIndexOf('\n\n', budget);
    if (cut < budget / 2) cut = rest.lastIndexOf('\n', budget);
    if (cut < budget / 2) cut = budget;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  chunks.push(rest);
  return chunks.map((chunk, i) => partHeader(i + 1, chunks.length) + chunk);
}

/** One participant, played by a chat window that you relay messages to and from. */
export class ClipboardAgent implements Agent {
  private started = false;
  /** Formats this chat has seen in full, by title. */
  private readonly formats = new Set<string>();

  constructor(
    readonly id: string,
    private readonly chat: string,
    private readonly system: SystemPrompt,
    private readonly relay: Relay,
  ) {}

  send(_label: string, prompt: string, responseSchema?: JsonSchema): Promise<string> {
    let message = prompt;
    if (responseSchema) {
      const title = typeof responseSchema['title'] === 'string' ? responseSchema['title'] : null;
      message =
        title && this.formats.has(title)
          ? withFormatReference(prompt, title)
          : withJsonInstructions(prompt, responseSchema);
      if (title) this.formats.add(title);
    }

    if (this.started) return this.relay.exchange(this.chat, message);
    this.started = true;
    // A chat has no system prompt: the documents go as attachments, and the first message carries the instructions.
    const { documents, instructions } = this.system;
    return this.relay.exchange(
      this.chat,
      `These are your standing instructions for this whole conversation. The attached files are your documents: ${documents
        .map((d) => d.name)
        .join(', ')}.\n\n${instructions}\n\n---\n\n${message}`,
      documents,
    );
  }
}
