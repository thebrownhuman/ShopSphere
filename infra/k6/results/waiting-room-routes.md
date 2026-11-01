| route | requests | p95 ms | p99 ms |
|---|---:|---:|---:|
| `/checkout` | 4745 | 89 | 248 |
| `/orders/:id/status` | 2259 | 22 | 34 |
| `/cart/items` | 927 | 109 | 230 |
| `/products/:slug` | 925 | 23 | 121 |
| `/categories` | 925 | 10 | 68 |
| `/search` | 919 | 40 | 153 |
| `/home` | 916 | 25 | 208 |
| `/checkout/:id` | 888 | 98 | 226 |
| `/checkout/:id/place-order` | 888 | 165 | 264 |
| `/payments/:orderId/initiate` | 888 | 61 | 212 |
| `/payments/:orderId/verify` | 883 | 73 | 175 |
| `/payments/webhooks/:provider` | 883 | 93 | 199 |
