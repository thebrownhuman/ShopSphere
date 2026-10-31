/**
 * Generated placeholder artwork for the mock catalog (plan M2.24: no scraped product photos).
 * `/img/<hue>/<label>?w=600&h=600` -> a small SVG with a gradient and the label.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ hue: string; label: string }> },
) {
  const { hue: rawHue, label: rawLabel } = await params;
  const url = new URL(req.url);
  const w = clamp(Number(url.searchParams.get('w')) || 600, 16, 2000);
  const h = clamp(Number(url.searchParams.get('h')) || 600, 16, 2000);
  const hue = clamp(Number(rawHue) || 0, 0, 359);
  const label = escape(safeDecode(rawLabel).slice(0, 60));
  const wide = w / h > 2;
  const font = Math.round(Math.min(w, h) * (wide ? 0.14 : 0.075));
  const lines = wide ? [label] : wrap(label, 18).slice(0, 3);
  const text = lines
    .map(
      (l, i) =>
        `<tspan x="${wide ? Math.round(w * 0.06) : w / 2}" dy="${i === 0 ? 0 : font * 1.25}">${l}</tspan>`,
    )
    .join('');
  const y = wide ? h / 2 : h * 0.78 - (lines.length - 1) * font * 0.6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% ${wide ? 40 : 92}%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 65% ${wide ? 28 : 82}%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
${wide ? '' : `<circle cx="${w / 2}" cy="${h * 0.4}" r="${Math.min(w, h) * 0.22}" fill="hsl(${hue} 55% 55%)" opacity=".85"/>`}
<text y="${y}" font-family="system-ui,sans-serif" font-size="${font}" font-weight="700" fill="${wide ? '#fff' : `hsl(${hue} 60% 20%)`}" text-anchor="${wide ? 'start' : 'middle'}" dominant-baseline="middle">${text}</text>
</svg>`;
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/** Next usually hands over a decoded segment already; a literal "%" must not throw. */
function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    if ((line + ' ' + word).trim().length > max && line) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}
