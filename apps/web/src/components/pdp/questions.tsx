'use client';

import type { AnswerView, QuestionView } from '@shopsphere/types';
import { SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api';
import { getQuestions } from '@/lib/api/reviews';
import { useAuth } from '@/lib/auth';

/** PDP customer Q&A (M6.3): search, ask, answer. Seller answers come from Seller Central. */
export function QuestionsSection({ productId, slug }: { productId: string; slug: string }) {
  const { status, request } = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<QuestionView[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    getQuestions(productId, query).then(
      (p) => {
        setItems(p.items);
        setTotal(p.total);
        setCursor(p.nextCursor);
      },
      () => setItems([]),
    );
  }, [productId, query]);
  useEffect(load, [load]);

  async function more() {
    if (!cursor) return;
    const p = await getQuestions(productId, query, cursor);
    setItems((prev) => [...prev, ...p.items]);
    setCursor(p.nextCursor);
  }

  async function submitQuestion(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await request(`/products/${productId}/questions`, { method: 'POST', body: { body: ask } });
      setAsk('');
      setNotice('Your question is posted. The seller and other customers can now answer it.');
      setQuery('');
      setQ('');
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post your question');
    }
  }

  return (
    <SectionCard title="Questions and answers" headingId="questions">
      <form
        role="search"
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <input
          type="search"
          aria-label="Search questions and answers"
          placeholder="Have a question? Search for answers"
          className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="rounded border border-slate-300 px-3 text-sm">
          Search
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-600">
        {total} question{total === 1 ? '' : 's'}
        {query && ` matching “${query}”`}
      </p>
      <ul className="mt-3 space-y-4">
        {items.map((item) => (
          <QuestionItem key={item.id} question={item} canAnswer={status === 'authenticated'} />
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          className="mt-3 text-sm text-brand-dark hover:underline"
          onClick={() => void more()}
        >
          See more questions
        </button>
      )}
      <div className="mt-4 border-t border-slate-200 pt-4 text-sm">
        {status === 'authenticated' ? (
          <form onSubmit={(e) => void submitQuestion(e)} className="flex max-w-xl flex-col gap-2">
            <label htmlFor="ask-question" className="font-semibold">
              Don’t see the answer you’re looking for?
            </label>
            <textarea
              id="ask-question"
              rows={2}
              minLength={10}
              maxLength={500}
              required
              className="rounded border border-slate-300 px-2 py-1.5"
              placeholder="Ask the seller and other customers"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <button
              type="submit"
              className="self-start rounded-full bg-amber-400 px-4 py-1.5 font-medium hover:bg-amber-500"
            >
              Post question
            </button>
          </form>
        ) : (
          <Link
            href={`/signin?returnTo=${encodeURIComponent(`/p/${slug}#questions`)}`}
            className="text-brand-dark hover:underline"
          >
            Sign in to ask a question
          </Link>
        )}
      </div>
    </SectionCard>
  );
}

function QuestionItem({ question, canAnswer }: { question: QuestionView; canAnswer: boolean }) {
  const { request } = useAuth();
  const [answers, setAnswers] = useState<AnswerView[]>(question.answers);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const a = await request<AnswerView>(`/questions/${question.id}/answers`, {
        method: 'POST',
        body: { body: text },
      });
      setAnswers((prev) => [...prev, a]);
      setText('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post your answer');
    }
  }

  return (
    <li className="text-sm" data-testid="question">
      <p>
        <span className="font-bold">Q: </span>
        {question.body}
      </p>
      {answers.length === 0 ? (
        <p className="mt-1 text-slate-600">No answers yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {answers.map((a) => (
            <li key={a.id}>
              <span className="font-bold">A: </span>
              {a.body}
              <span className="ml-2 text-xs text-slate-600">
                — {a.authorName}
                {a.isSeller && (
                  <span className="ml-1 rounded bg-slate-800 px-1 text-white">Seller</span>
                )}
                {a.verifiedBuyer && <span className="ml-1 text-amber-700">Verified buyer</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canAnswer &&
        (open ? (
          <form onSubmit={(e) => void submit(e)} className="mt-2 flex max-w-xl gap-2">
            <input
              aria-label="Your answer"
              className="w-full rounded border border-slate-300 px-2 py-1"
              minLength={2}
              maxLength={1000}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="rounded border border-slate-300 px-3">
              Answer
            </button>
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
          </form>
        ) : (
          <button
            type="button"
            className="mt-1 text-xs text-brand-dark hover:underline"
            onClick={() => setOpen(true)}
          >
            Answer this question
          </button>
        ))}
    </li>
  );
}
