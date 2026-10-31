/**
 * Reviews, review summary and customer Q&A DTOs (M6.2–M6.4). API contract shared by apps/api,
 * apps/web, apps/seller, apps/admin and apps/workers. Dates are ISO 8601 UTC strings.
 *
 * Public:
 *   GET  /products/:productId/reviews?stars&verified&withImages&sort&cursor&limit → ReviewPage
 *   GET  /products/:productId/reviews/stats            → ReviewStats (histogram + AI summary)
 *   GET  /products/:productId/questions?q&cursor&limit → QuestionPage
 * Signed in (`Authorization: Bearer`):
 *   GET  /products/:productId/reviews/eligibility       → ReviewEligibility
 *   POST /reviews/media           ReviewMediaUploadRequest → ReviewMediaUploadResponse
 *   POST /products/:productId/reviews  ReviewCreateRequest → ReviewView (verified buyers only)
 *   PUT  /reviews/:id/vote                               → ReviewVoteResponse (idempotent)
 *   DELETE /reviews/:id/vote                             → ReviewVoteResponse (idempotent)
 *   POST /reviews/:id/report      ReviewReportRequest    → { reported: true } (idempotent)
 *   POST /products/:productId/questions QuestionCreateRequest → QuestionView
 *   POST /questions/:id/answers   AnswerCreateRequest    → AnswerView (customer answer)
 * Seller (approved seller account, answers for products it has offers on):
 *   GET  /seller/questions?status=unanswered|answered|all&cursor → SellerQuestionPage
 *   POST /seller/questions/:id/answers AnswerCreateRequest → AnswerView (isSeller = true)
 * Admin moderation (`x-internal-token` = CATALOG_INTERNAL_TOKEN until admin RBAC wraps it):
 *   GET  /admin/reviews?status=PENDING|PUBLISHED|REJECTED&reported&cursor&limit → AdminReviewPage
 *   GET  /admin/reviews/:id                              → AdminReviewView
 *   POST /admin/reviews/:id/moderate ReviewModerationRequest → AdminReviewView
 * Workers (`x-internal-token`):
 *   POST /reviews/internal/refresh-aggregates            → AggregateRunSummary
 *   GET  /reviews/internal/summary-candidates?limit      → SummaryCandidate[]
 *   PUT  /reviews/internal/summaries/:productId  ReviewSummaryWrite → { saved: true }
 *
 * Error codes: REVIEW_NOT_ELIGIBLE (not a verified buyer), REVIEW_EXISTS, REVIEW_NOT_FOUND,
 * QUESTION_NOT_FOUND, PRODUCT_NOT_FOUND, UPLOAD_INVALID, SELLER_NOT_APPROVED, NOT_YOUR_PRODUCT,
 * VALIDATION_FAILED.
 */

export type ReviewStatus = 'PUBLISHED' | 'PENDING' | 'REJECTED';
export type ReviewSort = 'helpful' | 'recent' | 'rating_desc' | 'rating_asc';
export type ReportReason = 'SPAM' | 'OFFENSIVE' | 'IRRELEVANT' | 'FAKE' | 'OTHER';

export interface ReviewImageView {
  id: string;
  url: string;
}

export interface ReviewView {
  id: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  /** Always true today: only verified buyers can review. Kept for filters/badges. */
  verifiedBuyer: boolean;
  helpfulCount: number;
  images: ReviewImageView[];
  createdAt: string;
  status: ReviewStatus;
}

export interface ReviewPage {
  items: ReviewView[];
  nextCursor: string | null;
  /** Count matching the filters. */
  total: number;
}

export type ThemeSentiment = 'positive' | 'negative' | 'mixed';

export interface ReviewTheme {
  label: string;
  sentiment: ThemeSentiment;
  mentions: number;
}

export interface ReviewSummaryView {
  summary: string;
  themes: ReviewTheme[];
  source: 'claude' | 'offline';
  reviewCount: number;
  generatedAt: string;
}

export interface ReviewStats {
  productId: string;
  /** Average stars, one decimal (4.3). 0 when there are no reviews. */
  rating: number;
  ratingCount: number;
  /** Published reviews per star: index 0 = 1 star … index 4 = 5 stars. */
  histogram: [number, number, number, number, number];
  withImages: number;
  summary: ReviewSummaryView | null;
}

export interface ReviewEligibility {
  eligible: boolean;
  /** NOT_DELIVERED: no delivered order with this product. ALREADY_REVIEWED: see `reviewId`. */
  reason: 'NOT_SIGNED_IN' | 'NOT_DELIVERED' | 'ALREADY_REVIEWED' | null;
  reviewId: string | null;
  /** Review ids this user marked helpful on the product. */
  votedReviewIds: string[];
}

export interface ReviewMediaUploadRequest {
  fileName: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataBase64: string;
}

export interface ReviewMediaUploadResponse {
  id: string;
  url: string;
}

export interface ReviewCreateRequest {
  rating: number;
  title: string;
  body: string;
  /** Ids from POST /reviews/media, max 5. */
  imageIds?: string[];
}

export interface ReviewVoteResponse {
  reviewId: string;
  helpfulCount: number;
  voted: boolean;
}

export interface ReviewReportRequest {
  reason: ReportReason;
  note?: string;
}

// ───────── Moderation (admin) ─────────

export interface AdminReviewView extends ReviewView {
  userId: string;
  orderId: string;
  productTitle: string;
  productSlug: string;
  reportCount: number;
  moderationNote: string | null;
  reports: { reason: ReportReason; note: string | null; createdAt: string }[];
  moderatedAt: string | null;
}

export interface AdminReviewPage {
  items: AdminReviewView[];
  nextCursor: string | null;
}

export interface ReviewModerationRequest {
  action: 'approve' | 'reject';
  note?: string;
}

// ───────── Workers ─────────

export interface AggregateRunSummary {
  products: number;
  indexed: number;
}

export interface SummaryCandidate {
  productId: string;
  productTitle: string;
  reviews: { rating: number; title: string; body: string }[];
  reviewCount: number;
}

export interface ReviewSummaryWrite {
  summary: string;
  themes: ReviewTheme[];
  source: 'claude' | 'offline';
  model: string | null;
  reviewCount: number;
}

// ───────── Q&A ─────────

export interface AnswerView {
  id: string;
  body: string;
  authorName: string;
  isSeller: boolean;
  verifiedBuyer: boolean;
  createdAt: string;
}

export interface QuestionView {
  id: string;
  productId: string;
  body: string;
  authorName: string;
  answerCount: number;
  answers: AnswerView[];
  createdAt: string;
}

export interface QuestionPage {
  items: QuestionView[];
  nextCursor: string | null;
  total: number;
}

export interface QuestionCreateRequest {
  body: string;
}

export interface AnswerCreateRequest {
  body: string;
}

export interface SellerQuestionView extends QuestionView {
  productTitle: string;
  productSlug: string;
  answeredBySeller: boolean;
}

export interface SellerQuestionPage {
  items: SellerQuestionView[];
  nextCursor: string | null;
}
