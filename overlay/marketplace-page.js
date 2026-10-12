// ScapeLite plugin marketplace page (served by status-server.js at /marketplace).
// Browse plugins from catalog.json (+ drop-in plugins/<id>/plugin.json), read
// features and screenshots, and add / remove them. "Add" = enable (live inject
// into the running game, no reload); "Remove" = disable (live teardown).
'use strict';

module.exports = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScapeLite Plugins</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<style>
:root{--bg:#0e0e13;--card:#16161e;--card2:#1b1b25;--line:#2a2a38;--txt:#e4e4ec;--dim:#8f8fa0;--gold:#ffd24a;--green:#58d46a;--red:#ff8f80;--blue:#4aa8ff;--purple:#b07cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 system-ui,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:rgba(14,14,19,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:14px 22px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{margin:0;font-size:20px;letter-spacing:.2px}h1 b{color:var(--gold)}
header a{color:var(--dim);text-decoration:none;font-size:13px}header a:hover{color:var(--txt)}
.sp{flex:1}
input[type=search]{background:var(--card);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:8px 12px;min-width:240px;font:inherit}
input[type=search]:focus{outline:none;border-color:var(--gold)}
main{display:grid;grid-template-columns:210px 1fr;gap:22px;padding:22px;max-width:1280px;margin:0 auto}
nav .cat{display:flex;justify-content:space-between;padding:8px 12px;border-radius:8px;cursor:pointer;color:var(--dim);user-select:none}
nav .cat:hover{background:var(--card)}nav .cat.on{background:var(--card2);color:var(--gold)}nav .cat span{opacity:.7}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;align-content:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;transition:border-color .12s,transform .12s}
.card:hover{border-color:#44445a;transform:translateY(-1px)}.card.on{border-color:rgba(88,212,106,.55)}
.card{position:relative}.official img{width:16px;height:16px;display:block}.official{position:absolute;top:8px;right:8px;padding:3px 5px !important;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:9px;background:rgba(255,210,74,.14);color:var(--gold);border:1px solid rgba(255,210,74,.4)}
.card .thumb{width:100%;height:132px;object-fit:cover;object-position:top left;border-radius:9px;border:1px solid var(--line);background:#0b0b10;margin:-2px 0 4px}
.card h3{margin:0;padding-right:70px;font-size:15px;display:flex;gap:8px;align-items:center}
.card p{margin:0;color:var(--dim);font-size:13px;flex:1}
.ico{width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#2a2a3c,#1d1d29);display:grid;place-items:center;font-weight:700;color:var(--gold);flex:none;border:1px solid var(--line)}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.chip{font-size:11px;padding:1px 8px;border-radius:9px;background:#262633;color:#aab}
.chip.core{background:#2a2540;color:#b9a8ff}.chip.on{background:#16332a;color:#6fe3a0}
button{font:inherit;color:var(--txt);background:#23232f;border:1px solid #3a3a4a;border-radius:8px;padding:6px 14px;cursor:pointer}
button:hover{border-color:#80809a}button.add{background:#1c3a2a;border-color:#2f7a4a;color:#9bf0b4}button.rm{background:#3a2020;border-color:#7a3a3a;color:#ffb0a4}button:disabled{opacity:.45;cursor:default}
.drawer{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;justify-content:flex-end;z-index:20}.drawer.open{display:flex}
.panel{width:min(560px,100%);height:100%;background:var(--card);border-left:1px solid var(--line);overflow-y:auto;padding:22px;display:flex;flex-direction:column;gap:12px}
.panel h2{margin:0;font-size:20px}.panel ul{margin:0;padding-left:18px}.panel li{margin:3px 0}
.panel img{width:100%;border-radius:8px;border:1px solid var(--line)}
.kv{color:var(--dim);font-size:12.5px}.x{align-self:flex-end;font-size:20px;padding:0 10px;line-height:1.4}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1d1d29;border:1px solid var(--line);padding:8px 16px;border-radius:9px;display:none;z-index:30}
.empty{color:var(--dim);padding:30px}.gbody p{margin:8px 0}.gbody ul{padding-left:20px}.gbody li{margin:4px 0}.gbody code{background:#0f0f14;border:1px solid var(--line);border-radius:4px;padding:0 5px}.w-warn{color:#ffb4a8}
@media(max-width:760px){main{grid-template-columns:1fr}}
</style></head><body>
<header><h1><img src="/logo-lockup.svg" alt="ScapeLite" style="height:34px;vertical-align:-9px"> <span style="font-weight:500;color:var(--dim);margin-left:6px">Plugins</span></h1><a href="/">&larr; Dashboard</a><span class="sp"></span><button class="add" data-act="addp">\uFF0B Add plugin</button><a href="/docs/plugin-author-guide" target="_blank">Developer guide</a><a href="/site/" id="siteLink" target="_blank" rel="noopener">Website &#8599;</a><input id="q" type="search" placeholder="Search plugins, features, tags..." autofocus></header>
<main><nav id="cats"></nav><section><div id="grid" class="grid"></div><h2 id="chead" style="margin:28px 0 10px;font-size:18px">Community plugins</h2><div id="cgrid" class="grid"></div></section></main>
<div id="drawer" class="drawer"><div class="panel" id="panel"></div></div><div id="toast" class="toast"></div>
<script>
var DATA=null, cat='All', q='';
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function toast(t){var e=document.getElementById('toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(function(){e.style.display='none'},2600)}
function post(url,body){return fetch(url,{method:'POST',headers:{'content-type':'application/json','x-cc-control':'1'},body:JSON.stringify(body)}).then(function(r){return r.json()})}
function load(){fetch('/api/catalog').then(function(r){return r.json()}).then(function(d){DATA=d;render()}).catch(function(){document.getElementById('grid').innerHTML='<div class="empty">Could not reach the ScapeLite server.</div>'})}
function match(p){if(cat!=='All'&&p.category!==cat)return false;if(!q)return true;var h=(p.name+' '+p.tagline+' '+p.description+' '+(p.features||[]).join(' ')+' '+(p.tags||[]).join(' ')).toLowerCase();return q.split(/\\s+/).every(function(w){return h.indexOf(w)>=0})}
function render(){
  var cats=['All'].concat(DATA.categories),counts={};DATA.plugins.forEach(function(p){counts[p.category]=(counts[p.category]||0)+1});
  document.getElementById('cats').innerHTML=cats.map(function(c){return '<div class="cat'+(c===cat?' on':'')+'" data-c="'+esc(c)+'">'+esc(c)+'<span>'+(c==='All'?DATA.plugins.length:(counts[c]||0))+'</span></div>'}).join('');
  var list=DATA.plugins.filter(match);
  document.getElementById('grid').innerHTML=list.length?list.map(function(p){return '<div class="card'+(p.enabled?' on':'')+'" data-id="'+esc(p.id)+'">'+(p.community?'':'<span class="official" title="Made by the ScapeLite team (not by the Scapewatch developers)"><img src="/logo.svg" alt="ScapeLite"></span>')+''+(p.screenshots&&p.screenshots[0]?'<img class="thumb" loading="lazy" src="/catalog-img/'+encodeURIComponent(p.screenshots[0])+'" alt="" onerror="this.remove()">':'')+'<h3><span class="ico">'+esc(p.name.charAt(0))+'</span>'+esc(p.name)+'</h3><p>'+esc(p.tagline)+'</p><div class="row"><span class="chip">'+esc(p.category)+'</span>'+(p.core?'<span class="chip core">core</span>':'')+(p.enabled?'<span class="chip on">added</span>':'')+(p.community?'<span class="chip">by '+esc(who(p))+'</span>':'')+'<span class="sp"></span>'+btn(p)+'</div></div>'}).join(''):'<div class="empty">No plugins match.</div>';
}
function who(p){var a=(DATA.authors||{})[p.author];return (a&&a.handle)||p.author||'unknown'}
function openGuide(id,i){var p=DATA.plugins.find(function(x){return x.id===id}),g=p&&p.guide;if(!g)return;i=Math.max(0,Math.min(g.steps.length-1,i));var s=g.steps[i],last=i===g.steps.length-1;var m=document.getElementById('gmodal');if(!m){m=document.createElement('div');m.id='gmodal';m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:40';document.body.appendChild(m)}m.style.display='flex';m.innerHTML='<div style="width:min(560px,94vw);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;box-shadow:0 14px 50px rgba(0,0,0,.7)"><div class="kv">'+esc(g.title)+' \u00b7 step '+(i+1)+' of '+g.steps.length+'</div><h2 style="margin:6px 0 10px">'+esc(s.title)+'</h2><div class="gbody">'+s.body+'</div><div class="row" style="margin-top:16px"><span class="sp"></span>'+(i>0?'<button data-act="gprev" data-id="'+esc(id)+'" data-i="'+i+'">Back</button>':'')+(last?'<button class="add" data-act="gdone">Done</button>':'<button class="add" data-act="gnext" data-id="'+esc(id)+'" data-i="'+i+'">Next</button>')+'</div></div>'}
function openAdd(tab,url){
  var m=document.getElementById('amodal');
  if(!m){m=document.createElement('div');m.id='amodal';m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:40';document.body.appendChild(m)}
  m.style.display='flex';
  var tabs=[['github','From GitHub'],['folder','From a folder'],['build','Build your own'],['submit','Get listed']];
  var h='<div style="width:min(640px,95vw);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 22px;box-shadow:0 14px 50px rgba(0,0,0,.7)"><div class="row"><h2 style="margin:0">Add a plugin</h2><span class="sp"></span><button data-act="aclose">&times;</button></div><div class="row" style="margin:12px 0">'+tabs.map(function(t){return '<button data-act="atab" data-tab="'+t[0]+'"'+(t[0]===tab?' class="add"':'')+'>'+t[1]+'</button>'}).join('')+'</div><div class="gbody">';
  if(tab==='github'){h+='<p>Paste the GitHub link of a ScapeLite plugin (a repository, or a folder inside one that contains <code>plugin.json</code>).</p><div class="row"><input id="aurl" type="search" style="flex:1;min-width:240px" placeholder="https://github.com/owner/repo" value="'+esc(url||'')+'"><button class="add" data-act="acheck">Check</button></div><div id="apreview" style="margin-top:14px"></div>'}
  else if(tab==='folder'){h+='<p>Drop a plugin folder (it must contain a <code>plugin.json</code>) into your plugins folder:</p><div class="row"><button class="add" data-act="afolder">Open plugins folder</button></div><ol><li>Copy the plugin\\'s folder into it.</li><li>Restart ScapeLite once (tray menu or dashboard &rarr; Restart).</li><li>It appears in this marketplace, switched <b>off</b>. Press <b>Add</b>.</li></ol><p class="kv">Plugins run inside your game page. Only add plugins from people you trust.</p>'}
  else if(tab==='build'){h+='<p>A plugin is just a folder with a <code>plugin.json</code> and a <code>main.js</code>. In about ten minutes you can have your own chip or panel in the game.</p><ul><li>Display-only: plugins never click or act in the game.</li><li>A complete working example ships with ScapeLite: <code>examples/plugins/session-clock</code>.</li><li>Test it with <b>From a folder</b>, share it with a GitHub link.</li></ul><div class="row"><a class="chip" style="padding:6px 12px;text-decoration:none" target="_blank" href="/docs/plugin-author-guide">Open the full author guide</a></div>'}
  else{h+='<p>Want your plugin listed here so people can find it without a link?</p><ol><li>Put it on GitHub (<code>plugin.json</code> + your script).</li><li>Test <b>From GitHub</b> with your own link.</li><li>Open the <b>Plugin submission</b> form in the ScapeLite repository.</li><li>A maintainer checks it is display-only, readable and honest, then lists it under <b>Community plugins</b>.</li></ol><div class="row"><a class="chip" style="padding:6px 12px;text-decoration:none" target="_blank" href="/docs/submit-a-plugin">Read the submission rules</a></div>'}
  h+='</div></div>';m.innerHTML=h;
  var u=document.getElementById('aurl');if(u)u.addEventListener('keydown',function(e){if(e.key==='Enter')checkPlugin()});
}
function checkPlugin(){
  var u=(document.getElementById('aurl')||{}).value||'';var box=document.getElementById('apreview');if(!box)return;
  box.innerHTML='<span class="kv">Checking\u2026</span>';
  post('/api/plugins/preview',{url:u}).then(function(r){
    if(!r.ok){box.innerHTML='<div style="color:var(--red)">'+esc(r.error||'Could not read that plugin.')+'</div>';return}
    var h='<div class="card" style="cursor:default"><h3>'+esc(r.name)+' <span class="kv">v'+esc(r.version||'?')+' &middot; by '+esc(r.author)+'</span></h3><p>'+esc(r.description||'')+'</p><div class="kv">Source: '+esc(r.source)+' &middot; files: '+r.files.map(function(f){return esc(f.file)+' ('+Math.max(1,Math.round(f.bytes/1024))+' KB)'}).join(', ')+'</div>';
    h+=r.flags.length?'<div style="margin-top:10px;padding:8px 10px;border:1px solid #b8962f;border-radius:8px;background:rgba(255,210,74,.08)"><b>What this plugin\\'s code can do:</b><ul style="margin:6px 0 0">'+r.flags.map(function(f){return '<li>'+esc(f)+'</li>'}).join('')+'</ul></div>':'<div class="kv" style="margin-top:10px">No network access, dynamic code or storage use found in its main script.</div>';
    if(r.exists)h+='<div class="kv" style="margin-top:8px">A plugin with this id is already installed; installing replaces it.</div>';
    h+='<label style="display:block;margin-top:12px;cursor:pointer"><input type="checkbox" id="atrust"> I trust this plugin and understand it runs inside my game page.</label><div class="row" style="margin-top:10px"><button class="add" data-act="ainstall" data-url="'+esc(u)+'" id="ainst" disabled>Install</button></div></div>';
    box.innerHTML=h;var cb=document.getElementById('atrust');cb.onchange=function(){document.getElementById('ainst').disabled=!cb.checked};
  }).catch(function(){box.innerHTML='<div style="color:var(--red)">Request failed.</div>'});
}
function installPlugin(btn){
  btn.disabled=true;btn.textContent='Installing\u2026';
  post('/api/plugins/install',{url:btn.dataset.url}).then(function(r){
    var box=document.getElementById('apreview');
    if(!r.ok){box.innerHTML='<div style="color:var(--red)">'+esc(r.error||'Install failed.')+'</div>';return}
    box.innerHTML='<div class="card" style="cursor:default"><b>Installed "'+esc(r.name)+'".</b> ScapeLite is restarting its background service; the plugin will appear in a few seconds (switched off). Press <b>Add</b> on it to turn it on.</div>';
    setTimeout(function(){load();var m=document.getElementById('amodal');if(m)m.style.display='none'},9000);
  });
}
function loadCommunity(){
  fetch('/api/community').then(function(r){return r.json()}).then(function(c){
    var g=document.getElementById('cgrid');var list=(c&&c.plugins)||[];
    if(!list.length){g.innerHTML='<div class="card" style="cursor:default"><h3>No community plugins listed yet</h3><p style="margin:0;color:var(--dim);font-size:13px">Plugins made by the community will appear here. You can already install any plugin from a GitHub link, or build your own &mdash; and submit it to be listed.</p><div class="row" style="margin-top:10px"><button class="add" data-act="atab" data-tab="submit">How to get listed</button><button data-act="atab" data-tab="build">Build a plugin</button></div></div>';return}
    g.innerHTML=list.map(function(p){return '<div class="card" style="cursor:default"><h3>'+esc(p.name)+'</h3><p>'+esc(p.description||'')+'</p><div class="row"><span class="chip">by '+esc(p.author||'?')+'</span><span class="sp"></span><button class="add" data-act="cinstall" data-repo="'+esc(p.repo)+'">Check &amp; install</button></div></div>'}).join('');
  }).catch(function(){});
}
function btn(p){if(p.core)return '<button disabled>Always on</button>';return p.enabled?'<button class="rm" data-act="rm" data-id="'+esc(p.id)+'">Remove</button>':'<button class="add" data-act="add" data-id="'+esc(p.id)+'">Add</button>'}
function detail(id){
  var p=DATA.plugins.find(function(x){return x.id===id});if(!p)return;
  var h='<button class="x" data-act="close">&times;</button><h2>'+esc(p.name)+'</h2><div class="row"><span class="chip">'+esc(p.category)+'</span>'+(p.core?'<span class="chip core">core</span>':'')+(p.community?'':'<span class="chip" style="background:rgba(255,210,74,.14);color:var(--gold)"><img src="/logo.svg" alt="" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px">ScapeLite</span>')+'<span class="kv">v'+esc(p.version||'1.0.0')+' &middot; by '+esc(who(p))+'</span></div>';
  var au=(DATA.authors||{})[p.author];if(au&&au.links&&au.links.length)h+='<div class="row">'+au.links.map(function(l){return '<a class="chip" style="text-decoration:none" target="_blank" rel="noopener" href="'+esc(l.url)+'">'+esc(l.label)+'</a>'}).join('')+(au.discord?'<span class="chip">Discord: '+esc(au.discord)+'</span>':'')+'</div>';
  h+='<div class="row">'+btn(p)+(p.loaded?'<span class="chip on">running in game</span>':'')+'</div><p>'+esc(p.description)+'</p>';
  if(p.community)h+='<div class="row"><button class="rm" data-act="uninstall" data-id="'+esc(p.id)+'">Uninstall this plugin</button><span class="kv">removes its folder from your plugins folder</span></div>';
  if(p.guide&&p.guide.steps&&p.guide.steps.length)h+='<div class="row"><button class="add" data-act="guide" data-id="'+esc(p.id)+'">❓ How to set it up ('+p.guide.steps.length+' steps)</button></div>';
  if(p.features&&p.features.length)h+='<b>Features</b><ul>'+p.features.map(function(f){return '<li>'+esc(f)+'</li>'}).join('')+'</ul>';
  if(p.requires&&p.requires.length)h+='<div class="kv">Needs: '+p.requires.map(esc).join(', ')+'</div>';
  (p.screenshots||[]).forEach(function(s){h+='<img src="/catalog-img/'+encodeURIComponent(s)+'" alt="" onerror="this.remove()">'});
  if(p.tags&&p.tags.length)h+='<div class="row">'+p.tags.map(function(t){return '<span class="chip">#'+esc(t)+'</span>'}).join('')+'</div>';
  document.getElementById('panel').innerHTML=h;document.getElementById('drawer').classList.add('open');
}
document.addEventListener('click',function(e){
  var t=e.target,a=t.closest&&t.closest('[data-act]');
  if(a){e.stopPropagation();var act=a.dataset.act;
    if(act==='close'){document.getElementById('drawer').classList.remove('open');return}
    if(act==='guide'){openGuide(a.dataset.id,0);return}
    if(act==='addp'){openAdd('github','');return}
    if(act==='atab'){openAdd(a.dataset.tab,'');return}
    if(act==='aclose'){document.getElementById('amodal').style.display='none';return}
    if(act==='acheck'){checkPlugin();return}
    if(act==='ainstall'){installPlugin(a);return}
    if(act==='afolder'){post('/api/plugins/open-folder').then(function(r){toast('Opened '+(r.dir||'the plugins folder'))});return}
    if(act==='cinstall'){openAdd('github',a.dataset.repo);checkPlugin();return}
    if(act==='uninstall'){if(!confirm('Uninstall this plugin? Its folder will be deleted.'))return;post('/api/plugins/remove',{id:a.dataset.id}).then(function(r){toast(r.ok?'Uninstalled. Restarting ScapeLite\u2026':(r.error||'Failed'));document.getElementById('drawer').classList.remove('open');setTimeout(load,9000)});return}
    if(act==='gprev'){openGuide(a.dataset.id,+a.dataset.i-1);return}
    if(act==='gnext'){openGuide(a.dataset.id,+a.dataset.i+1);return}
    if(act==='gdone'){document.getElementById('gmodal').style.display='none';return}
    a.disabled=true;post('/api/plugin',{id:a.dataset.id,enabled:act==='add'}).then(function(r){toast(r.ok?(act==='add'?'Added':'Removed'):(r.error||'Failed'));setTimeout(function(){load();var o=document.getElementById('drawer').classList.contains('open');if(o)setTimeout(function(){detail(a.dataset.id)},250)},400)});return}
  var c=t.closest&&t.closest('.cat');if(c){cat=c.dataset.c;render();return}
  var cd=t.closest&&t.closest('.card');if(cd){detail(cd.dataset.id);return}
  if(t.id==='drawer')t.classList.remove('open');
});
document.getElementById('q').addEventListener('input',function(e){q=e.target.value.toLowerCase().trim();if(DATA)render()});
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('drawer').classList.remove('open')});
fetch('/api/site').then(function(r){return r.json()}).then(function(d){var a=document.getElementById('siteLink');if(a&&d.url)a.href=d.url}).catch(function(){});loadCommunity();load();setInterval(function(){if(!document.getElementById('drawer').classList.contains('open'))load()},5000);
</script></body></html>`;
