// ScapeLite dashboard: the log viewer page (http://localhost:7777/logs). Browse channels and files, tail with auto-refresh,
// filter by text and level, search across every channel, open the Logs folder, download the Task Log rebuilt from the files.
// Read-only apart from "open folder"; the data comes from /api/logs/* (see status-server.js and overlay/logging/reader.js).
module.exports = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScapeLite Logs</title>
<style>
:root{--bg:#14161a;--panel:#1c1f26;--line:#2c313c;--text:#d9dde6;--dim:#8d96a8;--accent:#e0a63a;--warn:#e8b64a;--err:#ef6b6b;--ok:#6cc08b}
@media (prefers-color-scheme:light){:root{--bg:#f4f5f7;--panel:#fff;--line:#d7dbe3;--text:#1d2330;--dim:#667088;--accent:#a8700d;--warn:#9a6a00;--err:#c0392b;--ok:#2a7d4b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,Segoe UI,sans-serif}
header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line)}
header h1{font-size:17px;margin:0;color:var(--accent)}header a,button{color:var(--text)}
a{color:var(--accent)}button,input,select{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font:inherit;color:var(--text)}
button{cursor:pointer}button:hover{border-color:var(--accent)}
main{display:grid;grid-template-columns:260px 1fr;gap:0;min-height:calc(100vh - 56px)}
@media (max-width:760px){main{grid-template-columns:1fr}}
nav{border-right:1px solid var(--line);padding:10px;overflow:auto}
.ch{padding:7px 9px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.ch:hover{background:var(--panel)}.ch.sel{background:var(--panel);outline:1px solid var(--accent)}
.ch small{color:var(--dim)}.off{opacity:.5}
.desc{color:var(--dim);font-size:12px;padding:2px 9px 8px}
section{padding:12px 16px;min-width:0}
.files{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
.f{padding:3px 8px;border:1px solid var(--line);border-radius:12px;cursor:pointer;font-size:12px;color:var(--dim)}
.f.sel{border-color:var(--accent);color:var(--text)}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;max-height:68vh;font:12px/1.5 Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.l-ERROR{color:var(--err)}.l-WARN{color:var(--warn)}.l-DEBUG{color:var(--dim)}.hdr{color:var(--dim)}
.hit b{color:var(--accent)}.muted{color:var(--dim)}
</style></head><body>
<header><h1>ScapeLite Logs</h1><a href="/">Dashboard</a><span class="muted" id="dir"></span><span style="flex:1"></span>
<input id="gq" placeholder="Search all logs..." size="22"><button id="gsearch">Search</button>
<button id="openf">Open Logs folder</button><a id="taskdl" href="/api/logs/export/tasks" download="scapelite-task-log-from-files.json">Task Log from files (.json)</a></header>
<main><nav id="nav"></nav><section id="view"><p class="muted">Pick a log on the left.</p></section></main>
<script>
var info = null, cur = null, file = null, timer = null;
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function size(b){return b>1048576?(b/1048576).toFixed(1)+' MB':b>1024?Math.round(b/1024)+' KB':b+' B';}
function ago(t){if(!t)return 'never';var s=Math.floor((Date.now()-t)/1000);return s<90?s+'s ago':s<5400?Math.round(s/60)+' min ago':s<172800?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago';}
function j(u){return fetch(u).then(function(r){return r.json();});}
function paint(line){
  var m=/^\\S+ \\S+ (DEBUG|INFO|WARN|ERROR)\\b/.exec(line);
  var cls=line.charAt(0)==='#'?'hdr':m?'l-'+m[1]:'';
  return '<div class="'+cls+'">'+esc(line)+'</div>';
}
function drawNav(){
  document.getElementById('dir').textContent=info.dir;
  document.getElementById('nav').innerHTML=info.channels.map(function(c){
    return '<div class="ch'+(cur===c.name?' sel':'')+(c.enabled?'':' off')+'" data-c="'+c.name+'"><span>'+c.name+'</span><small>'+c.files+' files · '+size(c.bytes)+'</small></div><div class="desc">'+esc(c.desc||'')+'</div>';
  }).join('');
  [].forEach.call(document.querySelectorAll('.ch'),function(e){e.onclick=function(){cur=e.getAttribute('data-c');file=null;drawNav();drawChannel();};});
}
function drawChannel(){
  var c=info.channels.filter(function(x){return x.name===cur;})[0];
  if(!c)return;
  var list=(info.lists&&info.lists[cur])||[];
  if(!file&&list.length)file=list[0].name;
  var v=document.getElementById('view');
  v.innerHTML='<h3>'+c.name+' <small class="muted">'+(c.enabled?'':'(off) ')+'kept '+c.keepDays+' days · folder Logs/'+c.dir+'/</small></h3>'+
    '<div class="files">'+list.map(function(f){return '<span class="f'+(f.name===file?' sel':'')+'" data-f="'+f.name+'">'+f.name+' · '+size(f.size)+'</span>';}).join('')+(list.length?'':'<span class="muted">No files yet.</span>')+'</div>'+
    '<div class="bar"><input id="fq" placeholder="Filter lines..." size="22"><select id="lv"><option value="">All levels</option><option>info</option><option>warn</option><option>error</option></select>'+
    '<select id="nl"><option>200</option><option>500</option><option>1000</option><option>2000</option></select><label><input type="checkbox" id="live" checked> live</label><span class="muted" id="meta"></span></div><pre id="out"></pre>';
  [].forEach.call(v.querySelectorAll('.f'),function(e){e.onclick=function(){file=e.getAttribute('data-f');drawChannel();};});
  ['fq','lv','nl','live'].forEach(function(id){document.getElementById(id).onchange=load;});
  document.getElementById('fq').oninput=function(){clearTimeout(timer);timer=setTimeout(load,300);};
  load();
}
function load(){
  if(!cur||!file)return;
  var q='/api/logs/tail?ch='+encodeURIComponent(cur)+'&file='+encodeURIComponent(file)+'&lines='+document.getElementById('nl').value+'&q='+encodeURIComponent(document.getElementById('fq').value)+'&level='+document.getElementById('lv').value;
  j(q).then(function(r){
    var out=document.getElementById('out');if(!out)return;
    var atEnd=out.scrollTop+out.clientHeight>=out.scrollHeight-30;
    if(!r.ok){out.textContent=r.error;return;}
    out.innerHTML=r.lines.map(paint).join('');
    document.getElementById('meta').textContent=r.lines.length+' lines'+(r.truncated?' (end of a large file)':'')+' · '+size(r.size);
    if(atEnd)out.scrollTop=out.scrollHeight;
  });
}
function refresh(){
  return j('/api/logs/overview').then(function(o){
    info=o;info.lists={};o.channels.forEach(function(c){info.lists[c.name]=c.list;});
    if(!cur){cur=(o.channels.filter(function(c){return c.files;})[0]||o.channels[0]).name;}
    drawNav();
  });
}
function globalSearch(){
  var q=document.getElementById('gq').value;if(q.length<2)return;
  j('/api/logs/search?q='+encodeURIComponent(q)).then(function(r){
    cur=null;drawNav();
    document.getElementById('view').innerHTML='<h3>Search: '+esc(q)+'</h3>'+(r.ok?'<div class="muted">'+r.count+' match(es)'+(r.capped?' (first '+r.count+')':'')+'</div><pre>'+r.hits.map(function(h){return '<div class="hit"><b>'+esc(h.channel)+'</b> '+esc(h.line)+'</div>';}).join('')+'</pre>':'<p>'+esc(r.error)+'</p>');
  });
}
document.getElementById('gsearch').onclick=globalSearch;
document.getElementById('gq').onkeydown=function(e){if(e.key==='Enter')globalSearch();};
document.getElementById('openf').onclick=function(){fetch('/api/logs/open',{method:'POST',headers:{'x-cc-control':'1','content-type':'application/json'},body:'{}'});};
refresh().then(function(){drawChannel();});
setInterval(function(){if(cur&&document.getElementById('live')&&document.getElementById('live').checked){j('/api/logs/overview').then(function(o){o.channels.forEach(function(c){info.lists[c.name]=c.list;});info.channels=o.channels;var s=document.querySelector('.f.sel');load();});}},2500);
</script></body></html>`;
