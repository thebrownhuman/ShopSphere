-- seller_accounts (user_id, seller_id, status=APPROVED) is the one seller <-> user link; it already
-- holds every pair seller_users did, so the interim table is dropped without data loss.
DROP TABLE "seller_users";
