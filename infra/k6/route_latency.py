"""Per-route request count and p95/p99 (ms) from Prometheus for the load-test API.

    python infra/k6/route_latency.py [window=6m] [instance=host.docker.internal:4310]

Run right after a k6 run; used for the tables in docs/perf/load-test.md.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

window = sys.argv[1] if len(sys.argv) > 1 else "6m"
inst = sys.argv[2] if len(sys.argv) > 2 else "host.docker.internal:4310"
prom = os.environ.get("PROMETHEUS_URL", "http://localhost:9090")


def query(q):
    url = f"{prom}/api/v1/query?" + urllib.parse.urlencode({"query": q})
    res = json.load(urllib.request.urlopen(url))["data"]["result"]
    return {r["metric"].get("route", "?"): float(r["value"][1]) for r in res}


sel = f'instance="{inst}"'
q = lambda p: query(
    f"histogram_quantile({p}, sum by (le, route) (increase(http_request_duration_seconds_bucket{{{sel}}}[{window}])))"
)
p95, p99 = q(0.95), q(0.99)
n = query(f"sum by (route) (increase(http_requests_total{{{sel}}}[{window}]))")
fmt = lambda v: "-" if v is None or v != v else f"{v * 1000:.0f}"
print("| route | requests | p95 ms | p99 ms |\n|---|---:|---:|---:|")
for r in sorted(n, key=lambda r: -n[r]):
    if n[r] >= 1:
        print(f"| `{r}` | {n[r]:.0f} | {fmt(p95.get(r))} | {fmt(p99.get(r))} |")
