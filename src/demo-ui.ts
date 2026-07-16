export const DEMO_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>vinext CacheHandler on Workers Cache</title>
  <style>
    :root {
      --bg: #0d0f0e;
      --panel: #151816;
      --line: #343934;
      --text: #f2f0e9;
      --muted: #9aa19a;
      --green: #c9ff63;
      --blue: #72e6df;
      --red: #ff8066;
      --yellow: #ffc96b;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); }
    button, input, textarea { font: inherit; }
    button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    .page { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 60px; }

    header { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
    .title { display: flex; align-items: center; gap: 12px; }
    .mark { width: 18px; height: 18px; border: 2px solid var(--green); box-shadow: 5px 5px 0 #29301f; }
    h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
    .subtitle { margin: 5px 0 0; color: var(--muted); font: 11px/1.4 var(--mono); }
    .session { color: var(--muted); font: 10px/1 var(--mono); }
    .session button { margin-left: 8px; padding: 7px 9px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
    .session button:hover { color: var(--text); border-color: var(--muted); }

    .intro { max-width: 700px; padding: 46px 0 32px; }
    .intro h2 { margin: 0 0 12px; font-size: clamp(31px, 5vw, 52px); line-height: 1.02; letter-spacing: -0.045em; }
    .intro p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.65; }
    code { font-family: var(--mono); color: var(--blue); }
    .notice { display: none; margin-bottom: 20px; padding: 12px 14px; border: 1px solid var(--yellow); color: var(--yellow); font: 11px/1.55 var(--mono); }
    .notice.visible { display: block; }

    .demo { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr); border: 1px solid var(--line); background: var(--panel); }
    .code-side { min-width: 0; border-right: 1px solid var(--line); }
    .result-side { min-width: 0; }
    .section-head { min-height: 51px; display: flex; justify-content: space-between; align-items: center; padding: 0 16px; border-bottom: 1px solid var(--line); }
    .section-head strong { font-size: 12px; }
    .section-head span { color: var(--blue); font: 10px/1 var(--mono); }

    .tabs { display: flex; border-bottom: 1px solid var(--line); }
    .tab { flex: 1; border: 0; border-right: 1px solid var(--line); padding: 13px 8px; background: transparent; color: var(--muted); cursor: pointer; font: 10px/1 var(--mono); text-transform: uppercase; }
    .tab:last-child { border-right: 0; }
    .tab.active { background: var(--green); color: #11140f; font-weight: 800; }

    .controls { display: grid; grid-template-columns: 1fr 90px 1fr; border-bottom: 1px solid var(--line); }
    label { display: block; padding: 12px 14px; border-right: 1px solid var(--line); color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; }
    label:last-child { border-right: 0; }
    input, textarea { width: 100%; margin-top: 8px; padding: 0; border: 0; background: transparent; color: var(--text); font: 12px/1.5 var(--mono); }
    .value { display: none; padding: 12px 14px; border-bottom: 1px solid var(--line); color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; }
    .value.visible { display: block; }
    textarea { min-height: 90px; resize: vertical; text-transform: none; }

    .code-head { display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--line); color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; }
    .copy { border: 0; background: transparent; color: var(--muted); cursor: pointer; font: inherit; text-transform: uppercase; }
    .copy:hover { color: var(--blue); }
    pre { margin: 0; font-family: var(--mono); }
    #code { min-height: 285px; overflow: auto; padding: 18px; background: #101210; color: #dce1dc; font-size: 12px; line-height: 1.7; white-space: pre; }
    .actions { display: flex; align-items: center; gap: 8px; min-height: 66px; padding: 11px 14px; border-top: 1px solid var(--line); }
    .run { min-height: 40px; border: 0; padding: 0 17px; background: var(--green); color: #11140f; cursor: pointer; font: 800 10px/1 var(--mono); text-transform: uppercase; }
    .run:disabled { opacity: 0.55; cursor: wait; }
    .modes { display: none; gap: 6px; }
    .modes.visible { display: flex; }
    .mode { min-height: 40px; border: 1px solid var(--line); padding: 0 10px; background: transparent; color: var(--muted); cursor: pointer; font: 9px/1 var(--mono); text-transform: uppercase; }
    .mode.active { color: var(--blue); border-color: var(--blue); }
    .error { margin-left: auto; color: var(--red); font: 10px/1.4 var(--mono); text-align: right; }

    .status { padding: 23px 18px; border-bottom: 1px solid var(--line); }
    .status-label { color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; }
    .status h3 { margin: 9px 0 7px; font-size: 29px; letter-spacing: -0.03em; }
    .status h3.hit { color: var(--green); }
    .status h3.miss { color: var(--red); }
    .status h3.running { color: var(--blue); }
    .status p { min-height: 20px; margin: 0; color: var(--muted); font: 11px/1.5 var(--mono); }
    .path { padding: 15px 18px; border-bottom: 1px solid var(--line); color: var(--text); font: 11px/1.6 var(--mono); }
    .facts { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--line); }
    .fact { min-height: 72px; padding: 13px 15px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .fact:nth-child(2n) { border-right: 0; }
    .fact:nth-child(n+3) { border-bottom: 0; }
    .fact small { display: block; color: var(--muted); font: 8px/1 var(--mono); text-transform: uppercase; }
    .fact output { display: block; margin-top: 10px; overflow: hidden; text-overflow: ellipsis; color: var(--text); font: 11px/1.3 var(--mono); white-space: nowrap; }
    .output-title { padding: 11px 15px; border-bottom: 1px solid var(--line); color: var(--muted); font: 9px/1 var(--mono); text-transform: uppercase; }
    #output { min-height: 133px; max-height: 230px; overflow: auto; padding: 14px 16px; background: #101210; color: #dce1dc; font-size: 10px; line-height: 1.55; white-space: pre-wrap; }
    .details { padding: 13px 15px; }
    details { border: 1px solid var(--line); border-bottom: 0; }
    details:last-child { border-bottom: 1px solid var(--line); }
    summary { display: flex; justify-content: space-between; gap: 12px; padding: 10px; cursor: pointer; color: var(--muted); font: 9px/1.4 var(--mono); list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary span:last-child { color: var(--blue); }
    details pre { overflow: auto; max-height: 220px; padding: 11px; border-top: 1px solid var(--line); background: #101210; color: var(--muted); font-size: 9px; line-height: 1.5; }
    .empty { color: var(--muted); font: 10px/1.5 var(--mono); }

    footer { padding-top: 18px; color: var(--muted); font: 10px/1.5 var(--mono); }
    @media (max-width: 850px) {
      .demo { grid-template-columns: 1fr; }
      .code-side { border-right: 0; border-bottom: 1px solid var(--line); }
    }
    @media (max-width: 560px) {
      .page { width: min(100% - 20px, 1120px); padding-top: 18px; }
      header { align-items: flex-start; }
      .subtitle { display: none; }
      .intro { padding-top: 34px; }
      .controls { grid-template-columns: 1fr 80px; }
      .controls label:last-child { grid-column: 1 / -1; border-top: 1px solid var(--line); }
      .actions { flex-wrap: wrap; }
      .error { width: 100%; text-align: left; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="title"><span class="mark" aria-hidden="true"></span><div><h1>vinext CacheHandler on Workers Cache</h1><p class="subtitle">Full cache values, binary frames, TTL, and tag invalidation</p></div></div>
      <div class="session">session <span id="session">--------</span><button id="reset" type="button">new</button></div>
    </header>

    <section class="intro">
      <h2>Run the API. See what the cache did.</h2>
      <p>The App Worker always runs. On a cache hit, Cloudflare returns the stored vinext record without executing <code>VinextDataCache</code>.</p>
    </section>

    <div class="notice" id="notice">Cache signals are unavailable in local development. This is not a cache miss. Deploy the Worker to exercise the real edge cache.</div>

    <main class="demo">
      <section class="code-side">
        <div class="section-head"><strong>Code</strong><span>src/index.ts</span></div>
        <nav class="tabs" aria-label="Examples">
          <button class="tab active" data-tab="read-through" type="button">Read-through</button>
          <button class="tab" data-tab="overwrite" type="button">Overwrite</button>
          <button class="tab" data-tab="invalidate" type="button">Invalidate</button>
        </nav>
        <div class="controls">
          <label>Key<input id="key" value="blog" maxlength="512"></label>
          <label>TTL<input id="ttl" type="number" value="60" min="1"></label>
          <label>Tags<input id="tags" value="blog,posts"></label>
        </div>
        <label class="value" id="value-wrap">JSON value<textarea id="value" spellcheck="false">{
  "message": "written from the demo",
  "revision": 1
}</textarea></label>
        <div class="code-head"><span>Executable example</span><button class="copy" id="copy" type="button">copy</button></div>
        <pre id="code"></pre>
        <div class="actions">
          <button class="run" id="run" type="button">Run read-through</button>
          <div class="modes" id="modes">
            <button class="mode active" data-mode="delete" type="button">Delete key</button>
            <button class="mode" data-mode="expire-tag" type="button">Expire tags</button>
          </div>
          <span class="error" id="error" role="alert"></span>
        </div>
      </section>

      <section class="result-side" aria-live="polite">
        <div class="section-head"><strong>Result</strong><span id="colo">—</span></div>
        <div class="status"><span class="status-label">Cache read</span><h3 id="status">Ready</h3><p id="hint">Run an example to inspect the result.</p></div>
        <div class="path" id="path">App Worker → Workers Cache → VinextDataCache</div>
        <div class="facts">
          <div class="fact"><small>VinextDataCache</small><output id="executed">—</output></div>
          <div class="fact"><small>Write ID</small><output id="write-id">—</output></div>
          <div class="fact"><small>App request</small><output id="request-id">—</output></div>
          <div class="fact"><small>Latency</small><output id="latency">—</output></div>
        </div>
        <div class="output-title">Returned value</div><pre id="output">No result yet.</pre>
        <div class="details" id="details"><span class="empty">Internal requests will appear here.</span></div>
      </section>
    </main>

    <footer>Real HIT, overwrite, and purge behavior requires Cloudflare's edge. The local Miniflare runtime does not emulate Workers Cache.</footer>
  </div>

  <script>
    (function () {
      'use strict';

      var storageKey = 'workers-cache-demo-session';
      var state = { tab: 'read-through', mode: 'delete', busy: false };
      var sessionId = loadSession();
      var code = document.getElementById('code');
      var run = document.getElementById('run');
      var error = document.getElementById('error');

      document.getElementById('session').textContent = sessionId.slice(0, 8);
      document.querySelectorAll('[data-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (state.busy) return;
          state.tab = button.getAttribute('data-tab');
          document.querySelectorAll('[data-tab]').forEach(function (item) { item.classList.toggle('active', item === button); });
          render();
        });
      });
      document.querySelectorAll('[data-mode]').forEach(function (button) {
        button.addEventListener('click', function () {
          state.mode = button.getAttribute('data-mode');
          document.querySelectorAll('[data-mode]').forEach(function (item) { item.classList.toggle('active', item === button); });
          renderCode();
        });
      });
      ['key', 'ttl', 'tags'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderCode); });
      document.getElementById('copy').addEventListener('click', copyCode);
      document.getElementById('reset').addEventListener('click', function () {
        sessionId = createSession();
        localStorage.setItem(storageKey, sessionId);
        document.getElementById('session').textContent = sessionId.slice(0, 8);
        resetResult();
      });
      run.addEventListener('click', execute);
      render();

      function loadSession() {
        var saved = localStorage.getItem(storageKey);
        if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved;
        var value = createSession();
        localStorage.setItem(storageKey, value);
        return value;
      }

      function createSession() {
        if (crypto.randomUUID) return crypto.randomUUID();
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      }

      function inputs(includeValue) {
        var key = document.getElementById('key').value;
        var ttl = Number(document.getElementById('ttl').value);
        var tags = document.getElementById('tags').value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
        if (!key) throw new Error('Enter a key.');
        if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('TTL must be a positive integer.');
        var result = { sessionId: sessionId, key: key, ttl: ttl, tags: tags };
        if (includeValue) result.value = JSON.parse(document.getElementById('value').value);
        return result;
      }

      function render() {
        document.getElementById('value-wrap').classList.toggle('visible', state.tab === 'overwrite');
        document.getElementById('modes').classList.toggle('visible', state.tab === 'invalidate');
        run.textContent = state.tab === 'read-through' ? 'Run read-through' : state.tab === 'overwrite' ? 'Run overwrite' : 'Run invalidation';
        renderCode();
      }

      function renderCode() { code.textContent = sample().join('\n'); }

      function sample() {
        var key = quote(document.getElementById('key').value || 'blog');
        var ttl = document.getElementById('ttl').value || '60';
        var tags = document.getElementById('tags').value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean).map(quote).join(', ');
        var first = ['const cache = new WorkersCacheHandler(', '  ctx.exports.VinextDataCache,', ');', ''];
        if (state.tab === 'read-through') return first.concat([
          'const cached = await cache.get(' + key + ');',
          'let posts = cached?.value?.kind === "FETCH"',
          '  ? JSON.parse(cached.value.data.body)',
          '  : null;',
          'if (posts === null) {',
          '  posts = await fetchBlogPosts();',
          '  await cache.set(' + key + ', toFetchValue(posts), {',
          '    revalidate: ' + ttl + ', tags: [' + tags + '],',
          '  });',
          '}',
        ]);
        if (state.tab === 'overwrite') return first.concat([
          'await cache.set(' + key + ', toFetchValue(value), {',
          '  revalidate: ' + ttl + ', tags: [' + tags + '],',
          '});',
          '',
          'const cached = await cache.get(' + key + ');',
        ]);
        if (state.mode === 'expire-tag') return first.concat([
          'await cache.revalidateTag([' + tags + ']);',
        ]);
        return first.concat([
          'await cache.delete(' + key + ');',
        ]);
      }

      function quote(value) { return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

      async function copyCode() {
        var button = document.getElementById('copy');
        try { await navigator.clipboard.writeText(sample().join('\n')); button.textContent = 'copied'; }
        catch (_) { button.textContent = 'failed'; }
        setTimeout(function () { button.textContent = 'copy'; }, 1000);
      }

      async function execute() {
        if (state.busy) return;
        error.textContent = '';
        var payload;
        try { payload = inputs(state.tab === 'overwrite'); }
        catch (problem) { error.textContent = problem instanceof Error ? problem.message : String(problem); return; }

        state.busy = true;
        run.disabled = true;
        setStatus('Running…', 'running', 'Calling the App Worker.');
        var operation = state.tab === 'invalidate' ? state.mode : state.tab;
        try {
          var response = await fetch('/api/demo/' + operation, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          var responseText = await response.text();
          var result;
          try { result = JSON.parse(responseText); }
          catch (_) { throw new Error('Request failed with ' + response.status + ': ' + responseText.slice(0, 160)); }
          if (!response.ok) throw new Error(result.error || 'Request failed with ' + response.status);
          showResult(result);
        } catch (problem) {
          var message = problem instanceof Error ? problem.message : String(problem);
          error.textContent = message;
          if (message.includes('Workers Cache is not enabled')) document.getElementById('notice').classList.add('visible');
          setStatus('Error', 'miss', message);
        } finally {
          state.busy = false;
          run.disabled = false;
        }
      }

      function showResult(result) {
        var traces = result.traces || [];
        var read = findLast(traces, function (trace) { return trace.operation === 'get'; });
        var signal = read || findLast(traces, function (trace) { return Boolean(trace.cacheStatus); });
        var hasCacheSignal = traces.some(function (trace) { return Boolean(trace.cacheStatus); });
        var unavailable = !hasCacheSignal && traces.some(function (trace) { return trace.request.method === 'GET'; });
        var status = unavailable
          ? 'Unavailable'
          : read
            ? read.outcome.toUpperCase()
            : signal && signal.cacheStatus
              ? signal.cacheStatus
              : signal ? signal.outcome.toUpperCase() : 'PURGED';
        var hit = hasCacheSignal && read && read.outcome === 'hit';
        var dataCacheRan = traces.some(function (trace) { return trace.dataCacheExecuted; });
        var write = findLast(traces, function (trace) { return Boolean(trace.writeId); });

        if (unavailable) document.getElementById('notice').classList.add('visible');
        setStatus(status, unavailable ? '' : hit ? 'hit' : 'miss', unavailable
          ? 'No edge cache signal was returned. This is not a real cache miss.'
          : hit ? 'The App Worker ran. VinextDataCache was skipped for the read.'
          : result.source === 'origin' ? 'Run the same sample again; the next read should be a HIT.'
          : result.source === 'purge' ? 'Purge accepted. Global propagation can take a moment.'
          : 'The operation reached VinextDataCache.');
        document.getElementById('path').textContent = unavailable
          ? 'App Worker → cache unavailable in this runtime'
          : 'App Worker → Workers Cache ' + status + ' → VinextDataCache ' + (dataCacheRan ? 'executed' : 'skipped');
        document.getElementById('executed').textContent = dataCacheRan ? 'executed' : 'skipped';
        document.getElementById('write-id').textContent = write ? short(write.writeId) : '—';
        document.getElementById('request-id').textContent = short(result.requestId);
        document.getElementById('latency').textContent = result.durationMs + ' ms';
        document.getElementById('colo').textContent = result.colo;
        document.getElementById('output').textContent = JSON.stringify(result.value, null, 2);
        renderDetails(traces, unavailable);
      }

      function renderDetails(traces, unavailable) {
        var root = document.getElementById('details');
        root.replaceChildren();
        traces.forEach(function (trace, index) {
          var details = document.createElement('details');
          if (index === 0) details.open = true;
          var summary = document.createElement('summary');
          var name = document.createElement('span');
          name.textContent = trace.request.method + ' · ' + trace.operation;
          var outcome = document.createElement('span');
          outcome.textContent = unavailable && trace.request.method === 'GET' ? 'UNAVAILABLE' : trace.cacheStatus || trace.outcome.toUpperCase();
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify(trace, null, 2);
          summary.append(name, outcome);
          details.append(summary, pre);
          root.appendChild(details);
        });
      }

      function setStatus(text, className, hint) {
        var status = document.getElementById('status');
        status.textContent = text;
        status.className = className;
        document.getElementById('hint').textContent = hint;
      }

      function resetResult() {
        setStatus('Ready', '', 'Run an example to inspect the result.');
        document.getElementById('path').textContent = 'App Worker → Workers Cache → VinextDataCache';
        ['executed', 'write-id', 'request-id', 'latency'].forEach(function (id) { document.getElementById(id).textContent = '—'; });
        document.getElementById('colo').textContent = '—';
        document.getElementById('output').textContent = 'No result yet.';
        var root = document.getElementById('details');
        root.innerHTML = '<span class="empty">Internal requests will appear here.</span>';
      }

      function findLast(items, predicate) {
        for (var index = items.length - 1; index >= 0; index--) if (predicate(items[index])) return items[index];
        return undefined;
      }
      function short(value) { return value ? value.slice(0, 8) : '—'; }
    })();
  </script>
</body>
</html>`;

export function demoPage(): Response {
	return new Response(DEMO_HTML, {
		headers: {
			'Cache-Control': 'no-store',
			'Content-Security-Policy':
				"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
			'Content-Type': 'text/html; charset=utf-8',
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}
