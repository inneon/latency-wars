import type { RemoteRequest, SeatExchange, SeatState } from '@latency-wars/playtest-contracts';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type Schema, SchemaForm } from './schema-form';
import { fetchSeat, postReply, readSeatLink, type SeatLink, subscribe } from './seat-client';
import './play.css';

const md = (text: string) => <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;

/** The form's starting values: when a reply was sent back to be fixed, start from it. */
function initialValue(request: RemoteRequest, history: readonly SeatExchange[]): unknown {
  if (!request.label.includes('(correction')) return undefined;
  try {
    return JSON.parse(history.at(-1)?.reply ?? '');
  } catch {
    return undefined;
  }
}

function prettyReply(reply: string): string {
  try {
    return JSON.stringify(JSON.parse(reply), null, 2);
  } catch {
    return reply;
  }
}

function TextReply({ onSubmit, disabled }: { onSubmit: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(text);
  };
  return (
    <form className="schema-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="reply">Your reply</label>
        <textarea id="reply" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  );
}

function Seat({ link }: { link: SeatLink }) {
  const [state, setState] = useState<SeatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setState(await fetchSeat(link));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [link]);

  useEffect(() => {
    void refresh();
    return subscribe(link, {
      request: () => {
        setConnected(true);
        void refresh();
      },
      finished: () => setState((s) => (s ? { ...s, finished: true } : s)),
      disconnected: () => setConnected(false),
    });
  }, [link, refresh]);

  const send = async (request: RemoteRequest, reply: string) => {
    setSending(true);
    try {
      await postReply(link, { id: request.id, reply });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  if (!state) return <main className="play">{error ? <p className="play-error">{error}</p> : <p>Connecting…</p>}</main>;
  const { pending, history, system, finished } = state;

  return (
    <main className="play">
      <header>
        <h1>Latency Wars play-test: {state.name}</h1>
        <p className="play-status">
          {finished
            ? 'The play-test is over.'
            : pending
              ? 'Your move.'
              : connected
                ? 'Waiting for the others…'
                : 'Lost contact with the play-test. It may have ended; reload to check.'}
        </p>
        {error && <p className="play-error">{error}</p>}
      </header>

      <details className="play-briefing">
        <summary>Your briefing and documents</summary>
        {md(system.instructions)}
        {system.documents.map((doc) => (
          <details key={doc.name}>
            <summary>{doc.name}</summary>
            {md(doc.content)}
          </details>
        ))}
      </details>

      {history.length > 0 && (
        <section className="play-history">
          <h2>Earlier</h2>
          {history.map(({ request, reply }) => (
            <details key={request.id}>
              <summary>{request.label}</summary>
              {md(request.prompt)}
              <h3>You replied</h3>
              <pre>{prettyReply(reply)}</pre>
            </details>
          ))}
        </section>
      )}

      {pending && (
        <section className="play-current" key={pending.id}>
          <h2>{pending.label}</h2>
          <div className="play-prompt">{md(pending.prompt)}</div>
          {pending.responseSchema ? (
            <SchemaForm
              schema={pending.responseSchema as Schema}
              initial={initialValue(pending, history)}
              disabled={sending}
              onSubmit={(value) => void send(pending, JSON.stringify(value))}
            />
          ) : (
            <TextReply disabled={sending} onSubmit={(text) => void send(pending, text)} />
          )}
        </section>
      )}
    </main>
  );
}

export function PlayPage() {
  const link = useMemo(() => readSeatLink(window.location.search, window.location.origin), []);
  if (!link) {
    return (
      <main className="play">
        <p className="play-error">This page needs the seat link the play-test printed: …/play?seat=…&amp;token=…</p>
      </main>
    );
  }
  return <Seat link={link} />;
}

export default PlayPage;
