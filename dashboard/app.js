// Token Radar's dashboard, radar-4. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board with its farm economics, the methodology panel with the model's
// own validation, a filterable table, a per-protocol full detail page with the model's own
// inputs, the deposit-size table, the nearest traded tokens and the farm plan, plus a category
// chart, the fastest growers and the comparable tilts the model calibrated from the
// snapshot's live-token protocols. No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCHLIST = {};
  (DATA.watchlist || []).forEach(function (s) { WATCHLIST[s] = true; });

  // The farm plan arrives in data.js per row (farm_steps, hold_days), written by the model
  // in lib/model.ts — the dashboard reads it, it does not rebuild it.
  function fmtUsd(n) {
    if (n === null || n === undefined) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtMoney2(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'n/a';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function fmtRatio(x) { return x >= 10 ? x.toFixed(1) + 'x' : x.toFixed(2) + 'x'; }
  function planComplete(r) {
    return r.age_days !== null && r.change_7d !== null && r.chains && r.chains.length > 0 && r.category;
  }
  function planGaps(r) {
    var gaps = [];
    if (r.age_days === null) gaps.push('no listing date on record, so the hold uses a 30-day default');
    if (r.change_7d === null) gaps.push('no seven-day growth on record, so the growth multiplier is neutral');
    if (!r.chains || r.chains.length === 0) gaps.push('no chain on record, so the plan uses its main chain');
    if (!r.category) gaps.push('no category on record, so the value uses no category tilt');
    return gaps;
  }
  // The dashboard recomputes a row's implied value from the same power law the model used:
  // 10^(intercept + slope*log10(TVL) + residual) x growth, with the rounded residual the
  // category carries. It must match board.json.
  function impliedOf(row, model) {
    var pl = DATA.power_law || { intercept: 3.0247, slope: 0.5223 };
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var entry = categoryEntry(row.category);
    var resid = entry ? entry.residual : (row.category_tilt === undefined ? 0 : Math.log10(row.category_tilt));
    return Math.max(1, Math.round(Math.pow(10, pl.intercept + pl.slope * Math.log10(row.tvl_usd) + resid) * (1 + (growth / 100) * model.growth_weight)));
  }
  function categoryEntry(category) {
    var found = (DATA.category_multiples || []).filter(function (c) { return c.category === category; })[0];
    return found || null;
  }
  // No clamp in radar-4: a tilt is shrunk toward 1.00x, never held to a floor or cap.
  // The only calibration warning left is thin evidence — few live comparables.
  function thinInfo(entry) {
    if (!entry) return { thin: true, unknown: true };
    return { thin: entry.live_count < 5, unknown: false };
  }
  function tiltNote(entry) {
    if (!entry) return 'no live comparable in this category — tilt 1.00x';
    if (entry.live_count < 5) return 'thin evidence: only ' + entry.live_count + ' live comparable' + (entry.live_count === 1 ? '' : 's');
    return 'backed by ' + entry.live_count + ' live comparables';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'onclick') node.addEventListener('click', v);
        else if (k === 'onkeydown') node.addEventListener('keydown', v);
        else node.setAttribute(k, v);
      });
    }
    kids.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    });
    return node;
  }
  function html(s) { var d = document.createElement('div'); d.innerHTML = s; return d.firstChild; }

  // Farm economics at any deposit, scaled from the $1,000 figures the model writes per row:
  // the slice and the forgone yield scale with the deposit; gas does not.
  function econAt(r, dep) {
    var e = r.economics || {};
    var k = dep / 1000;
    var slice = Math.round((e.slice_usd || 0) * k * 100) / 100;
    var fees = e.fees_usd || 0;
    var forgone = Math.round((e.forgone_usd || 0) * k * 100) / 100;
    var net = Math.round((slice - fees - forgone) * 100) / 100;
    var be = slice > 0 ? Math.round(((fees + forgone) / slice) * 1000) / 1000 : null;
    var netHour = Math.round((net / 4.58) * 100) / 100;
    var verdict = be !== null && be <= 0.25 && netHour >= 2 ? 'Worth farming' : net > 0 ? 'Marginal' : 'Skip';
    return { deposit: dep, slice: slice, fees: fees, forgone: forgone, net: net, be: be, netHour: netHour, verdict: verdict };
  }
  function verdictClass(v) {
    if (v === 'Worth farming') return 'verdict-worth';
    if (v === 'Marginal') return 'verdict-marginal';
    return 'verdict-skip';
  }
  function fmtBe(be) {
    if (be === null || be === undefined) return 'n/a';
    if (be > 1) return '>100%';
    return (be * 100).toFixed(1) + '%';
  }

  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', watchlistOnly: false, earlyOnly: false, planOnly: false, verdict: 'all', deposit: 1000, sort: 'implied', dir: -1, selected: null, method: false };

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('method')) state.method = params.get('method') === '1';
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.selected) params.set('p', state.selected);
    if (state.method) params.set('method', '1');
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCHLIST[r.slug]) return false;
      if (state.earlyOnly && WATCHLIST[r.slug]) return false;
      if (state.planOnly && !planComplete(r)) return false;
      if (state.verdict !== 'all' && econAt(r, state.deposit).verdict !== state.verdict) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function filtered() { return state.q || state.category !== 'all' || state.chain !== 'all' || state.watchlistOnly || state.earlyOnly || state.planOnly || state.verdict !== 'all'; }
  function sortedRows(list) {
    var key = state.sort;
    var verdictRank = { 'Worth farming': 0, 'Marginal': 1, 'Skip': 2 };
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'slice') { av = econAt(a, state.deposit).slice; bv = econAt(b, state.deposit).slice; }
      else if (key === 'net') { av = econAt(a, state.deposit).net; bv = econAt(b, state.deposit).net; }
      else if (key === 'be') { av = econAt(a, state.deposit).be === null ? Infinity : econAt(a, state.deposit).be; bv = econAt(b, state.deposit).be === null ? Infinity : econAt(b, state.deposit).be; }
      else if (key === 'netHour') { av = econAt(a, state.deposit).netHour; bv = econAt(b, state.deposit).netHour; }
      else if (key === 'verdict') { av = verdictRank[econAt(a, state.deposit).verdict]; bv = verdictRank[econAt(b, state.deposit).verdict]; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model, tested leave-one-out on ' + (DATA.validation ? DATA.validation.live_n : '') + ' live tokens' })
      )
    );
  }

  function lede() {
    var worth = DATA.rows.filter(function (r) { return econAt(r, 1000).verdict === 'Worth farming'; }).length;
    var stat = function (label, value) { return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { text: value })); };
    var pl = DATA.power_law || { slope: 0.5223 };
    var best = DATA.rows.slice().sort(function (a, b) { return econAt(b, 1000).netHour - econAt(a, 1000).netHour; }).slice(0, 3);
    var bestText = 'Best farms now: ' + best.map(function (r) { return '#' + r.rank + ' ' + r.name + ' ' + fmtMoney2(econAt(r, 1000).netHour) + '/h'; }).join(' · ');
    return el('section', { class: 'lede' },
      el('div', { class: 'lede-main' },
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by a tested value model' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus ' + DATA.early_size + ' below it — each row carries its farm math at a $1,000 deposit.' }),
        el('p', { class: 'best-farms', text: bestText })
      ),
      el('div', { class: 'stats' },
        stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        stat('Pre-token rows scored', String(DATA.board_size)),
        stat('Total implied value', fmtUsd(DATA.total_implied_usd)),
        stat('Worth farming at $1,000', String(worth)),
        stat('Value curve', 'TVL^' + pl.slope.toFixed(2)),
        stat('Live-token set aside', String(DATA.live_size))
      )
    );
  }

  // Log-log scatter: live tokens at their market cap, pre-token rows at their implied value,
  // against the fitted curve y = intercept + slope*x.
  function scatterSvg(W, H) {
    var v = DATA.validation || {};
    var L = 34, R = 6, T = 6, B = 20;
    var curve = v.curve || { x0: 6, y0: 6, x1: 9, y1: 9 };
    var allY = (v.scatter_live || []).concat(v.scatter_pre || []).map(function (p) { return p.y; }).concat([curve.y0, curve.y1]);
    var y0 = Math.min.apply(null, allY) - 0.2, y1 = Math.max.apply(null, allY) + 0.2;
    var X = function (x) { return L + (x - curve.x0) / (curve.x1 - curve.x0) * (W - L - R); };
    var Y = function (y) { return T + (y1 - y) / (y1 - y0) * (H - T - B); };
    var ticks = [7, 8, 9];
    var tickLabels = { 7: '$10M', 8: '$100M', 9: '$1B' };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Log-log scatter of TVL against market cap for live tokens and implied value for pre-token rows">';
    ticks.forEach(function (t) {
      svg += '<line x1="' + X(t).toFixed(1) + '" y1="' + T + '" x2="' + X(t).toFixed(1) + '" y2="' + (H - B) + '" stroke="#d5dcd2"/>';
      svg += '<line x1="' + L + '" y1="' + Y(t).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(t).toFixed(1) + '" stroke="#d5dcd2"/>';
      svg += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 6) + '" font-size="9" fill="#5c6b62" text-anchor="middle">' + tickLabels[t] + '</text>';
      svg += '<text x="' + (L - 4) + '" y="' + (Y(t) + 3).toFixed(1) + '" font-size="9" fill="#5c6b62" text-anchor="end">' + tickLabels[t] + '</text>';
    });
    svg += '<line x1="' + X(curve.x0).toFixed(1) + '" y1="' + Y(curve.y0).toFixed(1) + '" x2="' + X(curve.x1).toFixed(1) + '" y2="' + Y(curve.y1).toFixed(1) + '" stroke="#14201a" stroke-width="1.5" stroke-dasharray="4 3"/>';
    (v.scatter_live || []).forEach(function (p) { svg += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="2.2" fill="#0d6b4f" opacity="0.8"/>'; });
    (v.scatter_pre || []).forEach(function (p) { svg += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="2.2" fill="#b97e0e" opacity="0.8"/>'; });
    svg += '</svg>';
    return svg;
  }

  // The methodology panel: how a value is built, the curve fit on a scatter, and the
  // validation table with the honest numbers — computed from this snapshot at run time.
  function methodology() {
    var v = DATA.validation || {};
    var m = DATA.model;
    var pl = DATA.power_law || { intercept: 3.0247, slope: 0.5223 };
    var formula = 'implied = round(10^(' + pl.intercept.toFixed(2) + ' + ' + pl.slope.toFixed(2) + ' × log10(TVL) + tilt) × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 × ' + m.growth_weight + '))';
    var verdict = 'The curve is a rough compass, not a price; the board\u2019s edge is the farm math below. Leave-one-out median miss ×' + v.loo_median_miss + ' vs ×' + v.flat_loo_median_miss + ' flat — the model beats a flat multiple by about a third.';
    var vrow = function (test, miss, within3, within2) {
      return el('tr', null,
        el('td', { text: test }),
        el('td', { class: 'num', text: miss === null || miss === undefined ? 'n/a' : miss + 'x' }),
        el('td', { class: 'num', text: within3 === null || within3 === undefined ? 'n/a' : within3 + '%' }),
        el('td', { class: 'num', text: within2 === null || within2 === undefined ? 'n/a' : within2 + '%' })
      );
    };
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How a value is built — and how well it holds up' }),
      el('div', { class: 'method-grid' },
        el('div', { class: 'method-col' },
          el('h3', { text: 'The formula' }),
          el('ol', { class: 'method-steps' },
            el('li', null, el('b', { text: 'Size curve. ' }), 'Value grows as TVL^' + pl.slope.toFixed(2) + ': 100x the TVL is worth ~11x the value, not 100x. Fit on 128 live tokens.'),
            el('li', null, el('b', { text: 'Category tilt. ' }), 'Shrunk median log-residual (prior weight ' + m.prior_weight + '): CEX +33%, Liquid Staking −23%, most within ±10%.'),
            el('li', null, el('b', { text: 'Growth carry. ' }), '7d TVL growth moves the value, capped at ' + m.growth_floor + '% to +' + m.growth_cap + '%, weight ' + m.growth_weight + '.'),
            el('li', null, el('b', { text: 'Removed. ' }), 'Maturity and chains were tested and removed — both made leave-one-out worse.')
          ),
          el('div', { class: 'formula' }, formula)
        ),
        el('div', { class: 'method-col' },
          el('h3', { text: 'The curve fit' }),
          html(scatterSvg(300, 96)),
          el('p', { class: 'legend' },
            el('span', { class: 'dot live' }), ' Live tokens, at market cap  ',
            el('span', { class: 'dot pre' }), ' Pre-token rows, at implied value  ',
            el('span', { class: 'dot curve' }), ' Fitted curve'
          ),
          el('p', { class: 'sub', text: 'Both axes log scale. Points on the dashed line are priced exactly by the curve.' })
        ),
        el('div', { class: 'method-col' },
          el('h3', { text: 'The validation' }),
          el('div', { class: 'table-wrap' },
            el('table', null,
              el('thead', null, el('tr', null,
                el('th', { scope: 'col', text: 'Test' }),
                el('th', { scope: 'col', text: 'Median miss' }),
                el('th', { scope: 'col', text: 'Within 3x' }),
                el('th', { scope: 'col', text: 'Within 2x' })
              )),
              el('tbody', null,
                vrow('LOO n=' + v.live_n, v.loo_median_miss, v.loo_within3_pct, v.loo_within2_pct),
                vrow('Flat TVL', v.flat_loo_median_miss, v.flat_loo_within3_pct, null),
                vrow('Walk-fwd', v.wf_median_miss, v.wf_within3_pct, null),
                vrow('Flat WF', v.flat_wf_median_miss, v.flat_wf_within3_pct, null)
              )
            )
          ),
          el('p', { class: 'sub', text: 'LOO predicts each live token from a calibration that never saw it; walk-forward trains before ' + v.wf_cutoff + ', tests after (n=' + v.wf_n + '). Bands: P25–P75 (×/÷' + v.band_p25_factor + ') holds ' + v.band_p25_hold_pct + '%; P10–P90 (×/÷' + v.band_p90_factor + ') holds ' + v.band_p90_hold_pct + '%.' })
        )
      ),
      el('p', { class: 'method-verdict' }, verdict + ' ', el('button', { class: 'button', type: 'button', text: 'Read the full method →', onclick: function () { state.method = true; writeHash(); render(); } }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var wl = el('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; render(); } });
    var plan = el('button', { type: 'button', 'aria-pressed': state.planOnly ? 'true' : 'false', text: 'Complete plans only', onclick: function () { state.planOnly = !state.planOnly; render(); } });
    // Verdict chips and the deposit toggle: the farm book is read at one deposit size.
    var counts = { all: DATA.rows.length, watchlist: DATA.rows.filter(function (r) { return WATCHLIST[r.slug]; }).length, early: DATA.rows.filter(function (r) { return !WATCHLIST[r.slug]; }).length, worth: 0, marginal: 0, skip: 0 };
    DATA.rows.forEach(function (r) { counts[econAt(r, 1000).verdict === 'Worth farming' ? 'worth' : econAt(r, 1000).verdict === 'Marginal' ? 'marginal' : 'skip']++; });
    var chip = function (label, active, onclick) {
      return el('button', { type: 'button', 'aria-pressed': active ? 'true' : 'false', text: label, onclick: onclick });
    };
    var dep = function (d, label) {
      return el('button', { type: 'button', 'aria-pressed': state.deposit === d ? 'true' : 'false', text: label, onclick: function () { state.deposit = d; render(); } });
    };
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'tabs' }, wl, plan)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Farm verdict' }), el('div', { class: 'tabs chips' },
        chip('All ' + counts.all, state.verdict === 'all' && !state.watchlistOnly && !state.earlyOnly, function () { state.verdict = 'all'; state.watchlistOnly = false; state.earlyOnly = false; render(); }),
        chip('Watchlist ' + counts.watchlist, state.watchlistOnly, function () { state.watchlistOnly = true; state.earlyOnly = false; render(); }),
        chip('Early ' + counts.early, state.earlyOnly, function () { state.earlyOnly = true; state.watchlistOnly = false; render(); }),
        chip('Worth farming ' + counts.worth, state.verdict === 'Worth farming', function () { state.verdict = 'Worth farming'; render(); }),
        chip('Marginal ' + counts.marginal, state.verdict === 'Marginal', function () { state.verdict = 'Marginal'; render(); }),
        chip('Skip ' + counts.skip, state.verdict === 'Skip', function () { state.verdict = 'Skip'; render(); })
      )),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Deposit size' }), el('div', { class: 'tabs' }, dep(1000, '$1,000'), dep(10000, '$10,000'))),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  // The current filter read as one farm book: what the selection costs and pays together.
  function farmBook(list) {
    var dep = state.deposit;
    var fees = 0, forgone = 0, slices = 0, net = 0;
    list.forEach(function (r) { var e = econAt(r, dep); fees += e.fees; forgone += e.forgone; slices += e.slice; net += e.net; });
    var be = slices > 0 ? (fees + forgone) / slices : null;
    var stat = function (label, value) { return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { text: value })); };
    return el('section', { class: 'panel farmbook' },
      el('h2', { text: 'This selection as one farm book — ' + list.length + ' protocols at $' + dep.toLocaleString('en-US') + ' each' }),
      el('p', { text: 'Same deposit in every row, same 12-week plan, 4.6 active hours per row. The book pays only if the launches come: the break-even is the average launch odds the whole book needs.' }),
      el('div', { class: 'stats' },
        stat('Capital at work', fmtUsd(list.length * dep)),
        stat('Gas and fees', fmtMoney2(fees)),
        stat('Yield forgone', fmtMoney2(forgone)),
        stat('Your time', (list.length * 4.58).toFixed(1) + ' h'),
        stat('Slices if all launch', fmtMoney2(slices)),
        stat('Book break-even', be === null ? 'n/a' : '1 in ' + Math.max(1, Math.round(1 / be)))
      ),
      el('p', { class: 'farmbook-net', text: 'Net if every token launches: ' + fmtMoney2(net) + (net < 0 ? ' — this selection loses money even if everything launches.' : ' — this selection pays if the launches come.') })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.earlyOnly = false; state.planOnly = false; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    // Band bar, log scale: the light segment is the row's P10–P90 band, the dark tick its
    // implied value, on one shared scale across the whole board.
    var bandLo = Infinity, bandHi = -Infinity;
    DATA.rows.forEach(function (r) {
      if (r.p10_usd && r.p90_usd) { bandLo = Math.min(bandLo, Math.log10(r.p10_usd)); bandHi = Math.max(bandHi, Math.log10(r.p90_usd)); }
    });
    var bandScale = bandHi > bandLo ? (bandHi - bandLo) : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var e = econAt(r, state.deposit);
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankClass = r.rank === 1 ? 'r1' : r.rank === 2 ? 'r2' : r.rank === 3 ? 'r3' : '';
      var bandBar;
      if (r.p10_usd && r.p90_usd) {
        var bl = Math.max(0, (Math.log10(r.p10_usd) - bandLo) / bandScale * 100);
        var bw = Math.max(1, (Math.log10(r.p90_usd) - Math.log10(r.p10_usd)) / bandScale * 100);
        var mk = Math.min(100, Math.max(0, (Math.log10(r.implied_value_usd) - bandLo) / bandScale * 100));
        bandBar = el('div', { class: 'bandbar', 'aria-hidden': 'true' },
          el('i', { class: 'band', style: 'left:' + bl.toFixed(1) + '%;width:' + bw.toFixed(1) + '%' }),
          el('i', { class: 'mark', style: 'left:' + mk.toFixed(1) + '%' })
        );
      } else {
        bandBar = el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }));
      }
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank ' + rankClass, text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 1).join(', ') : 'an unnamed chain') + ' · ' + (WATCHLIST[r.slug] ? 'watchlist' : 'early') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          bandBar,
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtMoney2(e.slice) }),
        el('td', { class: 'num ' + (e.net >= 0 ? 'pos' : 'neg'), text: fmtMoney2(e.net) }),
        el('td', { class: 'num', text: fmtBe(e.be) }),
        el('td', { class: 'num ' + (e.netHour >= 0 ? 'pos' : 'neg'), text: fmtMoney2(e.netHour) }),
        el('td', null, el('span', { class: 'verdict ' + verdictClass(e.verdict), text: e.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest first. Slice, net, break-even, net/hour: the farm math at a $' + state.deposit.toLocaleString('en-US') + ' deposit — select a row for its full page. The bar under each value is its P10–P90 band on a log scale. Board and board.json carry the same ' + DATA.board_size + ' rows, ranks, values and bands.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('slice', 'Slice if launch'),
            sortHeader('net', 'Net if launch'),
            sortHeader('be', 'Break-even'),
            sortHeader('netHour', 'Net / hour'),
            sortHeader('verdict', 'Farm verdict')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market caps are the comparables the model calibrates from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function categoryChart() {
    var totals = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      totals[c] = (totals[c] || 0) + r.implied_value_usd;
    });
    var top = Object.keys(totals).map(function (c) { return { category: c, total: totals[c] }; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 8);
    var max = top.length ? top[0].total : 1;
    return el('section', { class: 'panel chart' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { text: 'Total implied value of the ranked pre-token protocols, by category. Risk curators and RWA dominate this snapshot because a few very large protocols in them record no token.' }),
      top.map(function (t) {
        return el('div', { class: 'chart-row' },
          el('span', { class: 'cat', text: t.category }),
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((t.total / max) * 100)) + '%' })),
          el('span', { class: 'val', text: fmtUsd(t.total) })
        );
      })
    );
  }

  // The five fastest-growing rows among the top fifty by implied value: momentum inside the board.
  function movers() {
    var top = DATA.rows.slice(0, 50).filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined; })
      .sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    return el('section', { class: 'panel chart movers' },
      el('h2', { text: 'Fastest growing in the top 50' }),
      el('p', { text: 'Seven-day TVL growth among the fifty strongest rows. A fast-growing row is the one whose window is opening now.' }),
      top.map(function (r) {
        return el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'mover-name', text: '#' + r.rank + ' ' + r.name }),
          el('span', { class: 'num pos', text: fmtPct(r.change_7d) }),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        );
      })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var pl = DATA.power_law || { intercept: 3.0247, slope: 0.5223 };
    var compRows = (DATA.category_multiples || []).slice(0, 12);
    var compBody = el('tbody');
    compRows.forEach(function (c) {
      compBody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: (c.tilt >= 1 ? '+' : '') + Math.round((c.tilt - 1) * 1000) / 10 + '%' + ' (' + c.tilt.toFixed(3) + 'x)' }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.median_raw === null ? 'n/a' : (c.median_raw >= 0 ? '+' : '') + c.median_raw.toFixed(3) + ' dex' }),
        el('td', { text: tiltNote(c) })
      ));
    });
    // Thin evidence, in one line: the tilts are shrunk hard toward 1.00x, so a thin
    // category barely moves the curve — the board never quietly leans on it.
    var all = DATA.category_multiples || [];
    var thin = all.filter(function (c) { return c.live_count < 5; }).length;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Category tilts used' }),
      el('p', { text: 'Each category tilts the power-law curve by its median log-residual among live tokens, shrunk hard toward zero (prior weight ' + m.prior_weight + '): a category with one live token barely moves the curve; fifteen speak for themselves. The curve is value = 10^(' + pl.intercept.toFixed(2) + ' + ' + pl.slope.toFixed(2) + ' × log10 TVL + tilt). The formula, the curve fit and the validation are at the top of the page.' }),
      el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; it sets the farm plan\u2019s hold, not the value. Maturity and chain count were tested as value terms and removed — both made leave-one-out worse. The early radar is every pre-token protocol below the watchlist floor that is not a wrapped, staked or bridged product of a token that already trades, and the live-token protocols are set aside with their market caps shown.' }),
      thin ? el('p', { class: 'warn inline', text: 'Thin evidence: ' + thin + ' of ' + all.length + ' categories rest on fewer than 5 live comparables — their tilts are shrunk hard toward 1.00x, so they barely move the curve. Treat rows in those categories as the least certain on this board.' }) : null,
      el('h3', { text: 'Category tilts used (top 12 by tilt)' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Tilt used' }),
            el('th', { scope: 'col', text: 'Live comparables' }),
            el('th', { scope: 'col', text: 'Raw median resid' }),
            el('th', { scope: 'col', text: 'Note' })
          )),
          compBody
        )
      )
    );
  }

  // A row's detail as a full page, not a popup: the value decomposition, the record in the
  // snapshot, the deposit-size table, the nearest traded tokens and the 12-week farm plan.
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }
  function detailPage(row) {
    var e1 = econAt(row, 1000);
    var e10 = econAt(row, 10000);
    var stat = function (label, value, cls) { return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { class: cls || '', text: value })); };
    var steps = row.farm_steps || [];
    var entry = categoryEntry(row.category);
    var thin = thinInfo(entry);
    var gaps = planGaps(row);
    var calText = null;
    if (thin.thin) {
      calText = 'Calibration warning: ' + (row.category || 'this category') + "'s tilt is " + tiltNote(entry) + '. Its implied value leans on thin calibration, so rank it below rows with the same value from a well-backed category.';
    }
    var pl = DATA.power_law || { intercept: 3.0247, slope: 0.5223 };
    var sizeCurve = Math.pow(10, pl.intercept + pl.slope * Math.log10(row.tvl_usd));
    var netEq = fmtUsd(row.tvl_usd) + ' TVL → curve ' + fmtUsd(sizeCurve) + ' × tilt ' + (row.category_tilt === undefined ? 1 : row.category_tilt).toFixed(3) + '× × growth ' + (row.growth_multiplier === undefined ? 1 : row.growth_multiplier).toFixed(3) + '× = ' + fmtUsd(row.implied_value_usd);
    var depRow = function (label, v1, v10) {
      return el('tr', null, el('td', { text: label }), el('td', { class: 'num', text: v1 }), el('td', { class: 'num', text: v10 }));
    };
    var kvRow = function (label, value) {
      return el('tr', null, el('td', { text: label }), el('td', { class: 'num', text: value }));
    };
    var compBody = el('tbody');
    (row.comparables || []).forEach(function (c) {
      compBody.appendChild(el('tr', null,
        el('td', { text: c.name }),
        el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }),
        el('td', { class: 'num', text: fmtUsd(c.curve_usd) }),
        el('td', { class: 'num', text: fmtRatio(c.miss === undefined ? c.ratio : c.miss) })
      ));
    });
    return el('div', null,
      el('button', { class: 'button', type: 'button', text: '← Back to the board', onclick: closeDetail }),
      el('section', { class: 'lede detail-lede' },
        el('div', { class: 'lede-main' },
          el('h1', { text: row.name }),
          el('p', { text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · ' + (WATCHLIST[row.slug] ? 'watchlist' : 'early') + ' · no token for ' + fmtAge(row.age_days) })
        ),
        el('div', { class: 'stats' },
          stat('Implied value', fmtUsd(row.implied_value_usd)),
          stat('Slice if launch', fmtMoney2(e1.slice)),
          stat('Net if launch', fmtMoney2(e1.net), e1.net >= 0 ? 'pos' : 'neg'),
          stat('Break-even', fmtBe(e1.be)),
          stat('Net per hour', fmtMoney2(e1.netHour), e1.netHour >= 0 ? 'pos' : 'neg'),
          el('div', { class: 'stat' }, el('span', { text: 'Farm verdict' }), el('b', null, el('span', { class: 'verdict ' + verdictClass(e1.verdict), text: e1.verdict })))
        )
      ),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-col' },
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'How the value is built' }),
            el('p', { class: 'net-equation', text: netEq }),
            el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ' scores every protocol with the same function. Recomputed here as ' + fmtUsd(impliedOf(row, DATA.model)) + (Math.abs(impliedOf(row, DATA.model) - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.001) ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
          ),
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Record in the snapshot' }),
            el('div', { class: 'table-wrap' },
              el('table', { class: 'kv' },
                el('tbody', null,
                  kvRow('TVL', fmtUsd(row.tvl_usd)),
                  kvRow('Seven-day change', fmtPct(row.change_7d)),
                  kvRow('Listed', row.listed_at || 'no listing date on record'),
                  kvRow('Category', row.category || 'Other')
                )
              )
            )
          ),
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Deposit size' }),
            el('p', { class: 'net-equation', text: 'Slice ' + fmtMoney2(e1.slice) + ' − gas ' + fmtMoney2(e1.fees) + ' − forgone ' + fmtMoney2(e1.forgone) + ' = net ' + fmtMoney2(e1.net) + ' · ' + fmtMoney2(e1.netHour) + '/h · break-even ' + fmtBe(e1.be) }),
            el('p', { text: 'Gas doesn\u2019t scale with the deposit — a bigger deposit clears break-even sooner.' }),
            el('div', { class: 'table-wrap' },
              el('table', null,
                el('thead', null, el('tr', null, el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', text: '$1,000' }), el('th', { scope: 'col', text: '$10,000' }))),
                el('tbody', null,
                  depRow('Slice if the token launches', fmtMoney2(e1.slice), fmtMoney2(e10.slice)),
                  depRow('Gas over 12 weeks', fmtMoney2(e1.fees), fmtMoney2(e10.fees)),
                  depRow('Yield forgone', fmtMoney2(e1.forgone), fmtMoney2(e10.forgone)),
                  depRow('Net if launch', fmtMoney2(e1.net), fmtMoney2(e10.net)),
                  depRow('Break-even launch odds', fmtBe(e1.be), fmtBe(e10.be)),
                  depRow('Net per active hour', fmtMoney2(e1.netHour), fmtMoney2(e10.netHour)),
                  depRow('Farm verdict', e1.verdict, e10.verdict)
                )
              )
            )
          ),
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Nearest traded tokens' }),
            el('p', { text: 'The live tokens closest to this row by TVL, mostly in the same category. "Curve says" is what the model would price them at; "miss" is how far the curve sits from the market — the median miss across all ' + (DATA.validation ? DATA.validation.live_n : '') + ' live tokens is ×' + (DATA.validation ? DATA.validation.loo_median_miss : '') + '.' }),
            el('div', { class: 'table-wrap' },
              el('table', null,
                el('thead', null, el('tr', null,
                  el('th', { scope: 'col', text: 'Protocol' }),
                  el('th', { scope: 'col', text: 'TVL' }),
                  el('th', { scope: 'col', text: 'Market cap' }),
                  el('th', { scope: 'col', text: 'Curve says' }),
                  el('th', { scope: 'col', text: 'Miss' })
                )),
                compBody
              )
            )
          )
        ),
        el('div', { class: 'detail-col' },
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Farm plan — 12 weeks' }),
            el('div', { class: 'timeline' },
              el('span', { text: 'Week 0 · set up' }),
              el('span', { text: 'Weeks 1–12 · act + check weekly' }),
              el('span', { text: 'Day ' + row.hold_days + ' · hold ends' }),
              el('span', { text: 'Week 12 · claim + log' })
            ),
            el('ol', { class: 'steps' }, steps.map(function (s) {
              var at = s.indexOf(' Cost: ');
              var action = at >= 0 ? s.slice(0, at) : s;
              var tail = at >= 0 ? s.slice(at + 1) : '';
              return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
            })),
            el('p', { class: 'sub', text: 'Assumptions: a 10% airdrop share paid pro-rata by deposit share of TVL, gas per transaction from the chain, yield forgone at a 4% risk-free rate over the hold, 4.6 active hours across the 12 weeks.' })
          ),
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'How much to trust this row' }),
            el('p', { class: 'sub', text: 'Confidence ' + (row.confidence === undefined ? 'n/a' : row.confidence + ' / 100') + ': the record behind this row and the live comparables behind its tilt. ' + (gaps.length === 0
              ? 'Farm plan complete: age, seven-day growth, chain and category are all on record, so no step leans on a fallback.'
              : 'Farm plan partial: ' + gaps.join('; ') + '.') }),
            (row.p10_usd && row.p90_usd) ? el('p', { class: 'sub', text: 'Uncertainty: P25–P75 ' + fmtUsd(row.p25_usd) + '–' + fmtUsd(row.p75_usd) + ', P10–P90 ' + fmtUsd(row.p10_usd) + '–' + fmtUsd(row.p90_usd) + '. The band comes from the leave-one-out errors (σ ' + (DATA.validation ? DATA.validation.band_sigma_dex : '') + ' dex) — it holds ' + (DATA.validation ? DATA.validation.band_p25_hold_pct : '') + '% of live tokens at P25–P75 and ' + (DATA.validation ? DATA.validation.band_p90_hold_pct : '') + '% at P10–P90.' }) : null,
            (row.rank_lo && row.rank_hi) ? el('p', { class: 'sub', text: 'Rank range across 200 bootstrap refits: #' + row.rank_lo + '–#' + row.rank_hi + '; top 20 in ' + row.top20_pct + '% of refits.' }) : null,
            calText ? el('p', { class: 'warn inline', text: calText }) : null
          ),
          row.signals && row.signals.length ? el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Signals' }),
            el('div', { class: 'signals flat' }, row.signals.map(function (s) { return el('span', { class: 'signal', text: s }); }))
          ) : null
        )
      )
    );
  }

  // The full method page: validation, ablation, the big curve fit, every category tilt,
  // and the limits — the page the methodology panel points at.
  function closeMethod() {
    state.method = false;
    writeHash();
    render();
  }
  function methodPage() {
    var v = DATA.validation || {};
    var m = DATA.model;
    var pl = DATA.power_law || { intercept: 3.0247, slope: 0.5223 };
    var vrow = function (test, miss, within3, within2) {
      return el('tr', null,
        el('td', { text: test }),
        el('td', { class: 'num', text: miss === null || miss === undefined ? 'n/a' : miss + 'x' }),
        el('td', { class: 'num', text: within3 === null || within3 === undefined ? 'n/a' : within3 + '%' }),
        el('td', { class: 'num', text: within2 === null || within2 === undefined ? 'n/a' : within2 + '%' })
      );
    };
    var abBody = el('tbody');
    (v.ablation || []).forEach(function (a) {
      abBody.appendChild(el('tr', null,
        el('td', { text: a.label }),
        el('td', { class: 'num', text: a.loo_median_miss === null ? 'n/a' : a.loo_median_miss + 'x' }),
        el('td', { class: 'num', text: a.loo_within3_pct === null ? 'n/a' : a.loo_within3_pct + '%' }),
        el('td', { class: 'num', text: a.wf_median_miss === null ? 'n/a' : a.wf_median_miss + 'x' }),
        el('td', { class: 'num', text: a.wf_within3_pct === null ? 'n/a' : a.wf_within3_pct + '%' }),
        el('td', { text: a.kept ? 'Kept' : 'Rejected' }),
        el('td', { text: a.note })
      ));
    });
    var tiltBody = el('tbody');
    (DATA.category_multiples || []).forEach(function (c) {
      tiltBody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: (c.tilt >= 1 ? '+' : '') + Math.round((c.tilt - 1) * 1000) / 10 + '%' + ' (' + c.tilt.toFixed(3) + 'x)' }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.median_raw === null ? 'n/a' : (c.median_raw >= 0 ? '+' : '') + c.median_raw.toFixed(3) + ' dex' }),
        el('td', { text: tiltNote(c) })
      ));
    });
    var worst = (v.worst_loo || []).map(function (w) {
      return el('li', { text: w.name + ': the curve says ' + fmtUsd(w.pred_usd) + ', the market says ' + fmtUsd(w.actual_usd) + ' — a ×' + w.miss + ' miss.' });
    });
    return el('div', null,
      el('button', { class: 'button', type: 'button', text: '← Back to the board', onclick: closeMethod }),
      el('section', { class: 'lede detail-lede' },
        el('div', { class: 'lede-main' },
          el('h1', { text: 'The method, in full' }),
          el('p', { text: 'Every number below is computed from this snapshot at run time — nothing here is hand-written. The rule for keeping a model rung: it must beat the flat TVL multiple in leave-one-out AND walk-forward. Everything that failed that test is listed as rejected, with its numbers.' })
        ),
        el('div', { class: 'stats' },
          el('div', { class: 'stat' }, el('span', { text: 'Live tokens tested' }), el('b', { text: String(v.live_n) })),
          el('div', { class: 'stat' }, el('span', { text: 'LOO median miss' }), el('b', { text: '×' + v.loo_median_miss })),
          el('div', { class: 'stat' }, el('span', { text: 'Flat LOO median miss' }), el('b', { text: '×' + v.flat_loo_median_miss })),
          el('div', { class: 'stat' }, el('span', { text: 'Walk-forward median miss' }), el('b', { text: '×' + v.wf_median_miss }))
        )
      ),
      el('section', { class: 'panel method-page' },
        el('h2', { text: 'The formula' }),
        el('p', { class: 'net-equation', text: 'implied = round(10^(' + pl.intercept.toFixed(2) + ' + ' + pl.slope.toFixed(2) + ' × log10(TVL) + tilt) × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 × ' + m.growth_weight + '))' }),
        el('p', { text: 'The power law is an ordinary least-squares fit of log10(market cap) on log10(TVL) over the snapshot\u2019s ' + v.live_n + ' live tokens (intercept ' + pl.intercept.toFixed(4) + ', slope ' + pl.slope.toFixed(4) + '). A slope below 1 means value grows sublinearly with TVL. The tilt is a category\u2019s median log-residual, shrunk toward zero with prior weight ' + m.prior_weight + ': (n × median) / (n + ' + m.prior_weight + '). Growth is the seven-day TVL change, clamped to ' + m.growth_floor + '%…+' + m.growth_cap + '%, at weight ' + m.growth_weight + '.' })
      ),
      el('section', { class: 'panel method-page' },
        el('h2', { text: 'The curve fit' }),
        html(scatterSvg(680, 240)),
        el('p', { class: 'legend' },
          el('span', { class: 'dot live' }), ' Live tokens, at market cap  ',
          el('span', { class: 'dot pre' }), ' Pre-token rows, at implied value  ',
          el('span', { class: 'dot curve' }), ' Fitted curve'
        ),
        el('p', { class: 'sub', text: 'Both axes log scale. The dashed line is y = ' + pl.intercept.toFixed(2) + ' + ' + pl.slope.toFixed(2) + ' × x. A flat multiple would be a line of slope 1 — the market does not sit on it.' })
      ),
      el('section', { class: 'panel method-page' },
        el('h2', { text: 'The validation' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Test' }),
              el('th', { scope: 'col', text: 'Median miss' }),
              el('th', { scope: 'col', text: 'Within 3x' }),
              el('th', { scope: 'col', text: 'Within 2x' })
            )),
            el('tbody', null,
              vrow('LOO n=' + v.live_n, v.loo_median_miss, v.loo_within3_pct, v.loo_within2_pct),
              vrow('Flat TVL (LOO)', v.flat_loo_median_miss, v.flat_loo_within3_pct, null),
              vrow('Walk-fwd n=' + v.wf_n, v.wf_median_miss, v.wf_within3_pct, null),
              vrow('Flat walk-fwd', v.flat_wf_median_miss, v.flat_wf_within3_pct, null)
            )
          )
        ),
        el('p', { class: 'sub', text: 'LOO predicts each live token from a calibration that never saw it; walk-forward trains on the ' + (v.wf_n ? 'earlier-listed half' : 'earlier half') + ' (before ' + v.wf_cutoff + ') and tests on the later half. Uncertainty bands from the leave-one-out log-errors (σ ' + v.band_sigma_dex + ' dex): P25–P75 (×/÷' + v.band_p25_factor + ') holds ' + v.band_p25_hold_pct + '% of live tokens; P10–P90 (×/÷' + v.band_p90_factor + ') holds ' + v.band_p90_hold_pct + '%.' })
      ),
      el('section', { class: 'panel method-page' },
        el('h2', { text: 'What was tried — and what was rejected' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Model rung' }),
              el('th', { scope: 'col', text: 'LOO median' }),
              el('th', { scope: 'col', text: 'LOO within 3x' }),
              el('th', { scope: 'col', text: 'WF median' }),
              el('th', { scope: 'col', text: 'WF within 3x' }),
              el('th', { scope: 'col', text: 'Verdict' }),
              el('th', { scope: 'col', text: 'Why' })
            )),
            abBody
          )
        ),
        el('p', { class: 'sub', text: 'Every rung is the same two tests — leave-one-out over ' + v.live_n + ' live tokens and walk-forward over ' + v.wf_n + '. A rung is kept only when it beats the flat baseline on both.' })
      ),
      el('section', { class: 'panel method-page' },
        el('h2', { text: 'Every category tilt' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Category' }),
              el('th', { scope: 'col', text: 'Tilt used' }),
              el('th', { scope: 'col', text: 'Live comparables' }),
              el('th', { scope: 'col', text: 'Raw median resid' }),
              el('th', { scope: 'col', text: 'Note' })
            )),
            tiltBody
          )
        )
      ),
      el('section', { class: 'panel method-page' },
        el('h2', { text: 'Limits' }),
        el('ul', { class: 'limits' },
          el('li', { text: 'Only ' + v.live_n + ' live tokens calibrate the model, and the fit is loose (R² ≈ 0.19): the median miss is still ×' + v.loo_median_miss + '. Do not read an implied value as a price.' }),
          el('li', { text: 'Validation uses market caps of tokens that already trade; generalising to pre-token protocols assumes the same TVL-to-value relation holds until those tokens launch — untested until they do.' }),
          el('li', { text: 'The fit is from the snapshot of ' + DATA.as_of + '; a new snapshot refits it from its own live tokens.' }),
          worst.length ? el('li', null, 'Worst leave-one-out misses: ', el('ul', null, worst)) : null
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.method) {
      shell.appendChild(methodPage());
    } else if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) shell.appendChild(detailPage(row));
      else { state.selected = null; }
    }
    if (!state.selected && !state.method) {
      shell.appendChild(lede());
      shell.appendChild(methodology());
      shell.appendChild(controls());
      if (state.tab === 'pre-token') {
        if (filtered()) shell.appendChild(farmBook(sortedRows(rows())));
        shell.appendChild(boardTable());
        var lower = el('div', { class: 'lower' }, categoryChart(), movers());
        shell.appendChild(lower);
        shell.appendChild(modelPanel());
      } else {
        shell.appendChild(liveTable());
      }
    }
    shell.appendChild(el('p', { class: 'note', text: 'Source: DefiLlama public protocol index, snapshot ' + DATA.as_of + '. "No token" means the snapshot records none, not that the protocol has none. Implied values are this radar\u2019s own model, not a price and not a prediction that a token will be issued.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();
