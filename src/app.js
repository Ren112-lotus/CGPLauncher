import {marked} from '../node_modules/marked/lib/marked.esm.js';
import {icon} from './icons.js';
const api = window.launcher;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

$$('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const scopes = {all:'すべてのゲーム', installed:'インストール済み', favorites:'お気に入り', recent:'最近プレイしたゲーム'};
let state, selected = null, webId = null;
let scope = 'all', filter = 'browser', tag = '', query = '', sort = 'name';
let loadedDetails = new Set(), loadingDetails = new Set(), detailKey = '';
const systemTheme = await api.systemTheme();
const game = id => state.games.find(g => g.id === id);
const webModal = $('#web-modal');
let sidebarCollapsed = false;
let appUpdate = null;
let webURL = '', previousVolume = 100;
let webMaximized = false;

function updateBusyReason() {
  if (Object.keys(state?.jobs || {}).length) return 'ゲームのダウンロードが完了すると更新できます。';
  if (state?.running?.length) return '実行中のゲームを終了すると更新できます。';
  if (webId) return 'Unity Roomを閉じると更新できます。';
  return '';
}
function renderAppUpdate() {
  if (!appUpdate) return;
  const {status, version, percent, error, currentVersion, lastChecked} = appUpdate;
  const busy = updateBusyReason();
  const messages = {
    idle: lastChecked ? '最新版です' : '',
    checking: '更新を確認中…',
    downloading: `v${version} をダウンロード中… ${Math.floor(percent)}%`,
    downloaded: `v${version} · 更新できます`,
    installing: '再起動中…',
    error,
    unsupported: '開発版'
  };
  $('#app-version').textContent = `v${currentVersion}`;
  $('#update-status').textContent = [messages[status], status === 'downloaded' ? (error || busy) : ''].filter(Boolean).join(' ');
  $('#update-status').hidden = !$('#update-status').textContent;
  $('#update-check').disabled = ['checking','downloading','downloaded','installing','unsupported'].includes(status);
  $('#update-check').textContent = status === 'error' ? '再試行' : '更新を確認';
  for (const id of ['#update-progress','#update-banner-progress']) {
    $(id).hidden = status !== 'downloading';
    $(id).value = percent;
  }
  for (const id of ['#update-install-settings','#update-install-banner']) {
    $(id).hidden = status !== 'downloaded' && status !== 'installing';
    $(id).disabled = !!busy || status === 'installing';
    $(id).title = busy;
  }
  const showBanner = !state.settings.autoUpdate && ['downloaded','installing'].includes(status) || status === 'error' && !!version;
  $('#update-banner').hidden = !showBanner;
  $('#update-banner-title').textContent = messages[status] || '';
  $('#update-banner-hint').textContent = status === 'downloaded' ? busy : '';
  $('#update-banner-hint').hidden = !$('#update-banner-hint').textContent;
  $('#update-retry').hidden = status !== 'error';
  $('#toasts').classList.toggle('bottom-6', !showBanner);
  $('#toasts').classList.toggle('bottom-52', showBanner);
}

function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = collapsed;
  $('#app-layout').dataset.sidebarCollapsed = String(collapsed);
  const button = $('#sidebar-toggle');
  const label = collapsed ? 'サイドバーを表示' : 'サイドバーを非表示';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon(collapsed ? 'sidebar-open' : 'sidebar-close');
  $('#sidebar').inert = collapsed;
  $('#sidebar').setAttribute('aria-hidden', String(collapsed));
}
$('#sidebar-toggle').onclick = () => setSidebarCollapsed(!sidebarCollapsed);

function toast(message, error = false) {
  const el = document.createElement('div');
  el.className = 'max-w-[430px] rounded-none border border-input-line bg-side px-4 py-3 text-sm text-ink shadow-dialog';
  if (error) el.classList.add('text-danger');
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? 9000 : 5000);
}
const safe = fn => async (...args) => {
  try { return await fn(...args); }
  catch (error) { toast(error.message?.includes('aborted') ? 'ダウンロードを中止しました。' : error.message || String(error), true); }
};
function image(g, kind = 'game-icon') {
  return `<div class="${kind}">${g.image ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" loading="lazy" referrerpolicy="no-referrer">` : icon('game')}</div>`;
}
document.addEventListener('error', event => {
  const img = event.target;
  if (img.tagName !== 'IMG') return;
  if (img.closest('.game-icon,.game-cover')) img.replaceWith(document.createRange().createContextualFragment(icon('game')));
  else if (img.classList.contains('hero-image')) img.remove();
}, true);
function label(g) {
  if (state.running.includes(g.id)) return '実行中';
  if (state.jobs[g.id]) return state.jobs[g.id].stage;
  if (g.unityroomurl) return 'プレイ';
  return state.settings.installed[g.id] ? 'プレイ' : 'ダウンロード';
}
function playButton(g) {
  const busy = state.jobs[g.id] || state.running.includes(g.id);
  const installed = state.settings.installed[g.id];
  return `<button class="${g.unityroomurl ? 'web-button' : 'primary'} ${installed && !g.unityroomurl ? 'installed' : ''}" data-play="${g.id}" ${busy ? 'disabled' : ''}>${icon(g.unityroomurl || installed ? 'play' : 'download')}${esc(label(g))}</button>`;
}
function filtered() {
  const q = query.trim().normalize('NFKC').toLocaleLowerCase();
  return state.games.filter(g =>
    (scope !== 'installed' || state.settings.installed[g.id]) &&
    (scope !== 'favorites' || state.settings.favorites.includes(g.id)) &&
    (scope !== 'recent' || state.settings.history[g.id]) &&
    (filter !== 'browser' || g.unityroomurl) &&
    (filter !== 'desktop' || g.githuburl) &&
    (!tag || g.tags.includes(tag)) &&
    (!q || [g.name, ...g.authors, ...g.tags, g.description].join(' ').normalize('NFKC').toLocaleLowerCase().includes(q))
  ).sort((a,b) => sort === 'recent'
    ? (state.settings.history[b.id]?.lastPlayed || 0) - (state.settings.history[a.id]?.lastPlayed || 0)
    : sort === 'author'
      ? a.authors.join().localeCompare(b.authors.join(), 'ja') || a.name.localeCompare(b.name, 'ja')
      : a.name.localeCompare(b.name, 'ja', {sensitivity:'base'}));
}
function row(g) {
  const running = state.running.includes(g.id);
  return `<button class="game-row" data-detail="${g.id}" aria-current="${g.id === selected}" title="${esc(g.name)}">
    ${image(g)}
    <span class="min-w-0 flex-1"><span class="game-name">${esc(g.name)}</span>${g.authors.length ? `<span class="game-author">${esc(g.authors.join(', '))}</span>` : ''}</span>
    ${running ? '<span class="absolute top-2 right-2 size-2 rounded-none bg-emerald-400"></span>' : ''}
    ${state.jobs[g.id] ? `<span class="absolute right-3 bottom-1 text-xs text-blue-300">${state.jobs[g.id].percent}%</span>` : ''}
  </button>`;
}
function card(g) {
  const d = state.details[g.id], fav = state.settings.favorites.includes(g.id);
  return `<article class="game-card">
    <button class="block w-full" data-detail="${g.id}" aria-label="${esc(g.name)}の詳細">${image(g, 'game-cover')}</button>
    <div class="card-body">
      <button class="card-title" data-detail="${g.id}">${esc(g.name)}</button>
      ${g.authors.length ? `<p class="m-0! truncate text-xs text-muted">${esc(g.authors.join(', '))}</p>` : ''}
      <div class="card-platform">${g.unityroomurl ? 'Unity Room' : esc(d?.release?.tag_name || 'Windows')}</div>
      ${g.tags.length ? `<div class="flex flex-wrap gap-1">${g.tags.map(t => `<button class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="card-actions">${playButton(g)}<button class="icon-button ml-auto" data-favorite="${g.id}" aria-label="お気に入り" aria-pressed="${fav}">${icon('heart')}</button></div>
    </div>
  </article>`;
}
function markdown(md,base){
  const doc=new DOMParser().parseFromString(window.DOMPurify.sanitize(marked.parse(md),{FORBID_TAGS:['style','form','input','button','iframe','video','audio'],FORBID_ATTR:['style']}),'text/html');
  doc.querySelectorAll('img').forEach(img=>{try{const u=new URL(img.getAttribute('src'),base);if(u.protocol!=='https:')throw Error();img.src=u.href;img.setAttribute('referrerpolicy','no-referrer');img.loading='lazy';}catch{img.remove();}});
  doc.querySelectorAll('a').forEach(a=>{try{let value=a.getAttribute('href');let target;if(value?.startsWith('#')){a.removeAttribute('href');return;}if(!/^[a-z]+:/i.test(value)&&base.includes('raw.githubusercontent.com')){const u=new URL(base);const segments=u.pathname.split('/');target=new URL(value,`https://github.com/${segments[1]}/${segments[2]}/blob/${segments.slice(3).join('/')}`).href;}else target=new URL(value,base).href;if(new URL(target).protocol!=='https:')throw Error();a.href=target;}catch{a.removeAttribute('href');}});
  return doc.body.innerHTML;
}

function renderDetail() {
  const g = game(selected);
  if (!g) { $('#detail-screen').innerHTML = ''; return; }
  const d = state.details[g.id], item = state.settings.installed[g.id], release = d?.release;
  const job = state.jobs[g.id], running = state.running.includes(g.id), fav = state.settings.favorites.includes(g.id);
  const update = item?.version && release?.tag_name && item.version !== release.tag_name;
  // Preserve the current button and focus when unrelated background work updates.
  const key = JSON.stringify([g, d, item, job, running, fav, loadingDetails.has(g.id)]);
  if (detailKey === key) return;
  detailKey = key;
  $('#detail-screen').innerHTML = `
    <section class="detail-hero">
      ${g.image ? `<img class="hero-image" src="${esc(g.image)}" alt="" referrerpolicy="no-referrer">` : `<div class="absolute inset-0 flex items-center justify-center text-white/30 [&_svg]:size-24">${icon('game')}</div>`}
      <div class="hero-shade"></div>
      <div class="hero-content">
        <h1 class="hero-title">${esc(g.name)}</h1>
        <div class="hero-meta">
          <span class="platform-badge">${g.unityroomurl ? 'Unity Room' : 'Windows' + (release?.tag_name ? ' · ' + esc(release.tag_name) : '')}</span>
          ${g.authors.length ? `<span class="hero-author">${icon('user')}${esc(g.authors.join(', '))}</span>` : ''}
        </div>
        ${g.tags.length ? `<div class="hero-tags">${g.tags.map(t => `<button class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      </div>
    </section>
    <div class="detail-actions">
      ${playButton(g)}
      ${g.githuburl ? `<button class="secondary" data-url="${esc(g.githuburl)}">${icon('external')}GitHub</button>` : ''}
      <div class="ml-auto flex items-center gap-2">
        ${item ? `<button class="icon-button" data-folder="${g.id}" title="ゲームのフォルダを開く" aria-label="ゲームのフォルダを開く">${icon('folder')}</button>` : ''}
        <button class="icon-button" data-favorite="${g.id}" title="お気に入り" aria-label="お気に入り" aria-pressed="${fav}">${icon('heart')}</button>
      </div>
    </div>
    ${job ? `<div class="px-6 pt-5 text-sm text-blue-300">${esc(job.stage)} ${job.percent}%<progress class="mt-2 block h-1.5 w-full overflow-hidden rounded-none" value="${job.percent}" max="100"></progress><button class="text-button" data-cancel="${g.id}">ダウンロードを中止</button></div>` : ''}
    ${update ? `<p class="notice px-6">新しいバージョン ${esc(release.tag_name)} があります。 <button class="text-button" data-update="${g.id}" ${job || running ? 'disabled' : ''}>更新をダウンロード ↗</button></p>` : ''}
    ${g.description || g.githuburl ? `<div class="detail-info"><section>
      <div class="detail-info-heading"><h2>ゲーム情報</h2>${g.githuburl ? `<button class="icon-button" data-retry="${g.id}" title="READMEを再読み込み" aria-label="READMEを再読み込み">${icon('refresh')}</button>` : ''}</div>
      ${g.description ? `<p class="detail-description">${esc(g.description)}</p>` : ''}
      ${g.githuburl ? `<div class="markdown ${g.description ? 'mt-5' : ''}">${d?.readme ? markdown(d.readme, d.base) : `<p class="notice">${loadingDetails.has(g.id) ? 'READMEを読み込んでいます…' : esc(d?.readmeError || '詳細情報を読み込んでいます…')}</p>`}</div>${d?.error ? `<p class="notice">${esc(d.error)}</p>` : ''}` : ''}
    </section></div>` : ''}
  `;
}
function render() {
  document.documentElement.dataset.theme = state.settings.theme === 'system' ? systemTheme : state.settings.theme;
  const games = filtered(), list = state.settings.view === 'list';
  if (!games.some(g => g.id === selected)) selected = games[0]?.id || null;
  $('#grid-view').classList.toggle('selected', !list);
  $('#list-view').classList.toggle('selected', list);
  $('#grid-view').setAttribute('aria-pressed', String(!list));
  $('#list-view').setAttribute('aria-pressed', String(list));
  const listScroll = $('#game-list').scrollTop;
  $('#game-list').innerHTML = list ? games.map(row).join('') : '';
  $('#game-list').hidden = !list;
  $('#game-list').scrollTop = listScroll;
  $('#sidebar-empty').hidden = !list || !!games.length;
  $('#detail-screen').hidden = !list || !games.length;
  $('#library-screen').hidden = list || !games.length;
  $('#game-grid').innerHTML = list ? '' : games.map(card).join('');
  $('#empty').hidden = !!games.length;
  if (list) renderDetail();
  const summary = [scope !== 'all' ? scopes[scope] : '', filter !== 'all' ? (filter === 'browser' ? 'Unity Room' : 'Windows') : '', tag ? '#' + tag : ''].filter(Boolean).join(' · ');
  $('#filter-summary').hidden = !summary;
  $('#filter-label').textContent = summary;
  if (list && selected && game(selected)?.githuburl && !loadedDetails.has(selected)) loadDetails(selected);
  renderAppUpdate();
}
async function loadDetails(id, force = false) {
  if (loadingDetails.has(id)) return;
  loadedDetails.add(id); loadingDetails.add(id); renderDetail();
  try { state.details[id] = await api.details(id, force); }
  catch (error) { toast(error.message, true); }
  finally { loadingDetails.delete(id); if (selected === id) renderDetail(); }
}
async function detail(id) {
  selected = id; detailKey = '';
  if (state.settings.view !== 'list') await api.settings({view:'list'});
  render(); $('#main').scrollTop = 0;
  $(`#game-list [data-detail="${id}"]`)?.scrollIntoView({block:'nearest'});
}
function choose(title, items, note) {
  return new Promise(resolve => {
    const dialog = $('#choice-dialog');
    $('#choice-title').textContent = title;
    $('#choice-body').innerHTML = (note ? `<p class="text-sm leading-relaxed text-muted">${esc(note)}</p>` : '') + items.map((x,n) => `<button class="mb-2 block w-full rounded-none border border-input-line p-4 text-left hover:bg-raised" data-choice="${n}">${esc(x.label)}${x.sub ? `<small class="mt-2 block text-muted">${esc(x.sub)}</small>` : ''}</button>`).join('');
    const done = value => { dialog.close(); $('#choice-body').onclick = null; dialog.oncancel = null; $('#choice-close').onclick = null; resolve(value); };
    $('#choice-body').onclick = e => { const el = e.target.closest('[data-choice]'); if (el) done(items[Number(el.dataset.choice)].value); };
    $('#choice-close').onclick = () => done(null);
    dialog.oncancel = e => { e.preventDefault(); done(null); };
    dialog.showModal();
  });
}
async function install(id) {
  const d = await api.details(id); state.details[id] = d;
  const assets = d.release?.assets || [];
  if (!assets.length) { toast('Windows用ZIPが見つかりません。GitHubの配布ページを確認してください。', true); await detail(id); return; }
  let asset = assets[0];
  if (assets.length > 1) {
    const answer = await choose('ダウンロードするファイル', assets.map(a => ({label:a.name, sub:`${(a.size/1024**2).toFixed(1)} MB`, value:a.id})), 'Windows用のビルドを選んでください。');
    if (answer === null) return;
    asset = assets.find(a => a.id === answer);
  }
  toast(`${game(id).name} をダウンロードします。`);
  const item = await api.install(id, asset.id); toast('ダウンロードが完了しました。');
  if (!item.exe && item.candidates?.length) {
    const answer = await choose('起動する実行ファイル', item.candidates.map(exe => ({label:exe,value:exe})), 'ゲームの実行ファイルを選択してください。');
    if (answer) await api.selectExe(id, answer);
  }
}
async function play(id) {
  const g = game(id);
  if (state.jobs[id] || state.running.includes(id)) return;
  if (g.unityroomurl) return openWeb(id);
  if (!state.settings.installed[id]) return install(id);
  const result = await api.launch(id);
  if (result?.choose) {
    const answer = await choose('起動する実行ファイル', result.choose.map(exe => ({label:exe,value:exe})));
    if (answer) { await api.selectExe(id, answer); await api.launch(id); }
  }
}
function webBounds() {
  const r = $('#web-host').getBoundingClientRect();
  return {x:r.x, y:r.y, width:r.width, height:r.height};
}
async function updateBounds() { if (webId && webModal.open) await api.webBounds(webBounds()); }
function setWebMaximized(maximized) {
  webMaximized = maximized;
  webModal.dataset.maximized = String(maximized);
  const button = $('#web-maximize');
  const label = maximized ? 'ゲーム画面を元のサイズに戻す' : 'ゲーム画面を最大化';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(maximized));
  button.innerHTML = icon(maximized ? 'restore' : 'maximize');
  return updateBounds();
}
async function openWeb(id) {
  if (webId) await closeWeb();
  await setWebMaximized(false);
  webId = id;
  webURL = game(id).unityroomurl;
  renderVolume(state.settings.webVolume);
  renderAppUpdate();
  $('#web-title').textContent = game(id).name + ' - Unity Room';
  $('#web-error').hidden = true;
  $('#web-back').hidden = true; $('#web-forward').hidden = true;
  webModal.showModal();
  try { await api.webOpen(id, webBounds()); await updateBounds(); }
  catch (error) { webId = null; webModal.close(); throw error; }
}
async function closeWeb() { await api.webControl('close'); webId = null; if (webModal.open) webModal.close(); await setWebMaximized(false); renderAppUpdate(); }
new ResizeObserver(() => { if (webId) updateBounds(); }).observe($('#web-host'));
window.addEventListener('resize', () => { if (webId) updateBounds(); });
webModal.addEventListener('cancel', event => { event.preventDefault(); safe(closeWeb)(); });
api.onWebState(s => {
  if (s.id !== webId) return;
  if (s.closeRequested) { safe(closeWeb)(); return; }
  $('#web-back').hidden = !s.back; $('#web-forward').hidden = !s.forward;
  $('#web-title').title = s.url || '';
  $('#web-reload').setAttribute('aria-label', s.loading ? 'ページを読み込み中' : 'ページを再読み込み');
  if (s.failed) { $('#web-error').textContent = s.failed + ' 再読み込みするか、ブラウザで開いてください。'; $('#web-error').hidden = false; }
  updateBounds();
});
$('#web-exit').onclick = safe(closeWeb);
$('#web-maximize').onclick = safe(() => setWebMaximized(!webMaximized));
$('#web-back').onclick = safe(() => api.webControl('back'));
$('#web-forward').onclick = safe(() => api.webControl('forward'));
$('#web-reload').onclick = safe(() => { $('#web-error').hidden = true; return api.webControl('reload'); });
$('#web-external').onclick = safe(() => api.external(webURL));
function renderVolume(value) {
  $('#web-volume').value=value;
  $('#web-volume').style.setProperty('--volume', `${value}%`);
  $('#web-volume-value').textContent=`${Math.round(value)}%`;
  $('#web-volume').setAttribute('aria-valuetext',`${Math.round(value)}%`);
  $('#web-mute').innerHTML=icon(value===0?'volume-off':'volume');
  $('#web-mute').setAttribute('aria-label',value===0?'ミュートを解除':'ミュート');
  $('#web-mute').setAttribute('aria-pressed',String(value===0));
  if(value>0)previousVolume=value;
}
$('#web-volume').oninput=safe(async event=>{const value=Number(event.target.value);renderVolume(value);await api.webVolume(value);});
$('#web-volume').onchange=safe(()=>api.settings({webVolume:Number($('#web-volume').value)}));
$('#web-mute').onclick=safe(async()=>{const value=Number($('#web-volume').value)===0?previousVolume:0;renderVolume(value);await api.webVolume(value);await api.settings({webVolume:value});});

document.addEventListener('click', safe(async event => {
  const el = event.target.closest('button,a'); if (!el) return;
  if (el.dataset.window) return api.window(el.dataset.window);
  if (el.dataset.detail) return detail(el.dataset.detail);
  if (el.dataset.favorite) return api.favorite(el.dataset.favorite);
  if (el.dataset.play) return play(el.dataset.play);
  if (el.dataset.update) return install(el.dataset.update);
  if (el.dataset.folder) return api.showFolder(el.dataset.folder);
  if (el.dataset.cancel) return api.cancel(el.dataset.cancel);
  if (el.dataset.retry) return loadDetails(el.dataset.retry, true);
  if (el.hasAttribute('data-tag')) { tag = el.dataset.tag; render(); return; }
  if (el.dataset.url) { event.preventDefault(); return api.external(el.dataset.url); }
  if (el.tagName === 'A') { event.preventDefault(); if (el.href.startsWith('https:')) return api.external(el.href); }
}));
$('#search').oninput = event => { query = event.target.value; render(); };
function resetFilters() { scope = 'all'; filter = 'all'; tag = ''; query = ''; sort = 'name'; $('#search').value = ''; render(); }
$('#reset-filter').onclick = resetFilters;
$('#filters-toggle').onclick = () => {
  $('#scope').value = scope; $('#platform-filter').value = filter; $('#sort').value = sort;
  const tags = [...new Set(state.games.flatMap(g => g.tags))].sort((a,b) => a.localeCompare(b,'ja'));
  $('#tag-filter').innerHTML = '<option value="">すべてのタグ</option>' + tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#tag-filter').value = tag;
  $('#filters-dialog').showModal();
};
$('#filters-close').onclick = () => $('#filters-dialog').close();
$('#scope').onchange = event => { scope = event.target.value; render(); };
$('#platform-filter').onchange = event => { filter = event.target.value; render(); };
$('#tag-filter').onchange = event => { tag = event.target.value; render(); };
$('#sort').onchange = event => { sort = event.target.value; render(); };
$('#filters-reset').onclick = () => { resetFilters(); $('#filters-dialog').close(); };
$('#grid-view').onclick = safe(() => api.settings({view:'grid'}));
$('#list-view').onclick = safe(() => api.settings({view:'list'}));
async function sync(quiet = false) {
  $('#sync').disabled = true; $('#sync').title = '同期中…';
  try { state = await api.sync(); render(); if (!quiet) toast('ゲームリストを更新しました。'); $('#sync').title = '再読み込み'; }
  catch (error) { $('#sync').title = 'オフライン · 保存済みリストを表示中'; toast('同期できませんでした。保存済みリストを表示します。 ' + error.message, true); }
  finally { $('#sync').disabled = false; }
}
$('#sync').onclick = () => sync();
const settingsDialog = $('#settings-dialog');
$('#settings').onclick = () => {
  const s = state.settings;
  $('#catalog-url').value = s.catalogUrl; $('#auto-sync').checked = s.autoSync;
  $('#download-dir').value = s.downloadDir; $('#theme').value = s.theme; $('#settings-error').textContent = '';
  $('#auto-update').checked = s.autoUpdate;
  renderAppUpdate();
  settingsDialog.showModal();
};
$$('.close-dialog').forEach(el => el.onclick = () => settingsDialog.close());
$('#choose-folder').onclick = safe(async () => { const folder = await api.folder(); if (folder) $('#download-dir').value = folder; });
$('#default-folder').onclick = () => $('#download-dir').value = '';
$('#reset-settings').onclick = () => {
  $('#catalog-url').value = 'https://cgp-catalog.renren112.chatgpt.site/api/games';
  $('#auto-sync').checked = true; $('#download-dir').value = ''; $('#theme').value = 'dark';
  $('#auto-update').checked = true;
};
$('#import-legacy').onclick = safe(async () => toast(`${await api.importLegacy()} 件のゲームを追加しました。`));
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  try {
    await api.settings({catalogUrl:$('#catalog-url').value.trim(),autoSync:$('#auto-sync').checked,autoUpdate:$('#auto-update').checked,downloadDir:$('#download-dir').value,theme:$('#theme').value});
    settingsDialog.close(); toast('設定を保存しました。');
  } catch (error) { $('#settings-error').textContent = error.message; }
};
document.addEventListener('keydown', safe(async event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !webId) {
    event.preventDefault(); setSidebarCollapsed(false); $('#search').focus(); $('#search').select();
  }
}));
api.onState(s => { state = s; render(); });
state = await api.snapshot(); render();
api.onAppUpdate(update => { appUpdate = update; renderAppUpdate(); });
appUpdate = await api.updateState(); renderAppUpdate();
$('#update-check').onclick = safe(async () => { appUpdate = await api.updateCheck(); renderAppUpdate(); });
$('#update-retry').onclick = $('#update-check').onclick;
const applyUpdate = safe(async () => { await api.updateInstall(); });
$('#update-install-settings').onclick = applyUpdate;
$('#update-install-banner').onclick = applyUpdate;
