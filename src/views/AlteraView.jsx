import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, MessageSquarePlus, Send, ShieldCheck, Sparkles } from "lucide-react";

const STARTERS = [
  "Cosa devo controllare oggi?",
  "Quali DDT devo ancora collegare?",
  "Quali ordini risultano in ritardo?",
  "Dove la copertura dati e incompleta?"
];

function readableError(error) {
  const message = String(error?.message || "").trim();
  if (/unexpected token|not valid json|doctype|html/i.test(message)) {
    return "Altera richiede il backend OrderWatch: provala dall'ambiente pubblicato.";
  }
  return message || "Altera non e disponibile in questo momento.";
}

export default function AlteraView({ adapter, onNavigate }) {
  const [chat, setChat] = useState({ conversations: [], conversation: null, messages: [] });
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const load = useCallback(async (conversationId = null) => {
    setLoading(true);
    try {
      setChat(await adapter.getAlteraChat(conversationId));
      setError("");
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.messages, sending]);

  const messages = useMemo(() => chat.messages || [], [chat.messages]);

  async function send(text = question) {
    const value = String(text || "").trim();
    if (!value || sending) return;
    setSending(true);
    setQuestion("");
    setError("");
    setChat((current) => ({
      ...current,
      messages: [...(current.messages || []), { id: `local-${Date.now()}`, role: "user", content: value }]
    }));
    try {
      const result = await adapter.askAltera(value, chat.conversation?.id || null);
      const conversationId = result.conversation?.id;
      await load(conversationId);
    } catch (sendError) {
      setError(readableError(sendError));
      setChat((current) => ({
        ...current,
        messages: (current.messages || []).filter((message) => !String(message.id).startsWith("local-"))
      }));
    } finally {
      setSending(false);
    }
  }

  function startNewChat() {
    setChat((current) => ({ ...current, conversation: null, messages: [] }));
    setQuestion("");
    setError("");
  }

  return (
    <div className="mx-auto grid max-w-[1540px] gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden min-h-[680px] border-r pr-4 xl:block" style={{ borderColor: "var(--color-border)" }}>
        <button type="button" onClick={startNewChat} className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--color-border)" }}>
          <MessageSquarePlus className="h-4 w-4" /> Nuova conversazione
        </button>
        <div className="mt-5 text-[11px] font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>Conversazioni recenti</div>
        <div className="mt-2 space-y-1">
          {(chat.conversations || []).map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => load(conversation.id)}
              className="w-full truncate rounded-lg px-3 py-2.5 text-left text-sm"
              style={{
                backgroundColor: chat.conversation?.id === conversation.id ? "var(--color-primary-soft)" : "transparent",
                fontWeight: chat.conversation?.id === conversation.id ? 600 : 400
              }}
            >
              {conversation.title}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-lg border bg-white" style={{ borderColor: "var(--color-border)" }}>
        <header className="flex items-center justify-between border-b px-4 py-3 sm:px-5" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--color-primary)", color: "white" }}><Sparkles className="h-4 w-4" /></span>
            <div>
              <h2 className="text-base font-semibold">Altera</h2>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Assistente operativo sui dati OrderWatch</p>
            </div>
          </div>
          <div className="hidden items-center gap-1.5 text-xs sm:flex" style={{ color: "var(--color-success)" }}><ShieldCheck className="h-4 w-4" /> Solo lettura</div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {loading && !messages.length ? (
            <p className="py-16 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>Caricamento conversazione...</p>
          ) : !messages.length ? (
            <EmptyAltera onAsk={send} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message) => (
                <Message key={message.id} message={message} onNavigate={onNavigate} />
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}><Bot className="h-4 w-4" /> Altera sta verificando i dati disponibili...</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <footer className="border-t p-3 sm:p-4" style={{ borderColor: "var(--color-border)" }}>
          {error && <p role="alert" className="mb-2 text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          <form className="mx-auto flex max-w-3xl items-end gap-2" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={2}
              maxLength={1200}
              placeholder="Chiedi ad Altera cosa controllare, collegare o verificare..."
              className="min-h-[52px] flex-1 resize-none rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2"
              style={{ borderColor: "var(--color-border)", "--tw-ring-color": "var(--color-primary-soft)" }}
            />
            <button type="submit" disabled={!question.trim() || sending} className="flex h-[52px] w-[52px] items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: "var(--color-primary)" }} title="Invia domanda">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-[11px]" style={{ color: "var(--color-text-muted)" }}>Altera distingue dati osservati, incompleti e non disponibili. Le risposte non modificano il sistema.</p>
        </footer>
      </section>
    </div>
  );
}

function EmptyAltera({ onAsk }) {
  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="max-w-xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--color-primary-soft)", color: "var(--color-primary)" }}><Sparkles className="h-5 w-5" /></div>
        <h3 className="mt-4 text-2xl font-semibold">Da dove vuoi iniziare?</h3>
        <p className="mt-2 text-sm leading-6" style={{ color: "var(--color-text-muted)" }}>Altera consulta ordini, lavori, fornitori, DDT, fatture e copertura delle fonti per rispondere senza inventare ciò che manca.</p>
      </div>
      <div className="mt-7 grid gap-2 sm:grid-cols-2">
        {STARTERS.map((starter) => (
          <button key={starter} type="button" onClick={() => onAsk(starter)} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition hover:bg-[color:var(--color-muted)]" style={{ borderColor: "var(--color-border)" }}>
            {starter}<ArrowRight className="h-4 w-4 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message, onNavigate }) {
  const assistant = message.role === "assistant";
  const highlights = Array.isArray(message.highlights) ? message.highlights : [];
  const citations = Array.isArray(message.citations) ? message.citations : [];
  return (
    <article className={assistant ? "" : "ml-auto max-w-[82%] rounded-lg px-4 py-3"} style={!assistant ? { backgroundColor: "var(--color-primary)", color: "white" } : undefined}>
      {assistant && <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}><Sparkles className="h-3.5 w-3.5" /> Altera</div>}
      <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
      {assistant && highlights.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {highlights.map((item, index) => <Highlight key={`${item.label}-${index}`} item={item} />)}
        </div>
      )}
      {assistant && citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {citations.map((citation, index) => (
            <button key={`${citation.ref || citation.label}-${index}`} type="button" onClick={() => citation.target && onNavigate(citation.target.view, citation.target)} disabled={!citation.target} className="rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--color-border)" }}>
              {citation.label || citation.ref}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function Highlight({ item }) {
  const colors = {
    critical: ["#FFF1F0", "var(--color-danger)"],
    warning: ["#FFF8E8", "#9A6700"],
    success: ["#ECF8F1", "var(--color-success)"],
    info: ["var(--color-muted)", "var(--color-text)"]
  };
  const [backgroundColor, color] = colors[item.severity] || colors.info;
  return <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor, color }}><div className="text-[11px] font-semibold uppercase">{item.label}</div><div className="mt-1 text-sm font-medium">{item.value}</div></div>;
}
