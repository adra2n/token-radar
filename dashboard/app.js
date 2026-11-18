// Token Radar's page. It reads window.RADAR, written beside dashboard/ by main.ts from the same
// board.json, and renders the ranked board, a filterable table and a per-protocol detail view.
// No network, no framework, no clock: every figure comes from the dataset, and every implied value
// is recomputed here from the row's own TVL, growth and age so the page and the board agree.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  var M = D.model;
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: '', chain: '', sort: 'rank', asc: true, watchlist: false, open: null };

  // ---------------------------------------------------------------- formatting

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '<span class="muted">n/a</span>';
    var cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'muted';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }

  function days(n) {
    if (n === null || n === undefined) return '<span class="muted">n/a</span>';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    if (n >= 60) return Math.round(n / 30) + 'mo';
    return Math.round(n) + 'd';
  }

  function mult(n) { return '×' + n.toFixed(2); }

  // ---------------------------------------------------------------- the model, in the page

  // The same arithmetic lib/model.ts runs, from the row's own figures: no value is trusted, each is
  // rebuilt and compared with the one board.json carries.
  function recompute(row) {
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * M.growth_weight;
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var seasonMult = M.season_floor + (Math.min(Math.max(age, 0), M.season_days) / M.season_days) * M.season_range;
    var implied = Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * seasonMult));
    return { growth: growth, growthMult: growthMult, seasonMult: seasonMult, implied: implied };
  }

  // ---------------------------------------------------------------- the shell

  var maxImplied = Math.max.apply(null, D.rows.map(function (r) { return r.implied_value_usd; }));

  $('ver').textContent = D.model_version;
  $('meta').innerHTML =
    'Snapshot <b>' + esc(D.as_of) + '</b> · ' + D.protocol_count + ' protocols tracked · floor ' + usd(D.floor_usd) +
    ' · board rebuilt from the same snapshot on every run';

  $('lede').innerHTML =
    'DefiLlama\'s snapshot records <b>' + D.protocol_count + ' protocols</b>. <b>' + D.board_size + '</b> of them record no token and are ' +
    'not a wrapped, staked, bridged or exchange-run product of one that trades, so each is still to come. Each is priced from its own ' +
    'TVL at the median multiple the live tokens in its category trade at, then moved by its seven-day growth and by how long it has run ' +
    'with no token. The watchlist\'s ' + D.watchlist_size + ' are all on the board; the other ' + D.early_size + ' are protocols the radar ' +
    'found below it.';

  $('kpis').innerHTML = [
    kpi('Protocols ranked', D.board_size, 'of ' + D.protocol_count + ' tracked'),
    kpi('Watchlist covered', D.watchlist_size + ' / ' + D.watchlist_size, 'every slug, no gaps'),
    kpi('Combined implied value', usd(D.total_implied_usd), 'across the ranked board'),
    kpi('Median live multiple', mult(D.median_multiple), 'market cap over TVL', true)
  ].join('');

  function kpi(label, value, sub, accent) {
    return '<dl class="kpi' + (accent ? ' accent' : '') + '"><dt>' + esc(label) + '</dt><dd>' + esc(value) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</dd></dl>';
  }

  // ---------------------------------------------------------------- filters

  var cats = [];
  var chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();

  $('cat').innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' +
    chains.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); paint(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; paint(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; paint(); });
  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.asc = state.sort === 'rank' || state.sort === 'name';
    paint();
  });
  $('wl').addEventListener('change', function (e) { state.watchlist = e.target.checked; paint(); });

  function matches(r) {
    if (state.watchlist && !r.watchlist) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (state.q) {
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  function ordered(rows) {
    var key = state.sort;
    var out = rows.slice();
    out.sort(function (a, b) {
      var d;
      if (key === 'name') d = a.name.localeCompare(b.name);
      else if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'tvl') d = b.tvl_usd - a.tvl_usd;
      else if (key === 'change') d = (b.change_7d || 0) - (a.change_7d || 0);
      else if (key === 'age') d = (b.age_days || 0) - (a.age_days || 0);
      else d = b.multiple - a.multiple;
      return state.asc ? d : -d;
    });
    return out;
  }

  function paint() {
    var rows = ordered(D.rows.filter(matches));
    $('count').textContent = rows.length + ' of ' + D.rows.length + ' protocols';
    $('empty').hidden = rows.length > 0;
    $('rows').innerHTML = rows.map(rowHtml).join('');
  }

  function rowHtml(r) {
    var width = Math.max(1.5, (r.implied_value_usd / maxImplied) * 100);
    var star = r.watchlist ? '<span class="star" title="on the snapshot\'s watchlist">\u2605</span> ' : '';
    var chips = '<span class="chip">' + esc(r.category || 'unclassified') + '</span>';
    var chain = r.chains.length === 0 ? '<span class="muted">n/a</span>'
      : esc(r.chains[0]) + (r.chains.length > 1 ? ' <span class="muted">+' + (r.chains.length - 1) + '</span>' : '');
    return '<tr data-slug="' + esc(r.slug) + '" class="' + (r.rank <= 3 ? 'lead' : '') + '">' +
      '<td class="num rank">' + r.rank + '</td>' +
      '<td><span class="name">' + star + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + chips + '</td>' +
      '<td>' + chain + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num muted">' + days(r.age_days) + '</td>' +
      '<td class="num"><span class="mult">' + mult(r.multiple) + '</span></td>' +
      '<td class="num"><span class="implied">' + usd(r.implied_value_usd) + '</span></td>' +
      '<td class="barcol"><span class="bar"><i style="width:' + width.toFixed(1) + '%"></i></span></td>' +
      '</tr>';
  }

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#p/' + tr.getAttribute('data-slug');
  });

  // ---------------------------------------------------------------- detail view

  function find(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }

  function peersOf(r) {
    return D.live.filter(function (p) { return p.category === r.category; })
      .sort(function (a, b) { return b.mcap_usd - a.mcap_usd; })
      .slice(0, 6);
  }

  function detailHtml(r) {
    var m = recompute(r);
    var peers = peersOf(r);
    var peerRows = peers.length === 0
      ? '<p class="sectionnote">No live token in this category, so the all-market median prices it.</p>'
      : '<table class="grid small"><thead><tr><th>Live comparable</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">×TVL</th></tr></thead><tbody>' +
        peers.map(function (p) {
          return '<tr class="static"><td>' + esc(p.name) + '</td><td class="num">' + usd(p.mcap_usd) +
            '</td><td class="num muted">' + usd(p.tvl_usd) + '</td><td class="num">' + mult(p.multiple) + '</td></tr>';
        }).join('') + '</tbody></table>';

    return '<div class="detailcard">' +
      '<div class="detailtop"><div class="row1">' +
        '<span class="chip">rank ' + r.rank + ' of ' + D.board_size + '</span>' +
        '<h2>' + esc(r.name) + '</h2>' +
        '<a class="back" href="#">← back to the board</a>' +
      '</div>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'unclassified') + ' · ' + esc(r.chains.join(', ') || 'chain not recorded') +
        ' · records no token' + (r.watchlist ? ' · on the watchlist' : ' · found below the watchlist floor') + '</p></div>' +

      '<div class="detailgrid"><div>' +
        '<div class="bignums">' +
          big('TVL', usd(r.tvl_usd)) +
          big('Implied value', usd(r.implied_value_usd), true) +
          big('Category multiple', mult(r.multiple)) +
        '</div>' +
        '<h3>The arithmetic</h3>' +
        '<div class="equation">' +
          eq('TVL on record', 'snapshot, ' + esc(D.as_of), usd(r.tvl_usd)) +
          eq('× category multiple', r.peers + ' live peer' + (r.peers === 1 ? '' : 's') + ' in ' + esc(r.category || 'the market') + ', shrunk to the market median', mult(r.multiple)) +
          eq('× seven-day growth', pct(r.change_7d) + ' clamped to ' + M.growth_floor + '..' + M.growth_cap + '%, at ' + M.growth_weight + ' of the move', '×' + m.growthMult.toFixed(3)) +
          eq('× seasoning', (r.age_days === null ? M.unknown_age_days + 'd assumed' : days(r.age_days) + ' with no token') + ', out of ' + M.season_days + 'd', '×' + m.seasonMult.toFixed(3)) +
          eq('= implied value', 'recomputed here; board.json says ' + usd(r.implied_value_usd), '<b>' + usd(m.implied) + '</b>') +
        '</div>' +
        '<p class="sectionnote">Rank ' + r.rank + ' of ' + D.board_size + ': ' + (r.rank - 1) + ' rows price higher, ' + (D.board_size - r.rank) + ' lower.</p>' +
        '<h3 style="margin-top:20px">The comparables behind the multiple</h3>' + peerRows +
      '</div>' +

      '<div class="peers"><h3>Farm it in six steps</h3>' +
        '<p class="sectionnote">Costs are the model\'s estimate for one position at this protocol\'s size; times are what a single person needs.</p>' +
        '<ol class="steps">' + r.farm.map(function (s) {
          return '<li><p>' + esc(s.text) + '</p><div class="costtime"><span class="tag cost">' + esc(s.cost) +
            '</span><span class="tag">' + esc(s.time) + '</span></div></li>';
        }).join('') + '</ol>' +
      '</div></div></div>';
  }

  function big(label, value, accent) {
    return '<dl class="bignum' + (accent ? ' accent' : '') + '"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></dl>';
  }

  function eq(label, note, value) {
    return '<div class="eqline"><span>' + esc(label) + '</span><code>' + note + '</code><b>' + value + '</b></div>';
  }

  // ---------------------------------------------------------------- model + set-aside panels

  $('formula').innerHTML =
    'implied = <em>tvl_usd</em> × <em>multiple(category)</em> × (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 × ' + M.growth_weight + ')' +
    ' × (' + M.season_floor + ' + min(age_days, ' + M.season_days + ') / ' + M.season_days + ' × ' + M.season_range + ')\n' +
    'multiple(category) = median(mcap / tvl of that category\'s live tokens, winsorised ' + M.ratio_floor + '..' + M.ratio_cap + '),' +
    ' shrunk toward the market median (' + mult(D.median_multiple) + ') by ' + M.shrink_peers + ' pseudo-peers, clamped ' + M.multiple_floor + '..' + M.multiple_cap;

  $('factors').innerHTML =
    item('TVL on record', 'The protocol\'s own TVL in the snapshot, in whole dollars. It is the base: a launch is worth a multiple of what the protocol already holds.') +
    item('Its category\'s multiple', 'The median of market cap over TVL among live tokens in the same category. Categories with a deep comparable set keep their own multiple; a category with one comparable is pulled back to the market median.') +
    item('Seven-day growth, at a third', 'A week of TVL growth moves the estimate by a third of the move, clamped to ' + M.growth_floor + ' to ' + M.growth_cap + ' per cent, so one good week cannot dominate a launch.') +
    item('Seasoning', 'Days since DefiLlama started tracking it, capped at ' + M.season_days + ' days: ' + M.season_floor + ' at day one rising to ' + (M.season_floor + M.season_range) + ' at four years. A protocol with no start date is scored at ' + M.unknown_age_days + ' days.');

  function item(title, body) { return '<dt>' + esc(title) + '</dt><dd>' + esc(body) + '</dd>'; }

  $('cats').innerHTML = D.categories.slice(0, 14).map(function (c) {
    return '<tr class="static"><td>' + esc(c.name) + '</td><td class="num muted">' + c.peers + '</td><td class="num muted">' +
      mult(c.median_multiple) + '</td><td class="num">' + mult(c.multiple) + '</td><td class="num muted">' + c.rows + '</td></tr>';
  }).join('');

  $('asidehint').textContent = D.set_aside_size + ' protocols in the snapshot record no token and are still not a launch: they are the wrapped, ' +
    'staked, bridged or exchange-run form of a token that already trades, or a versioned pool of one. The board sets them aside and says why.';
  $('asideRows').innerHTML = D.set_aside.map(function (p) {
    return '<tr class="static"><td><span class="name">' + esc(p.name) + '</span><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td><span class="chip">' + esc(p.category || 'unclassified') + '</span></td>' +
      '<td class="num muted">' + usd(p.tvl_usd) + '</td>' +
      '<td class="reason">' + esc(p.reason) + '</td></tr>';
  }).join('');

  $('foot').textContent = 'Source: ' + D.source + '. Model ' + D.model_version + ', run on the sealed snapshot of ' + D.as_of +
    '. The board, the page and this text are written by the same program in one run.';

  // ---------------------------------------------------------------- routing

  function route() {
    var hash = location.hash.replace(/^#/, '');
    if (hash.indexOf('p/') === 0) {
      var row = find(decodeURIComponent(hash.slice(2)));
      if (row) {
        state.open = row.slug;
        $('detail').innerHTML = detailHtml(row);
        $('detail').hidden = false;
        $('board').hidden = true;
        document.querySelector('.hero').hidden = true;
        window.scrollTo(0, 0);
        return;
      }
    }
    if (hash) {
      // Filters can be set from the address, so a view can be linked and screenshotted.
      var params = {};
      hash.split('&').forEach(function (pair) {
        var i = pair.indexOf('=');
        if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      });
      if (params.q !== undefined) { state.q = params.q.toLowerCase(); $('q').value = params.q; }
      if (params.cat) { state.cat = params.cat; $('cat').value = params.cat; }
      if (params.chain) { state.chain = params.chain; $('chain').value = params.chain; }
      if (params.wl === '1') { state.watchlist = true; $('wl').checked = true; }
      if (params.sort) { state.sort = params.sort; $('sort').value = params.sort; }
    }
    state.open = null;
    $('detail').hidden = true;
    $('board').hidden = false;
    document.querySelector('.hero').hidden = false;
    paint();
  }

  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.open) location.hash = '';
  });
  route();
})();
