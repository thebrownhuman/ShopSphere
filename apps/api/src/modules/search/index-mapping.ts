/**
 * Product index (M2.8). One document per product, priced from the default SKU's buy-box.
 *
 * Analyzers: `text_en` (index) with English stemming; `text_en_search` adds a synonym graph
 * (incl. a few Hinglish terms) at query time so synonyms change without reindexing.
 * Typo tolerance comes from query-time fuzziness. Phonetic matching would need the
 * analysis-phonetic plugin, which the stock OpenSearch image lacks; add it with the
 * production cluster.
 */
export const SYNONYMS = [
  'tv, television, smart tv',
  'mobile, phone, smartphone, cellphone',
  'laptop, notebook',
  'fridge, refrigerator',
  'ac, air conditioner',
  'headphones, headphone, headset, earphones',
  'earbuds, tws, true wireless',
  'sneakers, shoes, joote, jootey',
  'tshirt, t-shirt, tee',
  'kurta, kurti',
  'watch, ghadi',
  'sunglasses, chashma, goggles',
  'bag, thaila',
  'saree, sari',
  'speaker, speakers',
];

export const productIndexBody = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    'index.max_ngram_diff': 13,
    analysis: {
      filter: {
        en_stem: { type: 'stemmer', language: 'light_english' },
        shop_synonyms: { type: 'synonym_graph', synonyms: SYNONYMS, lenient: true },
        ac_edge: { type: 'edge_ngram', min_gram: 2, max_gram: 15 },
      },
      analyzer: {
        text_en: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'en_stem'] },
        text_en_search: {
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding', 'shop_synonyms', 'en_stem'],
        },
        plain: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
        autocomplete: { tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'ac_edge'] },
      },
    },
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      productId: { type: 'keyword' },
      skuId: { type: 'keyword' },
      slug: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'text_en',
        search_analyzer: 'text_en_search',
        fields: {
          plain: { type: 'text', analyzer: 'plain' },
          ac: { type: 'text', analyzer: 'autocomplete', search_analyzer: 'plain' },
        },
      },
      brand: {
        type: 'text',
        analyzer: 'text_en',
        search_analyzer: 'text_en_search',
        fields: { plain: { type: 'text', analyzer: 'plain' } },
      },
      brandSlug: { type: 'keyword' },
      brandKv: { type: 'keyword' },
      categoryIds: { type: 'keyword' },
      categorySlugs: { type: 'keyword' },
      categoryKv: { type: 'keyword' },
      categoryNames: { type: 'text', analyzer: 'text_en', search_analyzer: 'text_en_search' },
      attrKv: { type: 'keyword' },
      attrText: { type: 'text', analyzer: 'text_en', search_analyzer: 'text_en_search' },
      price: { type: 'long' },
      mrp: { type: 'long' },
      gstBp: { type: 'integer' },
      discount: { type: 'integer' },
      rating: { type: 'float' },
      ratingCount: { type: 'integer' },
      salesRank: { type: 'integer' },
      popularity: { type: 'float' },
      inStock: { type: 'boolean' },
      plus: { type: 'boolean' },
      sellerIds: { type: 'keyword' },
      createdAt: { type: 'date' },
      image: { type: 'object', enabled: false },
    },
  },
} as const;
