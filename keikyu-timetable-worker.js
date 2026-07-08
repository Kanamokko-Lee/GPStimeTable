// Cloudflare Worker: Keikyu timetable importer
// Fetches a norikae.keikyu.co.jp timetable page server-side (avoids browser CORS),
// and extracts departure times from the "tm=" query parameter embedded in each
// departure link (e.g. tm=510 -> 05:10). This avoids needing to decode the
// Shift_JIS Japanese text on the page at all.
//
// Deploy: paste into a new Cloudflare Worker (dashboard Quick Edit, or `wrangler deploy`).
// No environment variables or secrets needed.
//
// Usage from the app: {worker-url}?url=<url-encoded norikae.keikyu.co.jp timetable URL>

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing url param' }, 400, corsHeaders);
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return json({ error: 'invalid url' }, 400, corsHeaders);
    }

    // Only allow Keikyu's timetable domain, so this can't be abused as an open proxy.
    if (targetUrl.hostname !== 'norikae.keikyu.co.jp') {
      return json({ error: 'domain not allowed: ' + targetUrl.hostname }, 403, corsHeaders);
    }

    let res;
    try {
      res = await fetch(targetUrl.toString());
    } catch (e) {
      return json({ error: 'fetch failed: ' + e.message }, 502, corsHeaders);
    }
    if (!res.ok) {
      return json({ error: 'upstream HTTP ' + res.status }, 502, corsHeaders);
    }

    const buf = await res.arrayBuffer();
    // Page is Shift_JIS encoded. We only need the ASCII "tm=" query params embedded
    // in the departure links, so decoding is mostly a formality here, but do it
    // properly in case the surrounding markup matters for the regex boundaries.
    let text;
    try {
      text = new TextDecoder('shift_jis').decode(buf);
    } catch (e) {
      text = new TextDecoder('utf-8').decode(buf);
    }

    const times = [...text.matchAll(/[?&]tm=(\d{1,4})&/g)].map(m => {
      const raw = m[1];
      const mm = raw.slice(-2);
      const hh = (raw.slice(0, -2) || '0').padStart(2, '0');
      return `${hh}:${mm}`;
    });
    const unique = [...new Set(times)].sort();

    return json({ times: unique, count: unique.length, source: targetUrl.toString() }, 200, corsHeaders);
  },
};

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...extraHeaders, 'Content-Type': 'application/json' },
  });
}
