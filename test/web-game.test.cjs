const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isUnityRoomPage,isUnityRoomGame,playUrlFromHtml,resolveWebGame}=require('../src/web-game.cjs');

test('Unity Roomの投稿ページだけを解決し、紛らわしいホストや認証情報を拒否する',()=>{
  assert.ok(isUnityRoomPage('https://unityroom.com/games/runpage24-d'));
  assert.ok(isUnityRoomPage('https://www.unityroom.com/games/tetris-climbing-game/'));
  for(const url of ['http://unityroom.com/games/a','https://unityroom.com.evil.test/games/a','https://evil.test/unityroom.com/games/a','https://user@unityroom.com/games/a','https://unityroom.com:8443/games/a','https://unityroom.com/login'])assert.equal(isUnityRoomPage(url),false);
  assert.ok(isUnityRoomGame('https://56938.play.unityroom.com/?sig=abc'));
  for(const url of ['https://play.unityroom.com','https://56938.play.unityroom.com.evil.test','https://user@56938.play.unityroom.com','javascript:alert(1)'])assert.equal(isUnityRoomGame(url),false);
});
test('PCのiframeと別タブ用リンクのどちらからも署名を保持してゲーム本体を取得する',()=>{
  for(const html of ['<iframe src="https://56938.play.unityroom.com/?expires=123&amp;salt=45&amp;sig=abc"></iframe>',"<a target='_blank' href='https://56938.play.unityroom.com?expires=123&#38;salt=45&#x26;sig=abc'>開く</a>"]){
    const url=new URL(playUrlFromHtml(html));
    assert.equal(url.hostname,'56938.play.unityroom.com');
    assert.equal(url.searchParams.get('expires'),'123');assert.equal(url.searchParams.get('salt'),'45');assert.equal(url.searchParams.get('sig'),'abc');assert.equal(url.searchParams.get('no_bg'),'true');
  }
});
test('広告iframe・スクリプト・コメント・偽ドメインをゲームとして読み込まない',()=>{
  const html='<iframe src="https://ads.example.test/"></iframe><!-- <a href="https://1.play.unityroom.com"> -->'+
    '<script>const text=\'<iframe src="https://2.play.unityroom.com">\';</script><a href="https://3.play.unityroom.com.evil.test">';
  assert.throws(()=>playUrlFromHtml(html),/起動URL/);
  assert.throws(()=>playUrlFromHtml('<a href="https://user@4.play.unityroom.com">'),/起動URL/);
});
test('起動・再読み込みのたびに新しい署名を取得し、他のWeb配布サイトはそのまま開く',async()=>{
  let calls=0;
  const fetchPage=async(url,options)=>{
    calls++;assert.equal(url,'https://unityroom.com/games/example');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    return new Response(`<a href="https://123.play.unityroom.com?sig=${calls}">開く</a>`);
  };
  const first=await resolveWebGame('https://unityroom.com/games/example',{fetchPage});
  const second=await resolveWebGame('https://unityroom.com/games/example',{fetchPage});
  assert.equal(new URL(first).searchParams.get('sig'),'1');assert.equal(new URL(second).searchParams.get('sig'),'2');
  assert.equal(await resolveWebGame('https://example.test/game',{fetchPage}),'https://example.test/game');assert.equal(calls,2);
  await assert.rejects(()=>resolveWebGame('file:///local'),/URL/);
});
test('解決失敗時は広告のある投稿ページに戻さず、エラーと中断を伝える',async()=>{
  const url='https://unityroom.com/games/example';
  await assert.rejects(()=>resolveWebGame(url,{fetchPage:async()=>new Response('unavailable',{status:503})}),/503/);
  await assert.rejects(()=>resolveWebGame(url,{fetchPage:async()=>new Response('<html>no game</html>')}),/起動URL/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>resolveWebGame(url,{signal:controller.signal,fetchPage:async(_url,{signal})=>{signal.throwIfAborted();}}),{name:'AbortError'});
});
test('大きすぎるHTMLを打ち切り、応答ストリームを中止する',async()=>{
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2*1024**2+1));},cancel(){cancelled=true;}});
  await assert.rejects(()=>resolveWebGame('https://unityroom.com/games/example',{fetchPage:async()=>new Response(body)}),/大きすぎ/);
  assert.equal(cancelled,true);
  let headerCancelled=false;
  const oversized=new Response(new ReadableStream({cancel(){headerCancelled=true;}}),{headers:{'content-length':String(3*1024**2)}});
  await assert.rejects(()=>resolveWebGame('https://unityroom.com/games/example',{fetchPage:async()=>oversized}),/大きすぎ/);
  assert.equal(headerCancelled,true);
});
