import type { SummaryCandidate } from '@shopsphere/types';
import { summarizeCandidate } from './review.jobs';
import { ClaudeSummarizer, OfflineSummarizer, summarizerFromEnv } from './summarizer';

const reviews = [
  { rating: 5, title: 'Great battery', body: 'Battery lasts two days, sound is crisp.' },
  { rating: 4, title: 'Good value', body: 'Worth the price. Battery is fine.' },
  { rating: 1, title: 'Poor build', body: 'Build quality is flimsy and the sound crackles.' },
  { rating: 2, title: 'Meh', body: 'Flimsy hinge, battery ok.' },
];

describe('review summarizer', () => {
  it('uses the offline fallback without ANTHROPIC_API_KEY', () => {
    expect(summarizerFromEnv({})).toBeInstanceOf(OfflineSummarizer);
    expect(summarizerFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toBeInstanceOf(
      ClaudeSummarizer,
    );
  });

  it('builds deterministic keyword themes offline', async () => {
    const s = new OfflineSummarizer();
    const a = await s.summarize({ productTitle: 'Buds', reviews });
    const b = await s.summarize({ productTitle: 'Buds', reviews: [...reviews] });
    expect(a).toEqual(b);
    expect(a.source).toBe('offline');
    expect(a.model).toBeNull();
    expect(a.themes[0]).toEqual({ label: 'Battery life', sentiment: 'positive', mentions: 3 });
    expect(a.themes).toContainEqual({ label: 'Build quality', sentiment: 'negative', mentions: 2 });
    expect(a.themes).toContainEqual({
      label: 'Value for money',
      sentiment: 'positive',
      mentions: 1,
    });
    expect(a.summary).toMatch(/^Based on 4 reviews, buyers have mixed views on this product\./);
    expect(a.summary).toMatch(/complaints are about the build quality/);
  });

  it('handles reviews with no theme words', async () => {
    const out = await new OfflineSummarizer().summarize({
      productTitle: 'X',
      reviews: [{ rating: 5, title: 'Nice', body: 'Loved it.' }],
    });
    expect(out).toMatchObject({
      themes: [],
      summary: 'Based on 1 review, buyers are mostly happy with this product.',
    });
  });

  it('falls back to offline when the configured summarizer fails', async () => {
    const failing = { summarize: jest.fn().mockRejectedValue(new Error('529 overloaded')) };
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const c: SummaryCandidate = { productId: 'p1', productTitle: 'Buds', reviews, reviewCount: 9 };
    const write = await summarizeCandidate(failing, c);
    log.mockRestore();
    expect(failing.summarize).toHaveBeenCalledTimes(1);
    expect(write).toMatchObject({ source: 'offline', model: null, reviewCount: 9 });
  });

  it('parses Claude structured output and clamps mentions', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: ' Buyers like the battery. ',
            themes: [{ label: 'Battery', sentiment: 'positive', mentions: 99 }],
          }),
        },
      ],
    });
    const client = { messages: { create } } as unknown as ConstructorParameters<
      typeof ClaudeSummarizer
    >[0];
    const out = await new ClaudeSummarizer(client).summarize({ productTitle: 'Buds', reviews });
    expect(out).toEqual({
      summary: 'Buyers like the battery.',
      themes: [{ label: 'Battery', sentiment: 'positive', mentions: 4 }],
      source: 'claude',
      model: 'claude-haiku-5-5',
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { format: { type: 'json_schema' } },
    });
  });

  it('raises on refusals so the job falls back', async () => {
    const client = {
      messages: {
        create: jest.fn().mockResolvedValue({ stop_reason: 'refusal', content: [] }),
      },
    } as unknown as ConstructorParameters<typeof ClaudeSummarizer>[0];
    await expect(
      new ClaudeSummarizer(client).summarize({ productTitle: 'Buds', reviews }),
    ).rejects.toThrow(/refusal/);
  });
});
