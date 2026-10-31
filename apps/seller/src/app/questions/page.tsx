'use client';

import type { AnswerView, SellerQuestionPage, SellerQuestionView } from '@shopsphere/types';
import { Button, SectionCard } from '@shopsphere/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/field';
import { api, ApiCallError } from '@/lib/api';

type Tab = 'unanswered' | 'answered' | 'all';
const TABS: { value: Tab; label: string }[] = [
  { value: 'unanswered', label: 'Awaiting your answer' },
  { value: 'answered', label: 'Answered' },
  { value: 'all', label: 'All' },
];

/** Customer questions on the seller's products (M6.3). Answers show on the PDP as "Seller". */
export default function QuestionsPage() {
  const [tab, setTab] = useState<Tab>('unanswered');
  const [items, setItems] = useState<SellerQuestionView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: Tab, after?: string) => {
    try {
      const params = new URLSearchParams({
        status,
        limit: '20',
        ...(after ? { cursor: after } : {}),
      });
      const page = await api<SellerQuestionPage>(`/seller/questions?${params}`);
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Could not load questions');
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Customer questions</h1>
      {error && <Alert>{error}</Alert>}
      <div role="tablist" aria-label="Question status" className="flex gap-2 text-sm">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-full border px-3 py-1 ${tab === t.value ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <SectionCard title={TABS.find((t) => t.value === tab)!.label}>
        {items.length === 0 ? (
          <p className="text-sm text-slate-600">No questions here.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {items.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                onAnswered={() =>
                  tab === 'unanswered' && setItems((p) => p.filter((x) => x.id !== q.id))
                }
              />
            ))}
          </ul>
        )}
        {cursor && (
          <Button variant="secondary" className="mt-3" onClick={() => void load(tab, cursor)}>
            Load more
          </Button>
        )}
      </SectionCard>
    </div>
  );
}

function QuestionRow({
  question: q,
  onAnswered,
}: {
  question: SellerQuestionView;
  onAnswered: () => void;
}) {
  const [answers, setAnswers] = useState<AnswerView[]>(q.answers);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const a = await api<AnswerView>(`/seller/questions/${q.id}/answers`, {
        method: 'POST',
        json: { body: text },
      });
      setAnswers((prev) => [a, ...prev]);
      setText('');
      onAnswered();
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Could not post the answer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3 text-sm" data-testid="seller-question">
      <p className="text-xs text-slate-600">
        {q.productTitle} · asked by {q.authorName} on{' '}
        {new Date(q.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
      </p>
      <p className="mt-1 font-medium">Q: {q.body}</p>
      {answers.length > 0 && (
        <ul className="mt-1 space-y-1 text-slate-700">
          {answers.map((a) => (
            <li key={a.id}>
              A: {a.body}{' '}
              <span className="text-xs">— {a.isSeller ? 'You (seller)' : a.authorName}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void submit(e)} className="mt-2 flex max-w-2xl gap-2">
        <input
          aria-label={`Answer: ${q.body}`}
          className="w-full rounded border border-slate-300 px-2 py-1"
          placeholder={q.answeredBySeller ? 'Add another answer' : 'Write your answer'}
          minLength={2}
          maxLength={1000}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          Answer
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}
