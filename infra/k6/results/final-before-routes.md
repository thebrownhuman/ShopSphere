| route | requests | p95 ms | p99 ms |
|---|---:|---:|---:|
| `/orders/:id/status` | 13801 | 84 | 213 |
| `/checkout` | 2714 | 284 | 469 |
| `/checkout/:id` | 2714 | 232 | 456 |
| `/checkout/:id/place-order` | 2714 | 479 | 905 |
| `/payments/:orderId/initiate` | 2714 | 136 | 236 |
| `/payments/webhooks/:provider` | 2714 | 262 | 473 |
| `/payments/:orderId/verify` | 2713 | 186 | 357 |
| `/cart/items` | 2713 | 318 | 484 |
| `/products/:slug` | 2707 | 48 | 95 |
| `/categories` | 2707 | 10 | 24 |
| `/search` | 2703 | 123 | 236 |
| `/home` | 2700 | 85 | 229 |
