| route | requests | p95 ms | p99 ms |
|---|---:|---:|---:|
| `/orders/:id/status` | 18299 | 142 | 243 |
| `/checkout` | 2926 | 230 | 424 |
| `/checkout/:id` | 2926 | 208 | 312 |
| `/checkout/:id/place-order` | 2926 | 454 | 842 |
| `/payments/:orderId/initiate` | 2926 | 158 | 236 |
| `/payments/:orderId/verify` | 2926 | 203 | 348 |
| `/payments/webhooks/:provider` | 2926 | 328 | 489 |
| `/cart/items` | 2926 | 315 | 468 |
| `/home` | 2926 | 100 | 223 |
| `/search` | 2926 | 95 | 218 |
| `/products/:slug` | 2926 | 47 | 93 |
| `/categories` | 2926 | 10 | 23 |
