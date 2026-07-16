export const DEMO_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Cache Observatory</title>
  <style>
    :root {
      --ink: #f4f1e8;
      --muted: #9da3a0;
      --dim: #676d6a;
      --base: #0a0c0b;
      --panel: #111412;
      --raised: #171b18;
      --line: #303630;
      --acid: #c8ff58;
      --cyan: #67e8e1;
      --coral: #ff7c5c;
      --amber: #ffc45c;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --serif: Iowan Old Style, Baskerville, "Times New Roman", serif;
    }

    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--base); }
    body {
      margin: 0;
      color: var(--ink);
      background-color: var(--base);
      background-image: radial-gradient(#252a26 0.8px, transparent 0.8px);
      background-size: 20px 20px;
      font-family: var(--sans);
      min-height: 100vh;
    }

    button, input, textarea { font: inherit; }
    button { color: inherit; }
    button:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 2px;
    }

    .shell { width: min(1500px, 100%); margin: 0 auto; padding: 0 28px 64px; }
    .topbar {
      height: 70px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--base) 92%, transparent);
    }
    .brand { display: flex; align-items: center; gap: 12px; font: 700 13px/1 var(--mono); letter-spacing: 0.12em; }
    .brand-mark { width: 28px; height: 28px; position: relative; border: 1px solid var(--acid); }
    .brand-mark::before, .brand-mark::after { content: ""; position: absolute; background: var(--acid); }
    .brand-mark::before { width: 14px; height: 1px; top: 8px; left: 6px; }
    .brand-mark::after { width: 8px; height: 1px; top: 16px; left: 6px; box-shadow: 5px 4px 0 var(--acid); }
    .session { display: flex; align-items: center; gap: 10px; color: var(--muted); font: 11px/1 var(--mono); }
    .session strong { color: var(--cyan); font-weight: 500; }
    .ghost-button {
      border: 1px solid var(--line);
      background: transparent;
      padding: 8px 11px;
      cursor: pointer;
      font: 600 10px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .ghost-button:hover { border-color: var(--cyan); color: var(--cyan); }

    .hero { padding: 62px 0 38px; display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.7fr); gap: 72px; align-items: end; }
    .eyebrow { margin: 0 0 15px; color: var(--acid); font: 700 11px/1 var(--mono); letter-spacing: 0.18em; text-transform: uppercase; }
    h1 { margin: 0; max-width: 900px; font: 400 clamp(45px, 6.3vw, 92px)/0.91 var(--serif); letter-spacing: -0.055em; }
    .hero-copy { color: var(--muted); font-size: 15px; line-height: 1.7; max-width: 470px; }
    .hero-copy code { color: var(--cyan); font-family: var(--mono); }
    .local-notice {
      display: none;
      margin-top: 18px;
      border-left: 2px solid var(--amber);
      padding: 8px 0 8px 14px;
      color: var(--amber);
      font: 11px/1.55 var(--mono);
    }
    .local-notice.visible { display: block; }

    .workspace { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(430px, 0.92fr); border: 1px solid var(--line); background: var(--panel); }
    .panel { min-width: 0; }
    .code-panel { border-right: 1px solid var(--line); }
    .panel-head { min-height: 61px; display: flex; align-items: center; justify-content: space-between; padding: 0 19px; border-bottom: 1px solid var(--line); }
    .panel-kicker { color: var(--dim); font: 700 10px/1 var(--mono); letter-spacing: 0.13em; text-transform: uppercase; }
    .source-file { color: var(--cyan); font: 11px/1 var(--mono); }
    .tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--line); }
    .tab {
      flex: 1;
      min-width: 118px;
      padding: 16px 12px;
      border: 0;
      border-right: 1px solid var(--line);
      background: transparent;
      color: var(--dim);
      cursor: pointer;
      font: 700 11px/1 var(--mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tab:last-child { border-right: 0; }
    .tab:hover { color: var(--ink); }
    .tab.active { color: var(--base); background: var(--acid); }

    .inputs { display: grid; grid-template-columns: 1fr 110px 1fr; border-bottom: 1px solid var(--line); }
    .field { display: flex; flex-direction: column; gap: 7px; padding: 14px 16px; border-right: 1px solid var(--line); }
    .field:last-child { border-right: 0; }
    .field label { color: var(--dim); font: 700 9px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .field input, .value-field textarea {
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--ink);
      padding: 0;
      font: 13px/1.5 var(--mono);
    }
    .field input::placeholder, .value-field textarea::placeholder { color: #4d534f; }
    .value-field { display: none; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .value-field.visible { display: block; }
    .value-field label { display: block; margin-bottom: 9px; color: var(--dim); font: 700 9px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .value-field textarea { resize: vertical; min-height: 112px; }

    .code-toolbar { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px 0 18px; background: #0d100e; border-bottom: 1px solid var(--line); }
    .code-toolbar span { color: var(--dim); font: 10px/1 var(--mono); }
    .copy-button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font: 10px/1 var(--mono); text-transform: uppercase; }
    .copy-button:hover { color: var(--cyan); }
    .code-wrap { min-height: 350px; overflow: auto; background: #0d100e; padding: 17px 0 23px; }
    .code-line {
      display: grid;
      grid-template-columns: 47px 1fr;
      min-height: 25px;
      padding: 2px 24px 2px 0;
      color: #d8ddd8;
      font: 12.5px/1.65 var(--mono);
      white-space: pre;
      transition: background 120ms ease, color 120ms ease;
    }
    .code-line::before { content: attr(data-line); padding-right: 13px; color: #444a46; text-align: right; user-select: none; }
    .code-line.active { color: #fff; background: color-mix(in srgb, var(--cyan) 13%, transparent); box-shadow: inset 2px 0 var(--cyan); }
    .code-line.complete::before { color: var(--acid); }

    .actions { min-height: 70px; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--line); }
    .run-button {
      min-height: 43px;
      border: 0;
      background: var(--acid);
      color: #10130f;
      padding: 0 20px;
      cursor: pointer;
      font: 800 11px/1 var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .run-button:hover { background: #dcff91; }
    .run-button:disabled { cursor: wait; opacity: 0.55; }
    .invalidate-actions { display: none; gap: 8px; }
    .invalidate-actions.visible { display: flex; }
    .mode-button { height: 43px; border: 1px solid var(--line); background: transparent; padding: 0 13px; cursor: pointer; color: var(--muted); font: 700 10px/1 var(--mono); text-transform: uppercase; }
    .mode-button.active { color: var(--cyan); border-color: var(--cyan); }
    .form-error { margin-left: auto; color: var(--coral); font: 11px/1.4 var(--mono); text-align: right; }

    .trace-head { display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid var(--line); }
    .trace-title { margin: 0; font: 400 26px/1 var(--serif); }
    .status-pill { border: 1px solid var(--line); padding: 7px 9px; color: var(--dim); font: 700 10px/1 var(--mono); letter-spacing: 0.08em; }
    .status-pill.hit { color: var(--acid); border-color: var(--acid); }
    .status-pill.miss { color: var(--coral); border-color: var(--coral); }
    .status-pill.running { color: var(--cyan); border-color: var(--cyan); }

    .flow { padding: 24px 20px 21px; border-bottom: 1px solid var(--line); overflow-x: auto; }
    .flow-track { min-width: 470px; display: grid; grid-template-columns: 1fr 28px 1fr 28px 1fr 28px 1fr 28px 1fr; align-items: center; }
    .flow-node { min-height: 75px; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--line); padding: 10px; color: var(--dim); background: #0d100e; }
    .flow-node strong { font: 700 10px/1.3 var(--mono); text-transform: uppercase; }
    .flow-node small { font: 9px/1.3 var(--mono); }
    .flow-node.active { color: var(--ink); border-color: var(--cyan); }
    .flow-node.hit { color: var(--acid); border-color: var(--acid); }
    .flow-node.miss { color: var(--coral); border-color: var(--coral); }
    .connector { height: 1px; background: var(--line); position: relative; }
    .connector::after { content: ""; position: absolute; width: 5px; height: 5px; border-top: 1px solid var(--dim); border-right: 1px solid var(--dim); transform: rotate(45deg); right: 1px; top: -2px; }
    .connector.active { background: var(--cyan); }
    .connector.active::after { border-color: var(--cyan); }

    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--line); }
    .metric { min-height: 82px; padding: 14px 15px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .metric:nth-child(3n) { border-right: 0; }
    .metric:nth-child(n+4) { border-bottom: 0; }
    .metric label { display: block; color: var(--dim); font: 700 8px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .metric output { display: block; margin-top: 11px; overflow: hidden; color: var(--ink); font: 12px/1.25 var(--mono); text-overflow: ellipsis; white-space: nowrap; }

    .result-block { border-bottom: 1px solid var(--line); }
    .result-label { padding: 12px 16px; border-bottom: 1px solid var(--line); color: var(--dim); font: 700 9px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .result-json { margin: 0; min-height: 125px; max-height: 235px; overflow: auto; padding: 15px 17px; color: #d8ddd8; background: #0d100e; font: 11px/1.55 var(--mono); white-space: pre-wrap; }
    .protocol { padding: 0 16px 18px; }
    .protocol-title { margin: 0; padding: 15px 0 11px; color: var(--dim); font: 700 9px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    .protocol-empty { color: var(--dim); font: 11px/1.6 var(--mono); }
    .trace-item { border: 1px solid var(--line); border-bottom: 0; }
    .trace-item:last-child { border-bottom: 1px solid var(--line); }
    .trace-item summary { display: flex; justify-content: space-between; gap: 12px; padding: 11px 12px; cursor: pointer; color: var(--muted); font: 10px/1.4 var(--mono); list-style: none; }
    .trace-item summary::-webkit-details-marker { display: none; }
    .trace-item summary span:last-child { color: var(--cyan); }
    .trace-item pre { margin: 0; overflow: auto; padding: 12px; border-top: 1px solid var(--line); background: #0d100e; color: #b9c0ba; font: 10px/1.5 var(--mono); }

    .history { margin-top: 24px; border: 1px solid var(--line); background: var(--panel); }
    .history-head { display: flex; align-items: center; justify-content: space-between; min-height: 55px; padding: 0 18px; border-bottom: 1px solid var(--line); }
    .history-head h2 { margin: 0; font: 400 21px/1 var(--serif); }
    .history-head span { color: var(--dim); font: 10px/1 var(--mono); }
    .history-empty { padding: 25px 18px; color: var(--dim); font: 11px/1.5 var(--mono); }
    .history-row { border-bottom: 1px solid var(--line); }
    .history-row:last-child { border-bottom: 0; }
    .history-row summary { display: grid; grid-template-columns: 90px 150px 1fr 90px 90px; gap: 14px; align-items: center; min-height: 47px; padding: 0 18px; cursor: pointer; list-style: none; font: 10px/1 var(--mono); }
    .history-row summary::-webkit-details-marker { display: none; }
    .history-row .time, .history-row .meta { color: var(--dim); }
    .history-row .operation { color: var(--cyan); text-transform: uppercase; }
    .history-row .key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-row pre { margin: 0; max-height: 300px; overflow: auto; padding: 15px 18px; border-top: 1px solid var(--line); background: #0d100e; color: var(--muted); font: 10px/1.5 var(--mono); }

    @media (max-width: 1040px) {
      .hero { grid-template-columns: 1fr; gap: 22px; }
      .workspace { grid-template-columns: 1fr; }
      .code-panel { border-right: 0; border-bottom: 1px solid var(--line); }
      .history-row summary { grid-template-columns: 80px 130px 1fr 75px; }
      .history-row .duration { display: none; }
    }
    @media (max-width: 680px) {
      .shell { padding: 0 12px 35px; }
      .topbar { height: 58px; }
      .brand span { display: none; }
      .session > span:first-child { display: none; }
      .hero { padding: 42px 2px 28px; }
      h1 { font-size: clamp(42px, 16vw, 67px); }
      .inputs { grid-template-columns: 1fr 90px; }
      .inputs .field:last-child { grid-column: 1 / -1; border-top: 1px solid var(--line); }
      .inputs .field:nth-child(2) { border-right: 0; }
      .code-wrap { min-height: 310px; }
      .code-line { font-size: 11px; grid-template-columns: 38px 1fr; }
      .actions { align-items: stretch; flex-wrap: wrap; }
      .run-button { flex: 1; }
      .form-error { width: 100%; text-align: left; }
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .metric:nth-child(3n) { border-right: 1px solid var(--line); }
      .metric:nth-child(2n) { border-right: 0; }
      .metric:nth-child(n+4) { border-bottom: 1px solid var(--line); }
      .metric:nth-child(n+5) { border-bottom: 0; }
      .history-row summary { grid-template-columns: 75px 1fr 65px; }
      .history-row .operation { display: none; }
      .history-row .duration { display: block; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Cache Observatory / Workers Cache</span></div>
      <div class="session"><span>ISOLATED SESSION</span><strong id="session-id">--------</strong><button class="ghost-button" id="reset-session" type="button">Reset</button></div>
    </header>

    <main>
      <section class="hero">
        <div>
          <p class="eyebrow">Runtime Cache, without storage</p>
          <h1>Run the code.<br>Watch the cache.</h1>
        </div>
        <div class="hero-copy">
          <p>A Vercel-shaped <code>get</code>/<code>set</code> API backed exclusively by Cloudflare Workers Cache. The app Worker always runs; a hit skips the cached <code>DataCache</code> entrypoint entirely.</p>
          <div class="local-notice" id="local-notice">LOCAL MODE: Workers Cache is not emulated. API calls execute, but real HIT, overwrite, and purge behavior requires a deployed Worker.</div>
        </div>
      </section>

      <section class="workspace" aria-label="Interactive cache demonstration">
        <article class="panel code-panel">
          <div class="panel-head"><span class="panel-kicker">Developer-facing API</span><span class="source-file">src/runtime-cache.ts</span></div>
          <nav class="tabs" aria-label="Code samples">
            <button class="tab active" type="button" data-tab="read-through">Read-through</button>
            <button class="tab" type="button" data-tab="overwrite">Overwrite</button>
            <button class="tab" type="button" data-tab="invalidate">Invalidate</button>
          </nav>

          <div class="inputs">
            <div class="field"><label for="cache-key">Cache key</label><input id="cache-key" value="blog" maxlength="512"></div>
            <div class="field"><label for="cache-ttl">TTL, seconds</label><input id="cache-ttl" type="number" value="60" min="1" step="1"></div>
            <div class="field"><label for="cache-tags">Tags, comma separated</label><input id="cache-tags" value="blog,posts"></div>
          </div>
          <div class="value-field" id="value-field">
            <label for="cache-value">JSON value supplied to set()</label>
            <textarea id="cache-value" spellcheck="false">{
  "message": "written from the observatory",
  "revision": 1
}</textarea>
          </div>

          <div class="code-toolbar"><span>EXACT CALL SITE</span><button class="copy-button" id="copy-code" type="button">Copy code</button></div>
          <div class="code-wrap" id="code-lines" aria-label="Executable TypeScript sample"></div>

          <div class="actions">
            <button class="run-button" id="run-sample" type="button">Run read-through</button>
            <div class="invalidate-actions" id="invalidate-actions">
              <button class="mode-button active" type="button" data-mode="delete">Delete key</button>
              <button class="mode-button" type="button" data-mode="expire-tag">Expire tags</button>
            </div>
            <span class="form-error" id="form-error" role="alert"></span>
          </div>
        </article>

        <article class="panel trace-panel">
          <div class="trace-head"><h2 class="trace-title">Live execution trace</h2><span class="status-pill" id="status-pill">READY</span></div>
          <div class="flow">
            <div class="flow-track">
              <div class="flow-node" data-node="browser"><strong>Browser</strong><small>run sample</small></div><span class="connector"></span>
              <div class="flow-node" data-node="app"><strong>App Worker</strong><small>always runs</small></div><span class="connector"></span>
              <div class="flow-node" data-node="cache"><strong>Workers Cache</strong><small id="cache-node-status">awaiting call</small></div><span class="connector"></span>
              <div class="flow-node" data-node="data"><strong>DataCache</strong><small id="data-node-status">cached entrypoint</small></div><span class="connector"></span>
              <div class="flow-node" data-node="origin"><strong>Origin</strong><small>api.vercel.app</small></div>
            </div>
          </div>

          <div class="metrics">
            <div class="metric"><label>App request</label><output id="metric-request">—</output></div>
            <div class="metric"><label>Cache status</label><output id="metric-cache">—</output></div>
            <div class="metric"><label>DataCache execution</label><output id="metric-execution">—</output></div>
            <div class="metric"><label>Write ID</label><output id="metric-write">—</output></div>
            <div class="metric"><label>Colo</label><output id="metric-colo">—</output></div>
            <div class="metric"><label>Total latency</label><output id="metric-duration">—</output></div>
          </div>

          <div class="result-block"><div class="result-label">Returned value</div><pre class="result-json" id="result-json">Run a code sample to inspect its result.</pre></div>
          <div class="protocol"><h3 class="protocol-title">Under the hood</h3><div id="protocol-list" class="protocol-empty">Internal GETs, custom keys, revalidation, and RPC purges will appear here.</div></div>
        </article>
      </section>

      <section class="history">
        <div class="history-head"><h2>Operation history</h2><span>CLIENT-SIDE / THIS SESSION</span></div>
        <div id="history-list" class="history-empty">No operations yet.</div>
      </section>
    </main>
  </div>

  <script>
    (function () {
      'use strict';

      var sessionStorageKey = 'workers-cache-observatory-session';
      var state = { tab: 'read-through', invalidateMode: 'delete', busy: false, history: [] };
      var sessionId = getSession();
      var codeLines = document.getElementById('code-lines');
      var runButton = document.getElementById('run-sample');
      var valueField = document.getElementById('value-field');
      var invalidateActions = document.getElementById('invalidate-actions');
      var formError = document.getElementById('form-error');
      var statusPill = document.getElementById('status-pill');

      document.getElementById('session-id').textContent = sessionId.slice(0, 8);
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        document.getElementById('local-notice').classList.add('visible');
      }

      document.querySelectorAll('[data-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (state.busy) return;
          state.tab = button.getAttribute('data-tab');
          document.querySelectorAll('[data-tab]').forEach(function (item) { item.classList.toggle('active', item === button); });
          renderSample();
        });
      });

      document.querySelectorAll('[data-mode]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (state.busy) return;
          state.invalidateMode = button.getAttribute('data-mode');
          document.querySelectorAll('[data-mode]').forEach(function (item) { item.classList.toggle('active', item === button); });
          renderSample();
        });
      });

      ['cache-key', 'cache-ttl', 'cache-tags'].forEach(function (id) {
        document.getElementById(id).addEventListener('input', renderCode);
      });

      runButton.addEventListener('click', runSample);
      document.getElementById('copy-code').addEventListener('click', copyCode);
      document.getElementById('reset-session').addEventListener('click', function () {
        sessionId = createSession();
        localStorage.setItem(sessionStorageKey, sessionId);
        state.history = [];
        document.getElementById('session-id').textContent = sessionId.slice(0, 8);
        renderHistory();
        resetTrace();
      });

      renderSample();

      function getSession() {
        var existing = localStorage.getItem(sessionStorageKey);
        if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing;
        var created = createSession();
        localStorage.setItem(sessionStorageKey, created);
        return created;
      }

      function createSession() {
        if (crypto.randomUUID) return crypto.randomUUID();
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      }

      function readInputs(includeValue) {
        var key = document.getElementById('cache-key').value;
        var ttl = Number(document.getElementById('cache-ttl').value);
        var tags = document.getElementById('cache-tags').value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
        if (!key) throw new Error('Enter a cache key.');
        if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('TTL must be a positive integer.');
        var payload = { sessionId: sessionId, key: key, ttl: ttl, tags: tags };
        if (includeValue) payload.value = JSON.parse(document.getElementById('cache-value').value);
        return payload;
      }

      function renderSample() {
        valueField.classList.toggle('visible', state.tab === 'overwrite');
        invalidateActions.classList.toggle('visible', state.tab === 'invalidate');
        runButton.textContent = state.tab === 'read-through' ? 'Run read-through' : state.tab === 'overwrite' ? 'Run overwrite' : 'Run invalidation';
        renderCode();
      }

      function codeForCurrentSample() {
        var key = quote(document.getElementById('cache-key').value || 'blog');
        var ttl = document.getElementById('cache-ttl').value || '60';
        var tags = document.getElementById('cache-tags').value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean).map(quote).join(', ');
        var prelude = ['const cache = getCache(ctx.exports.DataCache);', ''];

        if (state.tab === 'read-through') {
          return prelude.concat([
            'let posts = await cache.get<BlogPost[]>(' + key + ');',
            '',
            'if (posts === null) {',
            '  posts = await fetchBlogPosts();',
            '  await cache.set(' + key + ', posts, {',
            '    ttl: ' + ttl + ',',
            '    tags: [' + tags + '],',
            '  });',
            '}',
          ]);
        }

        if (state.tab === 'overwrite') {
          return prelude.concat([
            'const value = /* JSON from the editor */;',
            '',
            'await cache.set(' + key + ', value, {',
            '  ttl: ' + ttl + ',',
            '  tags: [' + tags + '],',
            '});',
            '',
            'const cached = await cache.get(' + key + ');',
          ]);
        }

        if (state.invalidateMode === 'expire-tag') {
          return prelude.concat([
            'await cache.expireTag([' + tags + ']);',
            '',
            'const afterExpiration = await cache.get(' + key + ');',
            '// afterExpiration === null',
          ]);
        }

        return prelude.concat([
          'await cache.delete(' + key + ');',
          '',
          'const afterDelete = await cache.get(' + key + ');',
          '// afterDelete === null',
        ]);
      }

      function quote(value) {
        return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      }

      function renderCode() {
        codeLines.replaceChildren();
        codeForCurrentSample().forEach(function (text, index) {
          var line = document.createElement('div');
          line.className = 'code-line';
          line.setAttribute('data-line', String(index + 1));
          line.textContent = text || ' ';
          codeLines.appendChild(line);
        });
      }

      async function copyCode() {
        var button = document.getElementById('copy-code');
        try {
          await navigator.clipboard.writeText(codeForCurrentSample().join('\n'));
          button.textContent = 'Copied';
        } catch (_) {
          button.textContent = 'Copy failed';
        }
        setTimeout(function () { button.textContent = 'Copy code'; }, 1200);
      }

      async function runSample() {
        if (state.busy) return;
        formError.textContent = '';
        var payload;
        try {
          payload = readInputs(state.tab === 'overwrite');
        } catch (error) {
          formError.textContent = error instanceof Error ? error.message : String(error);
          return;
        }

        state.busy = true;
        runButton.disabled = true;
        statusPill.className = 'status-pill running';
        statusPill.textContent = 'RUNNING';
        beginFlow();

        var operation = state.tab === 'invalidate' ? state.invalidateMode : state.tab;
        var requestPromise = fetch('/api/demo/' + operation, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        try {
          await animateCode();
          var response = await requestPromise;
          var data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Request failed with ' + response.status);
          renderResult(data);
          state.history.unshift(data);
          state.history = state.history.slice(0, 12);
          renderHistory();
        } catch (error) {
          formError.textContent = error instanceof Error ? error.message : String(error);
          statusPill.className = 'status-pill miss';
          statusPill.textContent = 'ERROR';
        } finally {
          state.busy = false;
          runButton.disabled = false;
        }
      }

      async function animateCode() {
        var lines = Array.from(codeLines.children).filter(function (line) { return line.textContent.trim(); });
        for (var index = 0; index < lines.length; index++) {
          lines.forEach(function (line) { line.classList.remove('active'); });
          lines[index].classList.add('active');
          if (index > 0) lines[index - 1].classList.add('complete');
          await delay(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 85);
        }
        lines.forEach(function (line) { line.classList.remove('active'); line.classList.add('complete'); });
      }

      function delay(milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); }

      function beginFlow() {
        document.querySelectorAll('.flow-node').forEach(function (node) { node.className = 'flow-node'; });
        document.querySelectorAll('.connector').forEach(function (connector) { connector.classList.add('active'); });
        document.querySelector('[data-node="browser"]').classList.add('active');
        document.querySelector('[data-node="app"]').classList.add('active');
        document.getElementById('cache-node-status').textContent = 'lookup in progress';
        document.getElementById('data-node-status').textContent = 'waiting';
      }

      function renderResult(data) {
        var traces = data.traces || [];
        var readTrace = findLast(traces, function (trace) { return trace.operation === 'get'; });
        var responseTrace = readTrace || findLast(traces, function (trace) { return Boolean(trace.cacheStatus); });
        var executionTrace = findLast(traces, function (trace) { return Boolean(trace.dataCacheExecutionId); });
        var writeTrace = findLast(traces, function (trace) { return Boolean(trace.writeId); });
        var cacheLabel = responseTrace && responseTrace.cacheStatus ? responseTrace.cacheStatus : responseTrace ? responseTrace.outcome.toUpperCase() : 'RPC PURGE';
        var isHit = readTrace && readTrace.outcome === 'hit';

        statusPill.className = 'status-pill ' + (isHit ? 'hit' : 'miss');
        statusPill.textContent = cacheLabel;
        document.getElementById('metric-request').textContent = shortId(data.requestId);
        document.getElementById('metric-cache').textContent = cacheLabel;
        document.getElementById('metric-execution').textContent = executionTrace ? shortId(executionTrace.dataCacheExecutionId) : 'skipped';
        document.getElementById('metric-write').textContent = writeTrace ? shortId(writeTrace.writeId) : '—';
        document.getElementById('metric-colo').textContent = data.colo;
        document.getElementById('metric-duration').textContent = data.durationMs + ' ms';
        document.getElementById('result-json').textContent = JSON.stringify(data.value, null, 2);

        var cacheNode = document.querySelector('[data-node="cache"]');
        cacheNode.className = 'flow-node ' + (isHit ? 'hit' : 'miss');
        document.getElementById('cache-node-status').textContent = cacheLabel;
        document.querySelector('[data-node="browser"]').classList.add('active');
        document.querySelector('[data-node="app"]').classList.add('active');

        var dataExecuted = traces.some(function (trace) { return trace.dataCacheExecuted; });
        var dataNode = document.querySelector('[data-node="data"]');
        dataNode.className = 'flow-node' + (dataExecuted ? ' active' : '');
        document.getElementById('data-node-status').textContent = dataExecuted ? 'executed' : 'skipped on hit';
        document.querySelector('[data-node="origin"]').className = 'flow-node' + (data.source === 'origin' ? ' active' : '');
        renderProtocol(traces);
      }

      function renderProtocol(traces) {
        var list = document.getElementById('protocol-list');
        list.className = '';
        list.replaceChildren();
        traces.forEach(function (trace, index) {
          var details = document.createElement('details');
          details.className = 'trace-item';
          if (index === 0) details.open = true;
          var summary = document.createElement('summary');
          var title = document.createElement('span');
          title.textContent = String(index + 1).padStart(2, '0') + '  ' + trace.request.method + '  ' + trace.operation;
          var outcome = document.createElement('span');
          outcome.textContent = trace.cacheStatus || trace.outcome.toUpperCase();
          summary.append(title, outcome);
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify(trace, null, 2);
          details.append(summary, pre);
          list.appendChild(details);
        });
      }

      function renderHistory() {
        var list = document.getElementById('history-list');
        if (state.history.length === 0) {
          list.className = 'history-empty';
          list.textContent = 'No operations yet.';
          return;
        }

        list.className = '';
        list.replaceChildren();
        state.history.forEach(function (item) {
          var details = document.createElement('details');
          details.className = 'history-row';
          var summary = document.createElement('summary');
          var time = document.createElement('span');
          time.className = 'time';
          time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          var operation = document.createElement('span');
          operation.className = 'operation';
          operation.textContent = item.operation;
          var key = document.createElement('span');
          key.className = 'key';
          key.textContent = item.key;
          var meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = item.colo;
          var duration = document.createElement('span');
          duration.className = 'meta duration';
          duration.textContent = item.durationMs + ' ms';
          summary.append(time, operation, key, meta, duration);
          var pre = document.createElement('pre');
          pre.textContent = JSON.stringify(item, null, 2);
          details.append(summary, pre);
          list.appendChild(details);
        });
      }

      function resetTrace() {
        statusPill.className = 'status-pill';
        statusPill.textContent = 'READY';
        document.querySelectorAll('.flow-node').forEach(function (node) { node.className = 'flow-node'; });
        document.querySelectorAll('.connector').forEach(function (connector) { connector.classList.remove('active'); });
        ['metric-request', 'metric-cache', 'metric-execution', 'metric-write', 'metric-colo', 'metric-duration'].forEach(function (id) { document.getElementById(id).textContent = '—'; });
        document.getElementById('result-json').textContent = 'Run a code sample to inspect its result.';
        var protocol = document.getElementById('protocol-list');
        protocol.className = 'protocol-empty';
        protocol.textContent = 'Internal GETs, custom keys, revalidation, and RPC purges will appear here.';
      }

      function findLast(items, predicate) {
        for (var index = items.length - 1; index >= 0; index--) if (predicate(items[index])) return items[index];
        return undefined;
      }

      function shortId(value) { return value ? value.slice(0, 8) : '—'; }
    })();
  </script>
</body>
</html>`;
