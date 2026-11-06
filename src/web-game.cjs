// Unity Room publishes a signed play link on each public game page. Resolve it
// afresh for every launch/reload; never persist expiring signatures in a catalog.
function isUnityRoomPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(?:www\.)?unityroom\.com$/.test(url.hostname) && /^\/games\/[\w-]+\/?$/.test(url.pathname);
  } catch { return false; }
}
function isUnityRoomGame(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^\d+\.play\.unityroom\.com$/.test(url.hostname);
  } catch { return false; }
}
function playUrlFromHtml(html) {
  // Only inspect link/frame attributes, not scripts or arbitrary inline text.
  const tags = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').match(/<(?:iframe|a)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const value = tag.match(/\s(?:src|href)\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!value) continue;
    const decoded = value.replace(/&amp;|&#0*38;|&#x0*26;/gi, '&');
    if (isUnityRoomGame(decoded)) {
      const url = new URL(decoded);
      url.searchParams.set('no_bg', 'true');
      return url.href;
    }
  }
  throw Error('ゲームの起動URLを取得できませんでした。');
}
async function resolveWebGame(value, {signal, fetchPage = fetch} = {}) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Web版のURLが正しくありません。');
  if (!isUnityRoomPage(url.href)) return url.href;
  const response = await fetchPage(url.href, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {Accept:'text/html'},
    redirect:'error'
  });
  if (!response.ok) throw Error(`ゲームの起動URLを取得できませんでした (HTTP ${response.status})。`);
  if (Number(response.headers.get('content-length')) > 2 * 1024 ** 2) {
    await response.body?.cancel().catch(()=>{});
    throw Error('ゲームのページが大きすぎます。');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value: chunk} = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 2 * 1024 ** 2) throw Error('ゲームのページが大きすぎます。');
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
  finally { reader.releaseLock(); }
  return playUrlFromHtml(Buffer.concat(chunks).toString('utf8'));
}
module.exports = {isUnityRoomPage, isUnityRoomGame, playUrlFromHtml, resolveWebGame};
