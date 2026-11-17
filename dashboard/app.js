// Token Radar's dashboard, radar-3. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board with its farm economics, the methodology panel with the model's
// own validation, a filterable table, a per-protocol full detail page with the model's own
// inputs, the deposit-size table, the nearest traded tokens and the farm plan, plus a category
// chart, the fastest growers and the comparable multiples the model calibrated from the
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
    if (!r.category) gaps.push('no category on record, so the value uses the overall multiple');
    return gaps;
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(age, model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chain = 1 + model.chain_step * Math.min((row.chains || []).length - 1, model.chain_max_extra);
    var multiple = row.category_multiple === undefined ? DATA.overall_multiple : row.category_multiple;
    return Math.max(1, Math.round(row.tvl_usd * multiple * (1 + (growth / 100) * model.growth_weight) * maturity * chain));
  }
  function categoryEntry(category) {
    var found = (DATA.category_multiples || []).filter(function (c) { return c.category === category; })[0];
    return found || null;
  }
  function clampInfo(entry, m) {
    if (!entry) return { clamped: null, thin: false };
    var clamped = entry.multiple >= m.multiple_cap && entry.median_raw !== null && entry.median_raw > m.multiple_cap ? 'cap'
      : entry.multiple <= m.multiple_floor && entry.median_raw !== null && entry.median_raw < m.multiple_floor ? 'floor' : null;
    return { clamped: clamped, thin: entry.live_count < m.thin_evidence };
  }
  function clampNote(entry, m) {
    if (!entry) return 'overall multiple ' + DATA.overall_multiple + 'x, no live comparable in this category';
    var info = clampInfo(entry, m);
    if (info.clamped === 'cap') return 'held to the ' + m.multiple_cap.toFixed(2) + 'x cap';
    if (info.clamped === 'floor') return 'held to the ' + m.multiple_floor.toFixed(2) + 'x floor';
    if (info.thin) return 'thin evidence: only ' + entry.live_count + ' live comparable' + (entry.live_count === 1 ? '' : 's');
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

  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', watchlistOnly: false, earlyOnly: false, planOnly: false, verdict: 'all', deposit: 1000, sort: 'implied', dir: -1, selected: null };

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
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
    return el('section', { class: 'lede' },
      el('div', { class: 'lede-main' },
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by a tested value model' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus ' + DATA.early_size + ' below it — each row carries its farm math at a $1,000 deposit.' })
      ),
      el('div', { class: 'stats' },
        stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        stat('Pre-token rows scored', String(DATA.board_size)),
        stat('Total implied value', fmtUsd(DATA.total_implied_usd)),
        stat('Worth farming at $1,000', String(worth)),
        stat('Overall market multiple', DATA.overall_multiple + 'x TVL'),
        stat('Live-token set aside', String(DATA.live_size))
      )
    );
  }

  // The methodology panel: how a value is built, the curve fit on a scatter, and the
  // validation table with the honest numbers — computed from this snapshot at run time.
  function methodology() {
    var v = DATA.validation || {};
    var m = DATA.model;
    var formula = 'implied = round(tvl_usd × category_multiple × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ')/' + m.maturity_days + ' × ' + m.maturity_range + ') × (1 + ' + m.chain_step + ' × min(chains - 1, ' + m.chain_max_extra + ')))';
    var verdict = 'The multiple is a rough compass, not a price; the board\u2019s edge is the farm math below.';
    // Log-log scatter: live tokens at their market cap, pre-token rows at their implied value,
    // against the fitted curve y = log10(overall multiple) + x.
    var W = 340, H = 120, L = 34, R = 6, T = 6, B = 20;
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
            el('li', null, el('b', { text: 'Size curve. ' }), 'Each category\u2019s multiple is the median market cap per $TVL among its live tokens, shrunk toward ' + DATA.overall_multiple + 'x, clamped to ' + m.multiple_floor + 'x\u2013' + m.multiple_cap + 'x.'),
            el('li', null, el('b', { text: 'Growth carry. ' }), 'The last 7 days of TVL growth move the value, capped at ' + m.growth_floor + '% to +' + m.growth_cap + '%, at weight ' + m.growth_weight + '.'),
            el('li', null, el('b', { text: 'Seasoning and reach. ' }), 'A token-less year costs up to ' + Math.round((1 - m.maturity_floor) * 100) + '% of value; each extra chain adds ' + Math.round(m.chain_step * 100) + '%, up to ' + m.chain_max_extra + ' extra chains.')
          ),
          el('div', { class: 'formula' }, formula)
        ),
        el('div', { class: 'method-col' },
          el('h3', { text: 'The curve fit' }),
          html(svg),
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
                vrow('Walk-fwd n=' + v.wf_n, v.wf_median_miss, v.wf_within3_pct, null)
              )
            )
          ),
          el('p', { class: 'sub', text: 'LOO predicts each live token from a calibration that never saw it; walk-forward trains before ' + v.wf_cutoff + ', tests after.' })
        )
      ),
      el('p', { class: 'method-verdict', text: verdict })
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
    var tbody = el('tbody');
    list.forEach(function (r) {
      var e = econAt(r, state.deposit);
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankClass = r.rank === 1 ? 'r1' : r.rank === 2 ? 'r2' : r.rank === 3 ? 'r3' : '';
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
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
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
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest first. Slice, net, break-even, net/hour: the farm math at a $' + state.deposit.toLocaleString('en-US') + ' deposit — select a row for its full page.' }),
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
    var compRows = (DATA.category_multiples || []).slice(0, 12);
    var compBody = el('tbody');
    compRows.forEach(function (c) {
      compBody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.median_raw === null ? 'n/a' : c.median_raw.toFixed(3) + 'x' }),
        el('td', { text: clampNote(c, m) })
      ));
    });
    // One line per category the clamp or the thin evidence touches, in plain words,
    // so the board never quietly leans on a multiple the snapshot barely supports.
    var warnings = (DATA.category_multiples || []).map(function (c) {
      var info = clampInfo(c, m);
      if (!info.clamped && !info.thin) return null;
      var bits = c.category + ': the multiple used is ' + c.multiple.toFixed(3) + 'x';
      if (info.clamped === 'cap') bits += ', held to the ' + m.multiple_cap.toFixed(2) + 'x cap although the raw median of its live comparables is ' + (c.median_raw === null ? 'unlisted' : c.median_raw.toFixed(3) + 'x');
      if (info.clamped === 'floor') bits += ', held to the ' + m.multiple_floor.toFixed(2) + 'x floor although the raw median of its live comparables is ' + (c.median_raw === null ? 'unlisted' : c.median_raw.toFixed(3) + 'x');
      bits += ', backed by only ' + c.live_count + ' live comparable' + (c.live_count === 1 ? '' : 's');
      return bits + ' — treat its implied values as the least certain on this board.';
    }).filter(function (w) { return w !== null; });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Category multiples used' }),
      el('p', { text: 'Each category gets its own TVL multiple, calibrated from the live-token protocols in this snapshot: the median market-cap-to-TVL of that category, shrunk toward the overall median of ' + DATA.overall_multiple + 'x (prior weight ' + m.prior_weight + ') and clamped to ' + m.multiple_floor + 'x-' + m.multiple_cap + 'x, so one wild outlier cannot decide a whole board. The formula, the curve fit and the validation are at the top of the page.' }),
      el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The chain term rewards reach across chains. The early radar is every pre-token protocol below the watchlist floor that is not a wrapped, staked or bridged product of a token that already trades, and the live-token protocols are set aside with their market caps shown.' }),
      warnings.length ? el('div', { class: 'warn' },
        el('h3', { text: 'Calibration warnings: thin or clamped categories' }),
        el('ul', null, warnings.map(function (w) { return el('li', { text: w }); }))
      ) : null,
      el('h3', { text: 'Category multiples used (top 12 by multiple)' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Multiple used' }),
            el('th', { scope: 'col', text: 'Live comparables' }),
            el('th', { scope: 'col', text: 'Raw median' }),
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
    var cal = entry ? clampInfo(entry, DATA.model) : { clamped: null, thin: false };
    var gaps = planGaps(row);
    var calText = null;
    if (cal.clamped || cal.thin) {
      calText = 'Calibration warning: ' + (row.category || 'this category') + "'s multiple is " + clampNote(entry, DATA.model);
      if (cal.clamped === 'cap' && entry.median_raw !== null) calText += ' — the raw median of its live comparables is ' + entry.median_raw.toFixed(3) + 'x, far above the cap';
      calText += '. Its implied value leans on thin calibration, so rank it below rows with the same value from a well-backed category.';
    }
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
        el('td', { class: 'num', text: fmtRatio(c.ratio) })
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
            el('div', { class: 'equation' },
              el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
              el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: (row.category_multiple === undefined ? DATA.overall_multiple : row.category_multiple).toFixed(3) + 'x' })),
              el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
              el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
              el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
              el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
              el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: 'x' + (row.chain_multiplier === undefined ? 1 : row.chain_multiplier) })),
              el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
            ),
            el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and the protocol records no token: it may still have one the snapshot does not carry.' })
          ),
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Record in the snapshot' }),
            el('div', { class: 'table-wrap' },
              el('table', { class: 'kv' },
                el('tbody', null,
                  kvRow('TVL', fmtUsd(row.tvl_usd)),
                  kvRow('Seven-day change', fmtPct(row.change_7d)),
                  kvRow('Listed', row.listed_at || 'no listing date on record'),
                  kvRow('Category', row.category || 'Other'),
                  kvRow('Token on record', 'none'),
                  kvRow('Market cap', 'none'),
                  kvRow('Gecko id', 'none'),
                  kvRow('Symbol', 'none')
                )
              )
            )
          ),
          el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Deposit size' }),
            el('p', { text: 'The same farm at two deposit sizes. The slice and the forgone yield scale with the deposit; gas does not, so a bigger deposit clears break-even sooner.' }),
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
            el('p', { text: 'The live tokens closest to this row by TVL, mostly in the same category. "Curve says" is what the model would price them at; "actual ÷ curve" shows how far the market sits from the curve.' }),
            el('div', { class: 'table-wrap' },
              el('table', null,
                el('thead', null, el('tr', null,
                  el('th', { scope: 'col', text: 'Protocol' }),
                  el('th', { scope: 'col', text: 'TVL' }),
                  el('th', { scope: 'col', text: 'Market cap' }),
                  el('th', { scope: 'col', text: 'Curve says' }),
                  el('th', { scope: 'col', text: 'Actual ÷ curve' })
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
            el('p', { class: 'sub', text: 'Confidence ' + (row.confidence === undefined ? 'n/a' : row.confidence + ' / 100') + ': the record behind this row and the live comparables behind its multiple. ' + (gaps.length === 0
              ? 'Farm plan complete: age, seven-day growth, chain and category are all on record, so no step leans on a fallback.'
              : 'Farm plan partial: ' + gaps.join('; ') + '.') }),
            calText ? el('p', { class: 'warn inline', text: calText }) : null
          ),
          row.profile ? el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'What it is' }),
            el('p', { text: row.profile })
          ) : null,
          row.thesis ? el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Value thesis' }),
            el('p', { class: 'thesis', text: row.thesis })
          ) : null,
          row.signals && row.signals.length ? el('section', { class: 'panel chart detail-sec' },
            el('h2', { text: 'Signals' }),
            el('div', { class: 'signals flat' }, row.signals.map(function (s) { return el('span', { class: 'signal', text: s }); }))
          ) : null
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) shell.appendChild(detailPage(row));
      else { state.selected = null; }
    }
    if (!state.selected) {
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
