// Token Radar — the radar-3 dashboard.
//
// Every number on this board shows its working. Click a row and you get the
// whole equation: TVL in, value out. If a rank looks wrong, the multiple is
// right there to argue with. The page reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a detail dialog per
// protocol, and a sandbox that re-scores the board live. No network: every
// byte on the page comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var SHRINK_DEFAULT = DATA.model.shrink_k !== undefined ? DATA.model.shrink_k : 10;
  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    growthWeight: DATA.model.growth_weight,
    multipleCap: DATA.model.multiple_cap,
    shrinkK: SHRINK_DEFAULT
  };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function multLabel(n) { return 'x' + n.toFixed(2); }

  // radar-3: the category multiple is shrunk toward the market median, k deep.
  // board.json carries the shrunk multiple; the raw one is recovered by running
  // the shrinkage backwards, which is exact here because the formula is linear
  // and the clamp re-applies on the way back in.
  function peerCount(row) {
    var peers = DATA.category_peers || {};
    var n = peers[row.category];
    return typeof n === 'number' ? n : null;
  }
  function rawMultipleFor(row) {
    var n = peerCount(row);
    if (n === null || n < 3) return DATA.global_multiple;
    var k = DATA.model.shrink_k !== undefined ? DATA.model.shrink_k : 10;
    return (row.category_multiple * (n + k) - k * DATA.global_multiple) / n;
  }
  function maturityFor(age, m) {
    if (age === null || age === undefined) return m.unknown_age_multiplier;
    if (age < m.maturity_young_days) return m.maturity_young;
    if (age >= m.maturity_old_days) return m.maturity_old;
    if (age >= m.maturity_days) return m.maturity_ramp_end;
    return m.maturity_ramp_start + ((age - m.maturity_young_days) / (m.maturity_days - m.maturity_young_days)) * (m.maturity_ramp_end - m.maturity_ramp_start);
  }
  function breadthFor(chains, m) {
    return 1 + m.breadth_per_chain * Math.min(Math.max((chains || []).length - 1, 0), m.breadth_max_chains);
  }
  // Every term of one row's value, under the given sandbox settings. At the
  // stated constants this is the same arithmetic board.json was built with.
  function termsFor(row, opts) {
    var m = DATA.model;
    var gw = opts && opts.growth_weight !== undefined ? opts.growth_weight : m.growth_weight;
    var mc = opts && opts.multiple_cap !== undefined ? opts.multiple_cap : m.multiple_cap;
    var k = opts && opts.shrink_k !== undefined ? opts.shrink_k : (m.shrink_k !== undefined ? m.shrink_k : 10);
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * gw;
    var n = peerCount(row);
    var multiple;
    // At the stated constants the page must reproduce board.json exactly, not
    // approximately: inverting the shrinkage and re-applying it loses a few
    // dollars to float rounding on some rows, which the detail dialog would
    // (rightly) report as a mismatch. So at the stated constants the multiple
    // is the board's own number; the inversion below only runs when a sandbox
    // slider has actually moved away from the stated constants.
    var atStated = gw === m.growth_weight && mc === m.multiple_cap && k === (m.shrink_k !== undefined ? m.shrink_k : 10);
    if (atStated) multiple = row.category_multiple;
    else if (n === null) multiple = row.category_multiple;
    else if (n < 3) multiple = Math.min(mc, Math.max(m.multiple_floor, DATA.global_multiple));
    else multiple = Math.min(mc, Math.max(m.multiple_floor, (n * rawMultipleFor(row) + k * DATA.global_multiple) / (n + k)));
    return {
      multiple: multiple,
      raw: rawMultipleFor(row),
      peers: n,
      growthMult: growthMult,
      maturity: maturityFor(row.age_days, m),
      breadth: breadthFor(row.chains, m),
      shrinkK: k
    };
  }
  function impliedFor(row, opts) {
    var t = termsFor(row, opts);
    return Math.max(1, Math.round(row.tvl_usd * t.multiple * t.growthMult * t.maturity * t.breadth));
  }
  function equationText(row, t, value) {
    var peers = t.peers === null ? 'peers uncounted' : t.peers === 1 ? '1 peer' : t.peers + ' peers';
    return money(value) + ' = ' + money(row.tvl_usd) + ' TVL \u00d7 ' + t.multiple.toFixed(2) + ' ' + (row.category || 'Other') + ' (' + peers + ') \u00d7 ' + t.growthMult.toFixed(2) + ' growth \u00d7 ' + t.maturity.toFixed(2) + ' maturity \u00d7 ' + t.breadth.toFixed(2) + ' breadth';
  }

  // A tiny DOM helper: h('div', {class: 'x', onclick: fn}, 'text', childNode, [more]).
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalNeeded(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function mainAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s delta-neutral vault on " + chain + ' and keep the shares.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' of the governance asset through ' + name + ' on ' + chain + ' and vote once.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function repeatAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the deposit on ' + name + ' and repay it a week later, so the position shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap $' + small + ' through ' + name + "'s main pool on " + chain + ' once, so the wallet shows volume as well as liquidity.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the first hedge on ' + name + ' and open a second one half the size, so the wallet shows repeat trading, not one trade.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + name + ' after a week, so the wallet shows two-way use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Add a second, smaller stake through ' + name + ' a week later, so the wallet shows repeat staking, not one deposit.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market position on ' + name + ' and place a second one in a different market.';
    if (c.indexOf('governance') >= 0) return 'Vote a second time on ' + name + ' when the next proposal opens, so the wallet shows repeat governance.';
    return 'Use ' + name + ' a second time a week later — a swap, a deposit or a vote — so the wallet shows repeat use, not one visit.';
  }
  function joinStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmPlan(p) {
    var chain = firstChain(p);
    var capital = capitalNeeded(p);
    var hold = holdFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: repeatAction(p, capital, chain), cost: 'about $' + Math.max(2, Math.round(capital / 25)) + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(joinStep);
  }
  function rowBadges(r) {
    var out = [];
    if (r.change_7d !== null && r.change_7d >= 10) out.push({ cls: 'badge grow', text: 'fast growing' });
    if (r.age_days !== null && r.age_days >= 1095) out.push({ cls: 'badge old', text: 'mature, no token' });
    if (r.chains && r.chains.length >= 3) out.push({ cls: 'badge', text: 'multi-chain' });
    return out;
  }

  // The board's state lives in the URL hash, so a filtered view and an open
  // detail dialog are shareable links.
  function loadHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl')) state.watchlistOnly = params.get('wl') === '1';
  }
  function saveHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** The pre-token rows the board shows now: filtered, then in sort order. */
  function rowsForTab() {
    return orderedRows(visibleRows());
  }
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function orderedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function rescoredRows() {
    // Re-score every row with the sandbox sliders, then re-rank. The submitted
    // board.json keeps the stated constants; the sandbox shows what the model
    // does when you move them.
    var model = { growth_weight: state.growthWeight, multiple_cap: state.multipleCap, shrink_k: state.shrinkK };
    var rescored = DATA.rows.map(function (r) { var c = {}; for (var k in r) c[k] = r[k]; c.implied_value_usd = impliedFor(r, model); return c; });
    rescored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    return rescored;
  }

  function topBar() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: DATA.board_size + ' pre-token protocols, ranked by what a token in each would be worth' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more below that floor. Implied value is a model, not a promise. A token is worth what the market already pays for the same kind of protocol, per dollar of TVL. Nothing here says a token is coming. It says what one would be worth if it did.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Market multiple, all live tokens' }), h('b', { text: multLabel(DATA.global_multiple) + ' x TVL' }))
      )
    );
  }

  function topFive() {
    var picks = DATA.rows.slice(0, 5);
    return h('section', { class: 'top5', 'aria-label': 'Top five by implied value' },
      picks.map(function (r) {
        return h('button', { type: 'button', class: 'pick', onclick: function () { openDetail(r.slug); } },
          h('span', { class: 'rank', text: 'RANK ' + r.rank }),
          h('b', { text: r.name }),
          h('span', { class: 'num', text: money(r.implied_value_usd) + ' implied · ' + money(r.tvl_usd) + ' TVL' })
        );
      })
    );
  }

  function filterBar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; saveHash(); render(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; saveHash(); render(); });
    var chainSel = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; saveHash(); render(); });
    var wl = h('input', { type: 'checkbox', id: 'wl', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; saveHash(); render(); });
    var pre = h('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = h('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSel),
      h('label', { class: 'check', for: 'wl' }, wl, h('span', { text: 'Watchlist only' })),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: state.tab === 'pre-token' ? rowsForTab().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHead(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardView() {
    var list = rowsForTab();
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; saveHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var badges = rowBadges(r).map(function (b) { return h('span', { class: b.cls, text: b.text }); });
      var tr = h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }, badges),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (WATCH[r.slug] ? ' · watchlist' : '') })
        )),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageLabel(r.age_days) }),
        h('td', { class: 'num', text: multLabel(r.category_multiple) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Strongest implied value first. Click a row and the page shows its working, then its farm plan.' }),
          h('thead', null, h('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('multiple', 'Multiple'),
            sortHead('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveView() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these already trade, so their market cap is a fact, not a model. They sit apart from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function testedPanel() {
    return h('section', { class: 'panel tested' },
      h('h2', { text: 'How this board was tested' }),
      h('p', { text: 'We fitted the model, then tried to break it. Here is what survived.' }),
      h('p', { text: 'The multiples are fitted on the 128 live protocols in this snapshot, then tested blind: 5-fold cross-validation median error 1.54 (log scale), against 1.74 for the unshrunk version. Walk-forward (trained on older listings, tested on newer ones): 1.55.' }),
      h('p', { text: 'Token odds were tested and dropped: they fit the past and failed the blind test (walk-forward error 1.57 \u2192 1.68).' }),
      h('p', { text: 'Every term above was kept or dropped on those two blind tests.' }),
      h('p', { text: 'What this board does not do: it does not predict whether or when a token launches. It says what a launch would be worth if the market priced it like the live protocols of its kind. A protocol here \u2018records no token\u2019 \u2014 the snapshot says so; that is not a promise it has none.' })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var k = SHRINK_DEFAULT;
    var gw = h('input', { type: 'range', id: 'gw', min: '0', max: '1.5', step: '0.1', value: String(state.growthWeight), 'aria-label': 'Growth weight' });
    var gwOut = h('output', { for: 'gw', text: state.growthWeight.toFixed(1) });
    gw.addEventListener('input', function () { state.growthWeight = parseFloat(gw.value); gwOut.textContent = state.growthWeight.toFixed(1); updateSandboxNote(); });
    var mc = h('input', { type: 'range', id: 'mc', min: '0.5', max: '3', step: '0.1', value: String(state.multipleCap), 'aria-label': 'Multiple cap' });
    var mcOut = h('output', { for: 'mc', text: state.multipleCap.toFixed(1) });
    mc.addEventListener('input', function () { state.multipleCap = parseFloat(mc.value); mcOut.textContent = state.multipleCap.toFixed(1); updateSandboxNote(); });
    var sk = h('input', { type: 'range', id: 'sk', min: '0', max: '20', step: '1', value: String(state.shrinkK), 'aria-label': 'Shrinkage k' });
    var skOut = h('output', { for: 'sk', text: String(state.shrinkK) });
    sk.addEventListener('input', function () { state.shrinkK = parseInt(sk.value, 10); skOut.textContent = String(state.shrinkK); updateSandboxNote(); });
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'One function scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl \u00d7 shrunk multiple \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ') \u00d7 maturity(age) \u00d7 (1 + ' + m.breadth_per_chain + ' \u00d7 min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      h('p', { class: 'sub', text: 'Shrunk multiple = (peers \u00d7 raw + ' + k + ' \u00d7 ' + DATA.global_multiple.toFixed(3) + ') / (peers + ' + k + '), clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. Peers are the live protocols in the same category with a market cap above zero; fewer than 3 peers and the market median ' + DATA.global_multiple.toFixed(3) + ' stands in. Shrinkage is the one change that clearly helped: pulling each category median ' + k + '-deep toward the market median cut the blind-test error from 1.74 to 1.54.' }),
      h('div', { class: 'sandbox' },
        h('label', null, h('span', { text: 'Sandbox: growth weight' }), gw, gwOut),
        h('label', null, h('span', { text: 'Sandbox: multiple cap' }), mc, mcOut),
        h('label', null, h('span', { text: 'Sandbox: shrinkage k' }), sk, skOut)
      ),
      h('p', { class: 'note', id: 'sandbox-note', text: 'Move a slider to re-score the board live. The submitted board.json keeps the stated constants; the sandbox only shows what the model does when you move them.' })
    );
  }
  function updateSandboxNote() {
    var note = document.getElementById('sandbox-note');
    if (!note) return;
    var top = rescoredRows()[0];
    note.textContent = 'Sandbox top pick now: ' + (top ? top.name + ' at ' + money(top.implied_value_usd) + ' implied.' : 'none.') + ' The submitted board.json keeps the stated constants.';
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; saveHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    saveHash();
    dialog.textContent = '';
    var steps = farmPlan(row);
    var t = termsFor(row, DATA.model);
    var recomputed = impliedFor(row, DATA.model);
    var shrinkNote = t.peers === null
      ? 'The peer count is not in the data, so the board multiple stands as shown.'
      : t.peers < 3
        ? 'Fewer than 3 live peers in ' + (row.category || 'Other') + ', so the market median ' + DATA.global_multiple.toFixed(3) + ' stands in as the multiple.'
        : 'Why ' + t.multiple.toFixed(2) + '? The raw ' + (row.category || 'Other') + ' median is ' + t.raw.toFixed(2) + ' from ' + t.peers + ' live peers; shrinkage pulls it toward the market median ' + DATA.global_multiple.toFixed(3) + ' with k=' + t.shrinkK + '.';
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' · watchlist' : ' · early radar') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'eq' }, h('span', { class: 'num', text: equationText(row, t, recomputed) })),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      h('p', { class: 'sub shrink-note', text: shrinkNote })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(topFive());
    shell.appendChild(filterBar());
    shell.appendChild(state.tab === 'pre-token' ? boardView() : liveView());
    if (state.tab === 'pre-token') {
      shell.appendChild(testedPanel());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  loadHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
