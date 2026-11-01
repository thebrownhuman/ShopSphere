| route | requests | p95 ms | p99 ms |
|---|---:|---:|---:|
| `/orders/:id/status` | 7294 | 24 | 45 |
| `/checkout` | 2833 | 70 | 100 |
| `/checkout/:id` | 2833 | 55 | 94 |
| `/checkout/:id/place-order` | 2833 | 122 | 228 |
| `/payments/:orderId/initiate` | 2833 | 36 | 60 |
| `/cart/items` | 2829 | 90 | 200 |
| `/payments/:orderId/verify` | 2829 | 49 | 94 |
| `/payments/webhooks/:provider` | 2829 | 80 | 155 |
| `/products/:slug` | 2827 | 13 | 23 |
| `/categories` | 2827 | 10 | 10 |
| `/search` | 2822 | 42 | 69 |
| `/home` | 2815 | 24 | 43 |
