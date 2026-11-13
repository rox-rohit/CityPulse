import { useCallback, useEffect, useState } from "react";
import { api, type AnalystAnswer } from "../lib/api";

const DEFAULT_QUESTIONS = [
  "How many potholes have been reported?",
  "What is the total road length in the AOI?",
  "What are the latest PM2.5 values?",
  "What was the temperature range this week?",
  "How much green space is mapped?",
  "Which datasets exist and what are their limitations?",
];

type Turn = { question: string; answer?: AnalystAnswer; error?: string };

const AIAnalyst = () => {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [examples, setExamples] = useState<string[]>(DEFAULT_QUESTIONS);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .analystCapabilities(controller.signal)
      .then((caps) => {
        if (caps.examples?.length) setExamples(caps.examples);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length < 3 || pending) return;
      setPending(true);
      setQuestion("");
      setTurns((current) => [...current, { question: trimmed }]);
      try {
        const answer = await api.askAnalyst(trimmed);
        setTurns((current) =>
          current.map((turn, index) =>
            index === current.length - 1 ? { ...turn, answer } : turn,
          ),
        );
      } catch (error) {
        setTurns((current) =>
          current.map((turn, index) =>
            index === current.length - 1
              ? {
                  ...turn,
                  error:
                    error instanceof Error
                      ? error.message
                      : "The analyst could not complete that query.",
                }
              : turn,
          ),
        );
      } finally {
        setPending(false);
      }
    },
    [pending],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-accent-cyan/80 mb-1">Analysis</p>
          <h1 className="text-2xl md:text-3xl font-semibold">AI Analyst</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Answers are computed by backend queries over the ingested datasets — OpenStreetMap
            geometry, modelled CAMS air quality, modelled ERA5 temperature and citizen-submitted
            civic reports. Every answer names its dataset, states whether values are modelled or
            reported, and lists what it cannot know. Questions outside those datasets are refused
            rather than guessed.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 mb-6">
          {examples.slice(0, 6).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void ask(example)}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-primary disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>

        <form
          className="flex gap-2 mb-8"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about civic issues, road network, air quality, temperature or green cover…"
            className="flex-1 rounded-lg bg-secondary border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            aria-label="Question"
          />
          <button
            type="submit"
            disabled={pending || question.trim().length < 3}
            className="px-4 py-2 rounded-lg bg-primary text-background text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Querying…" : "Ask"}
          </button>
        </form>

        <div className="space-y-4">
          {turns.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No questions yet. The analyst will not answer from anything other than the database.
            </p>
          )}
          {turns.map((turn, index) => (
            <div key={`${turn.question}-${index}`} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-medium">{turn.question}</p>

              {!turn.answer && !turn.error && (
                <p className="mt-2 text-xs text-muted-foreground">Querying the database…</p>
              )}

              {turn.error && (
                <p className="mt-2 text-xs text-red-400">{turn.error}</p>
              )}

              {turn.answer && (
                <>
                  <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                    {turn.answer.answer}
                  </p>

                  {turn.answer.intent === null && (
                    <p className="mt-2 inline-block text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      refused — no matching dataset
                    </p>
                  )}

                  {turn.answer.facts.length > 0 && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {turn.answer.facts.map((fact) => (
                        <div key={fact.label} className="flex justify-between gap-2 border-b border-border/60 py-1">
                          <dt className="text-muted-foreground">{fact.label}</dt>
                          <dd className="text-foreground text-right">{fact.value ?? "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {turn.answer.sources.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Sources</p>
                      <ul className="space-y-1 text-xs">
                        {turn.answer.sources.map((source) => (
                          <li key={`${source.dataset}-${source.note}`} className="flex flex-wrap gap-2">
                            <span className="text-foreground">{source.dataset}</span>
                            <span className="text-accent-violet">[{source.type}]</span>
                            <span className="text-muted-foreground">
                              {source.collected ? `collected ${source.collected}` : "no date"}
                            </span>
                            <span className="text-muted-foreground">· {source.note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {turn.answer.limitations.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        Uncertainty
                      </p>
                      <ul className="list-disc list-inside space-y-0.5 text-xs text-muted-foreground">
                        {turn.answer.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AIAnalyst;
