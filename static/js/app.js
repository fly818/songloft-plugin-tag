var S = { songs: [], sel: new Set(), cfg: {}, srcStatus: {}, prev: null, busy: false, retryId: 0, failedSongs: [] };
var S_editId = 0;
var E = function(id) { return document.getElementById(id); };

function af(u, o) {
    o = o || {};
    o.headers = o.headers || {};
    var t = SongloftPlugin.getAuthToken();
    if (t) o.headers['Authorization'] = 'Bearer ' + t;
    if (!o.headers['Content-Type'] && o.method) o.headers['Content-Type'] = 'application/json';
    return fetch(u, o);
}

async function init() {
    await loadCfg();
    chkSources();
    await loadSongs();
    await chkFp();
    await loadFailed();
    resumeBatch();
}

async function chkSources() {
    try {
        var r = await af('./config/status');
        if (r.ok) {
            var d = await r.json();
            S.srcStatus = d;
        }
        ['acoustid', 'netease', 'qqmusic', 'kugou'].forEach(function(s) {
            var st = E('st_' + s);
            var ss = S.srcStatus || {};
            if (ss.hasOwnProperty(s)) st.className = 'st ' + (ss[s] ? 'on' : 'off');
            else st.className = 'st';
        });
    } catch (e) {}
}

function resumeBatch() {
    var taskId = localStorage.getItem('batchTaskId');
    if (!taskId) return;
    var t = parseInt(localStorage.getItem('batchTotal')) || 0;
    S.busy = true;
    E('btnStop').disabled = false;
    setP(true, 0);
    E('ptxt').textContent = '0/' + t;
    log('resuming batch...');
    var loggedCount = 0;
    S._pollId = setInterval(async function() {
        try {
            var pr = await af('./scrape/batch/progress?taskId=' + taskId);
            if (!pr.ok) { stopBatch(); log('batch task expired'); return; }
            var pd = await pr.json();
            if (pd.error) { stopBatch(); return; }
            setP(true, Math.round(pd.current / pd.total * 100));
            var pe = E('ptxt');
            if (pe) pe.textContent = pd.current + '/' + pd.total;
            if (pd.recentLogs) {
                pd.recentLogs.forEach(function(l) {
                    if (pd.current > loggedCount) { log(l); loggedCount = pd.current; }
                });
            }
            if (pd.status === 'done') {
                clearInterval(S._pollId); S._pollId = 0;
                localStorage.removeItem('batchTaskId');
                localStorage.removeItem('batchTotal');
                setP(true, 100);
                E('ptxt').textContent = '';
                E('btnStop').disabled = true;
                (pd.skippedIds || []).forEach(function(id) { addFailed(id, 'skipped'); });
                (pd.failedIds || []).forEach(function(id) { addFailed(id, 'failed'); });
                (pd.results || []).forEach(function(r) {
                    log(r.artist + ' - ' + r.title + ' | ' + r.source + ' | ' + r.fileWriteStatus);
                });
                log('done: ok' + pd.success + ' fail' + pd.failed + ' skip' + pd.skipped);
                toast('ok' + pd.success + ' fail' + pd.failed);
                await loadSongs();
                S.busy = false;
            }
        } catch (e2) { stopBatch(); }
    }, 2000);
}

async function loadCfg() {
    for (var i = 0; i < 3; i++) {
        try {
            var r = await af('./config');
            var t = await r.text();
            try { S.cfg = JSON.parse(t); uiCfg(); return; }
            catch (e2) { if (i < 2) { await sleep(1000); continue; } log('cfg parse err:' + t.substring(0, 80), 'e'); }
        } catch (e) {
            if (i < 2) { await sleep(1000); continue; }
            log('cfg load err:' + e.message, 'e');
        }
    }
}

async function saveCfg() {
    S.cfg.acoustid_api_key = E('ak').value.trim();
    S.cfg.netease_api_url = E('nu').value.trim();
    S.cfg.qqmusic_api_url = E('qu').value.trim();
    S.cfg.kugou_api_url = E('ku').value.trim();
    await af('./config', { method: 'PUT', body: JSON.stringify(S.cfg) });
    await loadCfg();
    await chkSources();
    toast('saved');
}

function uiCfg() {
    ['acoustid', 'netease', 'qqmusic', 'kugou'].forEach(function(s) {
        var st = E('st_' + s);
        var ss = S.srcStatus || {};
        if (ss.hasOwnProperty(s)) st.className = 'st ' + (ss[s] ? 'on' : 'off');
        else st.className = 'st';
    });
    E('cfg_acoustid').style.display = '';
    E('cfg_netease').style.display = '';
    E('cfg_qqmusic').style.display = '';
    E('cfg_kugou').style.display = '';
    E('ak').value = S.cfg.acoustid_api_key || '';
    E('nu').value = S.cfg.netease_api_url || '';
    E('qu').value = S.cfg.qqmusic_api_url || '';
    E('ku').value = S.cfg.kugou_api_url || '';
    E('cfgPanel').style.display = 'block';
}

async function chkFp() {
    try {
        var r = await af('./fpcalc/status');
        var d = await r.json();
        E('fpStat').textContent = d.available ? '已安装fpcalc' : '未安装fpcalc';
        E('btnInstallFpcalc').style.display = d.available ? 'none' : '';
    } catch (e) {}
}

async function installFpcalc() {
    var b = E('btnInstallFpcalc');
    b.disabled = true;
    b.innerHTML = '...';
    for (var i = 0; i < 3; i++) {
        try {
            var r = await af('./fpcalc/install', { method: 'POST' });
            var t = await r.text();
            try {
                var d = JSON.parse(t);
                if (d.success) { log('fpcalc ok'); toast('done'); E('btnInstallFpcalc').style.display = 'none'; await chkFp(); break; }
                else { log('fail:' + d.error, 'e'); break; }
            } catch (e2) { if (i < 2) { await sleep(1000); continue; } log('fp parse err:' + t.substring(0, 80), 'e'); }
        } catch (e) { if (i < 2) { await sleep(1000); continue; } log('fp load err:' + e.message, 'e'); }
    }
    b.disabled = false;
    b.innerHTML = '<span class="material-symbols-outlined">download</span> install fpcalc';
}

async function loadSongs(kw) {
    for (var i = 0; i < 3; i++) {
        try {
            var u = './songs?limit=10000';
            if (kw) u += '&q=' + encodeURIComponent(kw);
            var r = await af(u);
            var t = await r.text();
            try { var d = JSON.parse(t); S.songs = d.songs || []; render(); return; }
            catch (e2) { if (i < 2) { await sleep(1000); continue; } log('songs parse err:' + t.substring(0, 80), 'e'); }
        } catch (e) { if (i < 2) { await sleep(1000); continue; } log('songs load err:' + e.message, 'e'); }
    }
}

function search() { loadSongs(E('q').value.trim() || undefined); }

function render() {
    var c = E('list');
    if (!S.songs.length) {
        c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--md-on-surface-variant)">no songs</div>';
        return;
    }
    c.innerHTML = S.songs.map(function(s) {
        var sl = S.sel.has(s.id) ? ' sel' : '';
        var ck = S.sel.has(s.id) ? ' checked' : '';
        return '<div class="srow' + sl + '" onclick="tgl(' + s.id + ',event)">' +
            '<input type="checkbox"' + ck + ' onclick="event.stopPropagation();tgl(' + s.id + ')">' +
            '<div class="sinfo"><div class="t">' + esc(s.title || '?') + '</div>' +
            '<div class="u">' + (s.artist || '?') + (s.album ? ' · ' + esc(s.album) : '') + ' · ' + fm(s.duration) + '</div></div></div>';
    }).join('');
    upd();
}

function tgl(id, ev) { if (ev) ev.stopPropagation(); if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); render(); }
function selAll() { S.songs.forEach(function(s) { S.sel.add(s.id); }); render(); }
function selNone() { S.sel.clear(); render(); }

function upd() {
    var c = S.sel.size;
    var si = E('selInfo');
    if (si) si.textContent = c ? 'sel ' + c : '';
    E('btnOne').disabled = c !== 1;
    E('btnPrev').disabled = c !== 1;
    E('btnBatch').disabled = c === 0;
}

function ids() { return Array.from(S.sel); }

function switchTab(name) {
    document.querySelectorAll('.tab-content').forEach(function(e) { e.classList.remove('on'); });
    document.querySelectorAll('.tabs button').forEach(function(b) { b.classList.toggle('on', b.dataset.tab === name); });
    E('tab-' + name).classList.add('on');
    if (name === 'edit') loadEditView();
}

async function scrapeOne() {
    if (S.busy) return;
    var is = ids();
    if (is.length !== 1) return;
    S.busy = true;
    setP(true, 0);
    try {
        var r = await af('./scrape/' + is[0], { method: 'POST' });
        var d = await r.json();
        if (d.error) { log('fail:' + d.error, 'e'); addFailed(is[0], d.error); }
        else {
            log('ok ' + d.artist + ' - ' + d.title + ' | ' + d.source + ' | ' + d.fileWriteStatus);
            if (d.fileWriteStatus !== 'written') addFailed(is[0], d.fileWriteStatus);
            toast('done');
            await loadSongs();
        }
    } catch (e) { log('err:' + e.message, 'e'); }
    S.busy = false;
    setP(false, 100);
}

async function preview() {
    var is = ids();
    if (is.length !== 1) return;
    try {
        var r = await af('./scrape/preview/' + is[0], { method: 'POST' });
        var d = await r.json();
        if (d.error) { log('fail:' + d.error, 'e'); return; }
        S.prev = d;
        showPrev(d);
    } catch (e) { log('err:' + e.message, 'e'); }
}

function showPrev(d) {
    E('prevTitle').textContent = 'edit: ' + d.artist + ' - ' + d.title;
    E('ea').value = d.artist || '';
    E('et').value = d.title || '';
    E('eb').value = d.album || '';
    var sc = d.sourceScores ? Object.entries(d.sourceScores).map(function(e) { return e[0] + ':' + e[1].toFixed(2); }).join(', ') : '';
    E('prevMeta').innerHTML = 'src: ' + d.source + ' (' + (d.score || 0).toFixed(2) + ')' + (sc ? '<br>' + sc : '');
    E('prevCover').innerHTML = d.cover_url ? '<img src="' + d.cover_url + '" style="max-width:100%;border-radius:12px">' : '';
    E('prevModal').style.display = 'flex';
}

function closePrev() { E('prevModal').style.display = 'none'; S.prev = null; }

async function applyPrev() {
    var d = S.prev;
    if (!d) return;
    var art = E('ea').value.trim();
    var tit = E('et').value.trim();
    var alb = E('eb').value.trim();
    if (!art || !tit) { toast('required'); return; }
    d.artist = art; d.title = tit; d.album = alb;
    closePrev();
    S.busy = true;
    setP(true, 0);
    try {
        var cd = '';
        if (d.cover_url) {
            try {
                var cr = await fetch(d.cover_url);
                if (cr.ok) {
                    var buf = await cr.arrayBuffer();
                    var by = new Uint8Array(buf);
                    var bi = '';
                    for (var i = 0; i < by.length; i++) bi += String.fromCharCode(by[i]);
                    cd = btoa(bi);
                }
            } catch (e) {}
        }
        var r = await af('./tags/' + d.songId, { method: 'PUT', body: JSON.stringify({ title: tit, artist: art, album: alb, cover_data: cd }) });
        var rd = await r.json();
        if (rd.error) { log('写入失败:' + rd.error, 'e'); toast('失败'); }
        else { log('ok ' + art + ' - ' + tit + ' | ' + rd.file_write); toast('写入成功'); await loadSongs(); }
    } catch (e) { log('err:' + e.message, 'e'); }
    S.busy = false;
    setP(false, 100);
}

function stopBatch() {
    if (S._pollId) { clearInterval(S._pollId); S._pollId = 0; }
    localStorage.removeItem('batchTaskId');
    localStorage.removeItem('batchTotal');
    S.busy = false;
    setP(false, 100);
    E('ptxt').textContent = '';
    E('btnStop').disabled = true;
    log('batch stopped');
}

async function batch() {
    if (S.busy) return;
    stopBatch();
    var is = ids();
    if (!is.length) { toast('select first'); return; }
    S.busy = true;
    E('btnStop').disabled = false;
    setP(true, 0);
    var t = is.length;
    E('ptxt').textContent = '0/' + t;
    try {
        var r = await af('./scrape/batch', { method: 'POST', body: JSON.stringify({ ids: is }) });
        var d = await r.json();
        if (d.error) { log('batch err:' + d.error, 'e'); stopBatch(); return; }
        var taskId = d.taskId;
        log('batch started: ' + t + ' songs, taskId=' + taskId + ', already done skipped');
        localStorage.setItem('batchTaskId', taskId);
        localStorage.setItem('batchTotal', t);
        S._loggedCnt = -1;
        S._pollId = setInterval(async function() {
            try {
                var pr = await af('./scrape/batch/progress?taskId=' + taskId);
                if (!pr.ok) { stopBatch(); log('batch task lost'); return; }
                var pd = await pr.json();
                if (pd.error) { stopBatch(); return; }
                setP(true, Math.round(pd.current / pd.total * 100));
                var pe = E('ptxt');
                if (pe) pe.textContent = pd.current + '/' + pd.total;
                if (pd.lastLog && pd.loggedCount != S._loggedCnt) {
                    var ll = pd.lastLog.replace('| skipped', '| ok (no change)');
                    log(ll);
                    S._loggedCnt = pd.loggedCount;
                }
                (pd.skippedIds || []).forEach(function(id) { addFailed(id, 'skipped'); });
                (pd.failedIds || []).forEach(function(id) { addFailed(id, 'failed'); });
                if (pd.status === 'done') {
                    clearInterval(S._pollId); S._pollId = 0;
                    localStorage.removeItem('batchTaskId');
                    localStorage.removeItem('batchTotal');
                    setP(true, 100);
                    E('ptxt').textContent = '';
                    E('btnStop').disabled = true;
                    var doneLogs = 0;
                    (pd.results || []).forEach(function(r) {
                        if (S._loggedCnt === undefined || doneLogs >= S._loggedCnt) {
                            var st = r.fileWriteStatus === 'skipped' ? 'ok (no change)' : r.fileWriteStatus;
                            log(r.artist + ' - ' + r.title + ' | ' + r.source + ' | ' + st);
                        }
                        doneLogs++;
                    });
                    log('done: ok' + pd.success + ' fail' + pd.failed + ' skip' + pd.skipped);
                    toast('ok' + pd.success + ' fail' + pd.failed);
                    await loadSongs();
                    S.busy = false;
                }
            } catch (e2) { stopBatch(); }
        }, 2000);
    } catch (e) { log('batch err:' + e.message, 'e'); stopBatch(); }
}

async function addFailed(id, reason) {
    if (S.failedSongs.some(function(f) { return f.id === id && f.reason === reason; })) return;
    S.failedSongs.push({ id: id, reason: reason, time: new Date().toISOString() });
    try { await af('./storage/failed', { method: 'POST', body: JSON.stringify(S.failedSongs) }); }
    catch (e) { log('save failed err:' + e.message); }
    renderFailed();
}

async function loadFailed() {
    try { var r = await af('./storage/failed'); var d = await r.json(); S.failedSongs = d || []; }
    catch (e) { S.failedSongs = []; }
    renderFailed();
}

async function clearFailed() {
    S.failedSongs = [];
    try { await af('./storage/failed', { method: 'POST', body: '[]' }); } catch (e) {}
    renderFailed();
    toast('cleared');
}

function renderFailed() {
    var c = E('failedList');
    if (!S.failedSongs.length) {
        c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--md-on-surface-variant)">无失败记录</div>';
        return;
    }
    c.innerHTML = S.failedSongs.map(function(f, i) {
        var s = findSong(f.id);
        var art = s ? s.artist || '' : '?';
        var tit = s ? s.title || '' : '?';
        return '<div class="erow"><div class="sinfo"><div class="t">' + esc(tit) + '</div>' +
            '<div class="u">' + esc(art) + ' · ' + esc(f.reason || '') + '</div></div>' +
            '<input id="fk_' + i + '" placeholder="关键词" value="' + escH(art) + ' ' + escH(tit) + '">' +
            '<button class="btn btn-sm btn-s" onclick="retryFailed(' + i + ',' + f.id + ')">' +
            '<span class="material-symbols-outlined">search</span></button></div>';
    }).join('');
}

function findSong(id) {
    for (var i = 0; i < S.songs.length; i++) { if (S.songs[i].id === id) return S.songs[i]; }
    return null;
}

function loadEditView() {
    var kw = E('eq').value.trim().toLowerCase();
    var songs = kw ? S.songs.filter(function(s) {
        return (s.title || '').toLowerCase().indexOf(kw) >= 0 ||
               (s.artist || '').toLowerCase().indexOf(kw) >= 0 ||
               (s.album || '').toLowerCase().indexOf(kw) >= 0;
    }) : S.songs;
    var c = E('editSongList');
    if (!songs.length) {
        c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--md-on-surface-variant)">no matches</div>';
        return;
    }
    c.innerHTML = songs.map(function(s) {
        var sl = S_editId === s.id ? ' sel' : '';
        return '<div class="srow' + sl + '" onclick="selectEdit(' + s.id + ')" style="cursor:pointer">' +
            '<div class="sinfo"><div class="t">' + esc(s.title || '?') + '</div>' +
            '<div class="u">' + esc(s.artist || '?') + (s.album ? ' · ' + esc(s.album) : '') + ' · ' + fm(s.duration) + '</div></div></div>';
    }).join('');
}

async function selectEdit(id) {
    S_editId = id;
    var s = findSong(id);
    E('ef_tit').value = s ? s.title || '' : '';
    E('ef_art').value = s ? s.artist || '' : '';
    E('ef_alb').value = s ? s.album || '' : '';
    E('editPanel').style.display = '';
    loadEditView();
    try {
        var r = await af('./song/' + id);
        var d = await r.json();
        if (!d.error) {
            E('ef_gen').value = d.genre || '';
            E('ef_lyr').value = d.lyrics || '';
            var cov = E('editCover');
            if (d.cover_url) {
                try {
                    var t = SongloftPlugin.getAuthToken();
                    var cr = await fetch(d.cover_url, { headers: { Authorization: 'Bearer ' + t } });
                    if (cr.ok) {
                        var buf = await cr.arrayBuffer();
                        var by = new Uint8Array(buf);
                        var bi = '';
                        for (var j = 0; j < by.length; j++) bi += String.fromCharCode(by[j]);
                        cov.innerHTML = '<img src="data:image/jpeg;base64,' + btoa(bi) + '" style="width:100%;height:100%;object-fit:cover">';
                    } else { cov.innerHTML = '<span class="material-symbols-outlined">music_note</span>'; }
                } catch (e2) { cov.innerHTML = '<span class="material-symbols-outlined">music_note</span>'; }
            } else { cov.innerHTML = '<span class="material-symbols-outlined">music_note</span>'; }
        }
    } catch (e) {}
}

async function saveEditPanel() {
    if (!S_editId) return;
    var tit = E('ef_tit').value.trim();
    var art = E('ef_art').value.trim();
    var alb = E('ef_alb').value.trim();
    var gen = E('ef_gen').value.trim();
    var lyr = E('ef_lyr').value;
    try {
        var r = await af('./tags/' + S_editId, { method: 'PUT', body: JSON.stringify({ title: tit, artist: art, album: alb, genre: gen, lyrics: lyr }) });
        if (r.ok) {
            toast('saved');
            var s = findSong(S_editId);
            if (s) { s.title = tit; s.artist = art; s.album = alb; s.genre = gen; s.lyrics = lyr; }
            S.failedSongs = S.failedSongs.filter(function(f) { return f.id !== S_editId; });
            try { await af('./storage/failed', { method: 'POST', body: JSON.stringify(S.failedSongs) }); }
            catch (e) { log('save failed err:' + e.message); }
            renderFailed();
        }
    } catch (e) { toast('err:' + e.message); }
}

async function scrapeEdit() {
    if (!S_editId) return;
    try {
        var r = await af('./scrape/' + S_editId, { method: 'POST' });
        var d = await r.json();
        if (d.error) { log('刮削失败: ' + d.error, 'e'); toast('刮削失败'); }
        else {
            var st = d.fileWriteStatus === 'written' ? '写入成功' : d.fileWriteStatus === 'skipped' ? '已是最新' : '写入失败';
            log('刮削成功: ' + d.artist + ' - ' + d.title + ' | ' + d.source + ' | ' + st);
            selectEdit(S_editId);
            toast(st);
        }
    } catch (e) { log('刮削出错:' + e.message, 'e'); toast('刮削出错'); }
}

function setP(s, p) {
    var bar = E('pbar'); var fill = E('pfill');
    if (bar) bar.style.display = s ? '' : 'none';
    if (fill) fill.style.width = p + '%';
}

function log(m, l) {
    var c = E('log');
    if (!c) return;
    var d = document.createElement('div');
    d.className = l === 'e' ? 'e' : '';
    d.textContent = new Date().toLocaleTimeString() + ' ' + (m || '');
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    while (c.children.length > 200) c.firstChild.remove();
}

function toast(m) {
    var e = E('toast');
    e.textContent = m;
    e.style.display = 'block';
    setTimeout(function() { e.style.display = 'none'; }, 2000);
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fm(s) { if (!s || s <= 0) return '--:--'; var m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function escH(s) { var d = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }; return (s || '').replace(/[&<>"]/g, function(c) { return d[c] || c; }); }

function retryFailed(i, id) {
    var kw = E('fk_' + i).value.trim();
    if (!kw) { var s = findSong(id); kw = (s ? (s.artist || '') + ' ' + (s.title || '') : '').trim(); }
    if (!kw) { toast('need keyword'); return; }
    var s = findSong(id);
    S.retryId = id;
    E('ra').value = s ? s.artist || '' : '';
    E('rt').value = s ? s.title || '' : '';
    E('rk').value = kw;
    E('retryRes').innerHTML = '';
    E('retryModal').style.display = 'flex';
    switchTab('songs');
}

function closeRetry() { E('retryModal').style.display = 'none'; S.retryId = 0; }

async function doRetry() {
    var id = S.retryId;
    if (!id) return;
    var art = E('ra').value.trim();
    var tit = E('rt').value.trim();
    var kw = E('rk').value.trim() || (art + ' ' + tit);
    if (!kw) { toast('need keyword'); return; }
    try {
        var r = await af('./scrape/manual/' + id, { method: 'POST', body: JSON.stringify({ keyword: kw, artist: art, title: tit }) });
        var d = await r.json();
        if (d.error) { E('retryRes').innerHTML = '<div class="log e">' + d.error + '</div>'; return; }
        var sc = d.sourceScores ? Object.entries(d.sourceScores).map(function(e) { return e[0] + ':' + e[1].toFixed(2); }).join(', ') : '';
        E('retryRes').innerHTML = '<div style="padding:8px"><b>' + esc(d.artist) + ' - ' + esc(d.title) + '</b><br>album: ' + esc(d.album || '') +
            '<br>src: ' + d.source + ' (' + d.score.toFixed(2) + ')<br>' + sc +
            '<br><button class="btn btn-sm btn-p" data-art="' + escH(d.artist) + '" data-tit="' + escH(d.title) + '" data-alb="' + escH(d.album || '') +
            '" data-sid="' + id + '" onclick="applyR(this)" style="margin-top:4px"><span class="material-symbols-outlined">check</span> write</button></div>';
    } catch (e) { E('retryRes').innerHTML = '<div class="log e">' + e.message + '</div>'; }
}

async function applyR(el) {
    var id = parseInt(el.dataset.sid);
    var art = el.dataset.art;
    var tit = el.dataset.tit;
    var alb = el.dataset.alb;
    closeRetry();
    S.busy = true;
    setP(true, 0);
    try {
        var r = await af('./tags/' + id, { method: 'PUT', body: JSON.stringify({ title: tit, artist: art, album: alb }) });
        var d = await r.json();
        if (d.error) { log('写入失败:' + d.error, 'e'); toast('失败'); }
        else {
            log('ok ' + art + ' - ' + tit + ' | ' + d.file_write);
            toast('写入成功');
            S.failedSongs = S.failedSongs.filter(function(f) { return f.id !== id; });
            try { await af('./storage/failed', { method: 'POST', body: JSON.stringify(S.failedSongs) }); }
            catch (e) { log('save failed err:' + e.message); }
            renderFailed();
            await loadSongs();
        }
    } catch (e) { log('err:' + e.message, 'e'); }
    S.busy = false;
    setP(false, 100);
}

window.onload = init;
