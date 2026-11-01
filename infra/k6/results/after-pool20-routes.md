| route | requests | p95 ms | p99 ms |
|---|---:|---:|---:|
| `/orders/:id/status` | 4539 | 7021 | 10000 |
| `/payments/webhooks/:provider` | 2484 | 7937 | 9587 |
| `/cart/items` | 1716 | 8321 | 10000 |
| `/products/:slug` | 1712 | 3522 | 5174 |
| `/categories` | 1712 | 24 | 71 |
| `/search` | 1708 | 4093 | 4837 |
| `/home` | 1703 | 6434 | 9322 |
| `/checkout` | 1696 | 8807 | 10000 |
| `/checkout/:id` | 1696 | 10000 | 10000 |
| `/checkout/:id/place-order` | 1692 | 10000 | 10000 |
| `/payments/:orderId/initiate` | 1686 | 6850 | 10000 |
| `/payments/:orderId/verify` | 1671 | 8155 | 9917 |
