import React, { useState, useEffect, useRef, useCallback } from 'react';
import './callAnalysis.css';
import {
  FASES, TIPOS, tipoOf, TEC, ICE, CAPAS, COLORES, fmtT, tituloAnalisis, blankMeta
} from './content';

// Puerto a React del prototipo standalone Analisis-de-Llamada.html (sistema
// "Gimnasio de Closing"). Antes cada quien tenía el archivo suelto en su
// computadora, guardado en localStorage y compartido a mano vía export/import
// de JSON. Acá gana persistencia real en Supabase, así que:
//   - el nombre del analista sale solo de la cuenta logueada (currentUser),
//   - "comparar con el grupo" deja de ser subir archivos: cualquiera de la
//     sala que haya titulado su análisis igual aparece solo en "Grupo",
//   - las notas se ven desde cualquier dispositivo, no solo el que las creó.
//
// Qué NO se portó todavía (a propósito, para no inflar más este primer PR):
//   - Exportar/imprimir PDF del reporte (el prototipo usa window.print() con
//     una hoja de estilos de impresión propia; portarla bien es un bloque de
//     trabajo aparte).
//   - Historial multi-dispositivo con "Duplicar" preservando notas de otra
//     persona — Duplicar acá copia notas y objeciones, pero queda sin probar
//     contra datos reales todavía.
// Ambos quedan anotados para un PR de seguimiento.
//
// La ventana flotante de notas (Document Picture-in-Picture, con fallback a
// un popup común) sigue siendo necesaria: el video que se analiza vive en
// Skool y no se puede incrustar en esta página, así que es la forma de
// tenerlo a la vista mientras se escribe acá.

const SUBTABS = [
  { id: 'notas', label: 'Notas' },
  { id: 'fases', label: 'Por fase' },
  { id: 'objeciones', label: 'Objeciones' },
  { id: 'tecnico', label: 'Técnico' },
  { id: 'plan', label: 'Mi plan' },
  { id: 'datos', label: 'Datos' },
  { id: 'consulta', label: 'Consulta' },
  { id: 'mis', label: 'Mis análisis' },
  { id: 'grupo', label: 'Grupo' }
];

function escapeHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export default function CallAnalysisView({ supabase, useMockDb, roomId, currentUser }) {
  const [subTab, setSubTab] = useState('notas');
  const [analyses, setAnalyses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [notes, setNotes] = useState([]);
  const [objections, setObjections] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingActive, setLoadingActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [noteText, setNoteText] = useState('');
  const [filtro, setFiltro] = useState('todas');

  // Cronómetro — nunca se persiste (igual que en el prototipo): reinicia en
  // cada visita, solo importa mientras se está mirando el video.
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  const [stampT, setStampT] = useState(null);
  const [setTimeInput, setSetTimeInput] = useState('');

  const [groupLoading, setGroupLoading] = useState(false);
  const [groupPeers, setGroupPeers] = useState([]);

  const disabled = useMockDb || !supabase || !roomId || !currentUser?.email;

  // ---- refs "valor vivo" para que la ventana flotante (DOM fuera de React)
  // siempre lea el estado actual en vez de quedarse con un closure viejo ----
  const liveRef = useRef({ t: 0, running: false, stampT: null, activeId: null });
  const notesRef = useRef([]);
  const addNoteWithTextRef = useRef(() => {});
  const loadGroupRef = useRef(() => {});
  const pipWinRef = useRef(null);
  const pipElsRef = useRef(null);
  const saveTimers = useRef({});

  useEffect(() => { liveRef.current = { t, running, stampT, activeId }; }, [t, running, stampT, activeId]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // ================= análisis: alta, listado, apertura =================

  const createAnalysis = useCallback(async () => {
    if (disabled) return null;
    const row = {
      room_id: roomId,
      member_email: currentUser.email,
      member_name: currentUser.name || '',
      titulo: 'Sin título',
      meta: { ...blankMeta(), analista: currentUser.name || '' },
      principios: {}, tec: {}, ice: {}, color: {}, plan: {}
    };
    const { data, error } = await supabase.from('call_analyses').insert(row).select().single();
    if (error) { setErrorMsg('No se pudo crear el análisis: ' + error.message); return null; }
    setAnalyses(prev => [data, ...prev]);
    setActiveId(data.id);
    setSubTab('datos');
    return data;
  }, [disabled, supabase, roomId, currentUser]);

  useEffect(() => {
    if (disabled) { setLoadingList(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      const { data, error } = await supabase
        .from('call_analyses')
        .select('id, titulo, meta, created_at')
        .eq('room_id', roomId)
        .eq('member_email', currentUser.email)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) { setErrorMsg(error.message); setLoadingList(false); return; }
      if (data && data.length) {
        setAnalyses(data);
        setActiveId(prev => prev || data[0].id);
      } else {
        await createAnalysis();
      }
      setLoadingList(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, roomId, currentUser?.email]);

  useEffect(() => {
    if (disabled || !activeId) { setActive(null); setNotes([]); setObjections([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingActive(true);
      const [a, ns, os] = await Promise.all([
        supabase.from('call_analyses').select('*').eq('id', activeId).single(),
        supabase.from('call_notes').select('*').eq('analysis_id', activeId).order('t', { ascending: true }),
        supabase.from('call_objections').select('*').eq('analysis_id', activeId).order('created_at', { ascending: true })
      ]);
      if (cancelled) return;
      if (a.error) setErrorMsg(a.error.message); else setActive(a.data);
      if (!ns.error) setNotes(ns.data || []);
      if (!os.error) setObjections(os.data || []);
      setLoadingActive(false);
    })();
    return () => { cancelled = true; };
  }, [disabled, activeId, supabase]);

  function patchActive(field, value) {
    setActive(prev => (prev ? { ...prev, [field]: value } : prev));
    if (field === 'titulo' || field === 'meta') {
      setAnalyses(prev => prev.map(a => (a.id === activeId
        ? { ...a, ...(field === 'titulo' ? { titulo: value } : { meta: value }) }
        : a)));
    }
    clearTimeout(saveTimers.current[field]);
    saveTimers.current[field] = setTimeout(async () => {
      if (disabled || !activeId) return;
      const { error } = await supabase.from('call_analyses')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', activeId);
      if (error) setErrorMsg('No se pudo guardar: ' + error.message);
    }, 500);
  }

  const updateTitulo = (v) => patchActive('titulo', v);
  const updateMeta = (k, v) => patchActive('meta', { ...(active?.meta || {}), [k]: v });
  const updatePrincipio = (faseId, v) => patchActive('principios', { ...(active?.principios || {}), [faseId]: v });
  const updateTec = (id, patch) => {
    const cur = (active?.tec || {})[id] || {};
    patchActive('tec', { ...(active?.tec || {}), [id]: { ...cur, ...patch } });
  };
  const updateIce = (id, v) => patchActive('ice', { ...(active?.ice || {}), [id]: v });
  const updateColor = (k, v) => patchActive('color', { ...(active?.color || {}), [k]: v });
  const updatePlan = (k, v) => patchActive('plan', { ...(active?.plan || {}), [k]: v });

  async function duplicateAnalysis(id) {
    if (disabled) return;
    const { data: full, error } = await supabase.from('call_analyses').select('*').eq('id', id).single();
    if (error || !full) { setErrorMsg('No se pudo leer el análisis a duplicar.'); return; }
    // eslint-disable-next-line no-unused-vars
    const { id: _drop, created_at, updated_at, ...rest } = full;
    const { data: created, error: e2 } = await supabase.from('call_analyses').insert(rest).select().single();
    if (e2) { setErrorMsg(e2.message); return; }
    const { data: srcNotes } = await supabase.from('call_notes').select('t,text,fase,tipo').eq('analysis_id', id);
    if (srcNotes && srcNotes.length) {
      await supabase.from('call_notes').insert(srcNotes.map(n => ({ ...n, analysis_id: created.id, room_id: roomId })));
    }
    const { data: srcObjs } = await supabase.from('call_objections').select('minuto,frase,lecturas,verificada,notas').eq('analysis_id', id);
    if (srcObjs && srcObjs.length) {
      await supabase.from('call_objections').insert(srcObjs.map(o => ({ ...o, analysis_id: created.id, room_id: roomId })));
    }
    setAnalyses(prev => [created, ...prev]);
    setActiveId(created.id);
  }

  async function deleteAnalysisRow(id) {
    if (analyses.length <= 1) { alert('Es el único análisis. Creá otro antes de borrar este.'); return; }
    if (!confirm('¿Borrar este análisis? No se puede deshacer.')) return;
    const { error } = await supabase.from('call_analyses').delete().eq('id', id);
    if (error) { setErrorMsg(error.message); return; }
    setAnalyses(prev => {
      const next = prev.filter(a => a.id !== id);
      if (activeId === id) setActiveId(next[0] ? next[0].id : null);
      return next;
    });
  }

  // ================= cronómetro =================
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setT(v => v + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  function applySetTime() {
    const v = setTimeInput.trim();
    const m = v.match(/^(\d+)[:.\s]?(\d{1,2})?$/);
    if (!m) { alert('Escribí el minuto así: 12:30'); return; }
    setT(parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
    setStampT(null);
  }

  // ================= notas =================
  const addNoteWithText = useCallback(async (text) => {
    const clean = (text || '').trim();
    const targetId = liveRef.current.activeId;
    if (!clean || !targetId || disabled) return;
    const tv = liveRef.current.stampT === null ? liveRef.current.t : liveRef.current.stampT;
    const row = { analysis_id: targetId, room_id: roomId, t: tv, text: clean, fase: '', tipo: '' };
    const { data, error } = await supabase.from('call_notes').insert(row).select().single();
    if (error) { setErrorMsg('No se pudo guardar la nota: ' + error.message); return; }
    if (liveRef.current.activeId === targetId) {
      setNotes(prev => [...prev, data].sort((a, b) => a.t - b.t));
    }
    setStampT(null);
  }, [disabled, supabase, roomId]);
  useEffect(() => { addNoteWithTextRef.current = addNoteWithText; }, [addNoteWithText]);

  async function addNote() {
    await addNoteWithText(noteText);
    setNoteText('');
  }

  async function updateNoteField(id, patch) {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)));
    if (disabled) return;
    const { error } = await supabase.from('call_notes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) setErrorMsg(error.message);
  }
  async function deleteNote(id) {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (disabled) return;
    await supabase.from('call_notes').delete().eq('id', id);
  }

  // ================= objeciones =================
  async function addObjection() {
    if (disabled || !activeId) return;
    const row = { analysis_id: activeId, room_id: roomId, minuto: '', frase: '', lecturas: '', verificada: '', notas: '' };
    const { data, error } = await supabase.from('call_objections').insert(row).select().single();
    if (error) { setErrorMsg(error.message); return; }
    setObjections(prev => [...prev, data]);
  }
  async function updateObjection(id, patch) {
    setObjections(prev => prev.map(o => (o.id === id ? { ...o, ...patch } : o)));
    clearTimeout(saveTimers.current['obj-' + id]);
    saveTimers.current['obj-' + id] = setTimeout(async () => {
      if (disabled) return;
      const { error } = await supabase.from('call_objections').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) setErrorMsg(error.message);
    }, 500);
  }
  async function deleteObjection(id) {
    setObjections(prev => prev.filter(o => o.id !== id));
    if (disabled) return;
    await supabase.from('call_objections').delete().eq('id', id);
  }

  // ================= grupo =================
  const loadGroup = useCallback(async () => {
    if (disabled || !active) return;
    setGroupLoading(true);
    const { data: peers, error } = await supabase
      .from('call_analyses')
      .select('id, member_name, member_email, titulo, principios, created_at')
      .eq('room_id', roomId)
      .eq('titulo', active.titulo);
    if (error) { setErrorMsg(error.message); setGroupLoading(false); return; }
    const ids = (peers || []).map(p => p.id);
    const byAnalysis = {};
    if (ids.length) {
      const { data: allNotes } = await supabase.from('call_notes').select('*').in('analysis_id', ids);
      (allNotes || []).forEach(n => { (byAnalysis[n.analysis_id] || (byAnalysis[n.analysis_id] = [])).push(n); });
    }
    setGroupPeers((peers || []).map(p => ({ ...p, notes: byAnalysis[p.id] || [] })));
    setGroupLoading(false);
  }, [disabled, supabase, roomId, active]);
  useEffect(() => { loadGroupRef.current = loadGroup; }, [loadGroup]);
  useEffect(() => { if (subTab === 'grupo') loadGroup(); }, [subTab, loadGroup]);

  // Live update de "Grupo" cuando otra persona de la sala guarda su propio
  // análisis — mismo patrón de refetch-con-debounce que ya usa el resto de
  // la app (ver useEffect de "LA SALA EN VIVO" en App.jsx).
  useEffect(() => {
    if (disabled) return;
    let pending = null;
    const refresh = () => {
      clearTimeout(pending);
      pending = setTimeout(() => loadGroupRef.current(), 500);
    };
    const filtro2 = `room_id=eq.${roomId}`;
    const channel = supabase.channel(`analisis-llamada:${roomId}`);
    ['call_analyses', 'call_notes', 'call_objections'].forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: filtro2 }, refresh);
    });
    channel.subscribe();
    return () => { clearTimeout(pending); supabase.removeChannel(channel); };
  }, [disabled, supabase, roomId]);

  // ================= ventana flotante de notas =================
  function paintPip() {
    const els = pipElsRef.current; if (!els) return;
    els.clock.textContent = fmtT(liveRef.current.t);
    els.clock.classList.toggle('run', liveRef.current.running);
    els.stampBtn.textContent = fmtT(liveRef.current.stampT === null ? liveRef.current.t : liveRef.current.stampT);
    els.play.textContent = liveRef.current.running ? '❚❚' : '▶';
  }
  function renderPipRecent() {
    const els = pipElsRef.current; if (!els) return;
    const ns = notesRef.current.slice(-4).reverse();
    els.recent.innerHTML = ns.length
      ? ns.map(n => `<div class="ca-pip-note"><b>${fmtT(n.t)}</b>${escapeHtml(n.text)}</div>`).join('')
      : '<div class="ca-pip-empty">Sin notas todavía.</div>';
  }
  useEffect(() => { paintPip(); }, [t, running, stampT]);
  useEffect(() => { renderPipRecent(); }, [notes]);

  function buildFloatingUI(win) {
    const doc = win.document;
    doc.title = 'Notas — Análisis de Llamada';
    try {
      [...document.styleSheets].forEach(sheet => {
        try {
          const rules = [...sheet.cssRules].map(r => r.cssText).join('');
          const st = doc.createElement('style'); st.textContent = rules; doc.head.appendChild(st);
        } catch {
          if (sheet.href) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; doc.head.appendChild(link); }
        }
      });
    } catch { /* hoja cross-origin: se ignora, el resto igual aplica */ }
    if (document.documentElement.classList.contains('dark')) doc.documentElement.classList.add('dark');
    doc.body.className = 'ca-pip-body';
    doc.body.innerHTML = `
      <div class="ca-pip-head">
        <button class="btn btn-outline ca-pip-icon" id="pPlay" title="Arrancar / pausar">▶</button>
        <div class="ca-clock" id="pClock">00:00</div>
        <span class="ca-pip-title">Notas · flotante</span>
      </div>
      <div class="ca-pip-row">
        <button class="ca-stamp" id="pStamp" title="Usa el minuto actual">00:00</button>
        <textarea class="ca-pip-ta form-input" id="pTa" rows="2" placeholder="Qué pasó, qué dijo…"></textarea>
      </div>
      <button class="btn btn-indigo" id="pAdd" style="width:100%;margin-bottom:10px">Agregar nota</button>
      <div class="ca-pip-hint">Enter agrega · Shift+Enter baja de línea</div>
      <div class="ca-pip-recent" id="pRecent"></div>
    `;
    const els = {
      play: doc.getElementById('pPlay'), clock: doc.getElementById('pClock'),
      stampBtn: doc.getElementById('pStamp'), ta: doc.getElementById('pTa'),
      addBtn: doc.getElementById('pAdd'), recent: doc.getElementById('pRecent')
    };
    pipElsRef.current = els;
    els.play.onclick = () => setRunning(r => !r);
    els.stampBtn.onclick = () => setStampT(s => (s === null ? liveRef.current.t : null));
    const submit = () => {
      addNoteWithTextRef.current(els.ta.value);
      els.ta.value = ''; els.ta.style.height = 'auto'; els.ta.focus();
    };
    els.addBtn.onclick = submit;
    els.ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    els.ta.focus();
    paintPip();
    renderPipRecent();
  }

  async function openFloatingNotes() {
    if (pipWinRef.current && !pipWinRef.current.closed) { try { pipWinRef.current.focus(); } catch { /* noop */ } return; }
    let win = null;
    if ('documentPictureInPicture' in window) {
      try { win = await window.documentPictureInPicture.requestWindow({ width: 320, height: 500 }); } catch { win = null; }
    }
    if (!win) {
      win = window.open('', 'notasFlotantesCA', 'width=340,height=560,popup=1');
      if (!win) { alert('El navegador bloqueó la ventana flotante. Permití ventanas emergentes para este sitio y volvé a apretar «Flotante».'); return; }
    }
    pipWinRef.current = win;
    buildFloatingUI(win);
    const cleanup = () => { pipWinRef.current = null; pipElsRef.current = null; };
    win.addEventListener('pagehide', cleanup);
    win.addEventListener('unload', cleanup);
  }

  // ================= render =================

  if (disabled) {
    return (
      <div className="section-card glass">
        <h3 className="section-title">Análisis de Llamada</h3>
        <div className="empty-state">
          <div className="empty-state-title">No disponible en este modo</div>
          <p className="empty-state-desc">
            Esta pestaña necesita una sala real conectada a Supabase (no funciona con la base de datos de prueba local).
          </p>
        </div>
      </div>
    );
  }

  const filteredNotes = (filtro === 'todas' ? notes : notes.filter(n => (n.tipo || '') === (filtro === 'sin' ? '' : filtro)))
    .slice().sort((a, b) => a.t - b.t);
  const noteCounts = { todas: notes.length };
  TIPOS.forEach(x => { noteCounts[x.id || 'sin'] = notes.filter(n => (n.tipo || '') === x.id).length; });

  return (
    <div className="ca-wrap">
      <div className="section-card glass" style={{ gap: 12 }}>
        <div className="ca-timerbar">
          <button type="button" className="btn btn-outline" onClick={() => setRunning(r => !r)} title="Arrancar / pausar">
            {running ? '❚❚' : '▶'}
          </button>
          <div className={`ca-clock ${running ? 'run' : ''}`}>{fmtT(t)}</div>
          <input
            className="form-input ca-time-set" placeholder="12:30" value={setTimeInput}
            onChange={e => setSetTimeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applySetTime(); }}
            title="Poner el cronómetro en el minuto del video"
          />
          <button type="button" className="btn btn-outline btn-small" onClick={applySetTime}>Sincronizar</button>
          <button type="button" className="btn btn-outline btn-small" onClick={() => { setRunning(false); setT(0); setStampT(null); }}>Reiniciar</button>
          <button type="button" className="btn btn-outline btn-small" onClick={openFloatingNotes} title="Ventana de notas separada, para dejarla arriba del video (Skool, Zoom, YouTube...)">
            🗗 Flotante
          </button>
          {active && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{tituloAnalisis(active)}</span>}
        </div>
        {errorMsg && (
          <div style={{ fontSize: 12, color: 'var(--color-danger)' }}>
            {errorMsg} <button type="button" className="btn-danger-icon" onClick={() => setErrorMsg('')} style={{ display: 'inline' }}>✕</button>
          </div>
        )}
        <div className="ca-subnav">
          {SUBTABS.map(s => (
            <button key={s.id} type="button" className={`ca-subnav-btn ${subTab === s.id ? 'active' : ''}`} onClick={() => setSubTab(s.id)}>
              {s.label}
              {s.id === 'notas' && notes.length > 0 && <span className="ca-subnav-badge">{notes.length}</span>}
              {s.id === 'objeciones' && objections.length > 0 && <span className="ca-subnav-badge">{objections.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {loadingList || loadingActive ? (
        <div className="section-card glass"><div className="empty-state">Cargando…</div></div>
      ) : !active ? (
        <div className="section-card glass"><div className="empty-state">Sin análisis todavía.</div></div>
      ) : (
        <>
          {subTab === 'notas' && (
            <div className="section-card glass">
              <h3 className="section-title">Notas rápidas</h3>
              <p className="section-subtitle">Escribí sin pensar en qué fase va. El minuto se marca solo. Después las ordenás desde acá o desde «Por fase».</p>
              <div className="ca-capture" style={{ background: 'var(--bg-card-hover)', borderRadius: 14 }}>
                <button type="button" className="ca-stamp" title="Usa el minuto actual del cronómetro" onClick={() => setStampT(s => (s === null ? t : null))}>
                  {fmtT(stampT === null ? t : stampT)}
                </button>
                <textarea
                  className="form-input" rows={1} placeholder="Qué pasó, qué dijo, qué notaste…"
                  value={noteText} onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }}
                />
                <button type="button" className="btn btn-indigo" onClick={addNote}>Agregar</button>
              </div>
              <div className="ca-capture-hint">Enter agrega la nota · Shift+Enter baja de línea · el botón azul fija el minuto de la nota</div>

              <div className="ca-filters">
                <span className={`ca-chip ${filtro === 'todas' ? 'active' : ''}`} onClick={() => setFiltro('todas')}>Todas ({noteCounts.todas})</span>
                {TIPOS.map(x => {
                  const k = x.id || 'sin';
                  return <span key={k} className={`ca-chip ${filtro === k ? 'active' : ''}`} onClick={() => setFiltro(k)}>{x.n} ({noteCounts[k] || 0})</span>;
                })}
              </div>

              {filteredNotes.length === 0 ? (
                <div className="empty-state"><div className="empty-state-desc">Todavía no hay notas. Dale play al video, escribí arriba y apretá Enter.</div></div>
              ) : filteredNotes.map(n => {
                const tipo = tipoOf(n.tipo);
                return (
                  <div key={n.id} className="ca-note-row" style={{ borderLeftColor: tipo.c }}>
                    <div className="ca-t" onClick={() => { setT(n.t); setStampT(null); }} title="Poner el cronómetro en este minuto">{fmtT(n.t)}</div>
                    <div
                      className="ca-txt" contentEditable suppressContentEditableWarning
                      onBlur={e => { const val = e.target.textContent.trim(); if (val !== n.text) updateNoteField(n.id, { text: val }); }}
                    >{n.text}</div>
                    <div className="ca-note-ctl">
                      <select className="form-select" value={n.fase || ''} onChange={e => updateNoteField(n.id, { fase: e.target.value })}>
                        <option value="">— fase —</option>
                        {FASES.map(f => <option key={f.id} value={f.id}>{f.n}</option>)}
                      </select>
                      <select className="form-select" value={n.tipo || ''} onChange={e => updateNoteField(n.id, { tipo: e.target.value })}>
                        {TIPOS.map(x => <option key={x.id || 'sin'} value={x.id}>{x.n}</option>)}
                      </select>
                      <button type="button" className="btn-danger-icon" onClick={() => deleteNote(n.id)} title="Borrar">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {subTab === 'fases' && (
            <div className="section-card glass">
              <h3 className="section-title">Observación por fase</h3>
              <p className="section-subtitle">Las notas que clasificaste aparecen solas en su fase. Abajo de cada una escribís el principio general: la regla que te llevás para cualquier llamada futura.</p>
              {FASES.map(f => {
                const ns = notes.filter(n => n.fase === f.id).sort((a, b) => a.t - b.t);
                return (
                  <div key={f.id} className="ca-fase-card">
                    <div className="ca-fase-head"><b>{f.n}</b><span>{f.alt}</span><span style={{ marginLeft: 'auto' }}>{ns.length} nota{ns.length === 1 ? '' : 's'}</span></div>
                    <div className="ca-fase-body">
                      <div className="ca-fase-hint"><b>Qué mirar:</b> {f.mirar}<br /><b style={{ color: 'var(--color-accent)' }}>Salió bien si:</b> {f.bien}</div>
                      {ns.length === 0 ? (
                        <div className="ca-fase-hint">Sin notas asignadas a esta fase todavía.</div>
                      ) : ns.map(n => {
                        const tipo = tipoOf(n.tipo);
                        return (
                          <div key={n.id} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                            <b style={{ color: tipo.c, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtT(n.t)}</b>
                            <span>{n.text}</span>
                          </div>
                        );
                      })}
                      <div className="form-group">
                        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                          Principio general aplicable — la regla que te llevás
                        </label>
                        <textarea
                          className="form-input" rows={2}
                          placeholder="Ej: conectar el problema con su impacto diario acelera la profundidad en Descubrimiento"
                          value={(active.principios || {})[f.id] || ''}
                          onChange={e => updatePrincipio(f.id, e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {subTab === 'objeciones' && (
            <div className="section-card glass">
              <h3 className="section-title">Objeciones</h3>
              <p className="section-subtitle">Separá el hecho de la interpretación. Escribí la frase literal, pensá 2 o 3 lecturas posibles, y marcá si el closer la verificó con una pregunta o se quedó con la primera.</p>
              {objections.length === 0 ? (
                <div className="empty-state"><div className="empty-state-desc">Sin objeciones cargadas. Agregá una con el botón de abajo.</div></div>
              ) : objections.map((o, i) => (
                <div key={o.id} className="section-card" style={{ padding: 16, background: 'var(--bg-card-hover)', borderRadius: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>Objeción {i + 1}</b>
                    <button type="button" className="btn-danger-icon" onClick={() => deleteObjection(o.id)}>✕</button>
                  </div>
                  <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-group">
                      <label>Minuto</label>
                      <input className="form-input" value={o.minuto || ''} placeholder="Ej: 34:12" onChange={e => updateObjection(o.id, { minuto: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>¿La verificó con una pregunta?</label>
                      <select className="form-select" value={o.verificada || ''} onChange={e => updateObjection(o.id, { verificada: e.target.value })}>
                        <option value="">— elegir —</option>
                        <option value="Sí">Sí</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Frase literal del prospecto</label>
                    <textarea className="form-input" placeholder="Copiá lo que dijo, textual" value={o.frase || ''} onChange={e => updateObjection(o.id, { frase: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Interpretaciones posibles (2 o 3, antes de quedarte con la primera)</label>
                    <textarea className="form-input" placeholder={'1) …\n2) …\n3) …'} value={o.lecturas || ''} onChange={e => updateObjection(o.id, { lecturas: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Principio general</label>
                    <textarea className="form-input" value={o.notas || ''} onChange={e => updateObjection(o.id, { notas: e.target.value })} />
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-indigo" onClick={addObjection}>+ Agregar objeción</button>
            </div>
          )}

          {subTab === 'tecnico' && (
            <div className="section-card glass">
              <h3 className="section-title">Cuestiones técnicas high-ticket</h3>
              <p className="section-subtitle">No son «comunicación», pero hunden llamadas. Marcá cada punto y anotá el minuto o el detalle.</p>
              {TEC.map(x => {
                const v = (active.tec || {})[x.id] || {};
                return (
                  <div key={x.id} className="ca-tec-row">
                    <div className="ca-q"><b>{x.t}</b><i>{x.d}</i></div>
                    <div className="ca-a">
                      <div className="ca-tri">
                        {['si', 'no', 'na'].map(opt => (
                          <button key={opt} type="button" data-v={opt} className={v.e === opt ? 'active' : ''}
                            onClick={() => updateTec(x.id, { e: v.e === opt ? '' : opt })}>
                            {opt === 'si' ? 'Sí' : opt === 'no' ? 'No' : 'N/A'}
                          </button>
                        ))}
                      </div>
                      <input className="form-input" style={{ flex: 1 }} value={v.n || ''} placeholder="Minuto o detalle" onChange={e => updateTec(x.id, { n: e.target.value })} />
                    </div>
                  </div>
                );
              })}

              <h3 className="section-title" style={{ marginTop: 10 }}>Iceberg del Descubrimiento</h3>
              <p className="section-subtitle">Marcá el minuto del nivel más profundo alcanzado con evidencia, no el que se podría haber alcanzado.</p>
              {ICE.map(x => (
                <div key={x.id} className="ca-ice-row">
                  <div className="ca-ice-bar" style={{ background: x.c }} />
                  <div className="ca-ice-lb"><b>{x.n}</b> — <span>{x.q}</span></div>
                  <input className="form-input" value={(active.ice || {})[x.id] || ''} placeholder="Minuto" onChange={e => updateIce(x.id, e.target.value)} />
                </div>
              ))}

              <h3 className="section-title" style={{ marginTop: 10 }}>Color de personalidad del prospecto</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Color dominante</label>
                  <select className="form-select" value={(active.color || {}).dom || ''} onChange={e => updateColor('dom', e.target.value)}>
                    <option value="">— elegir —</option><option>Rojo</option><option>Amarillo</option><option>Verde</option><option>Azul</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Color secundario</label>
                  <select className="form-select" value={(active.color || {}).sec || ''} onChange={e => updateColor('sec', e.target.value)}>
                    <option value="">— elegir —</option><option>Rojo</option><option>Amarillo</option><option>Verde</option><option>Azul</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>¿El closer se adaptó a ese color?</label>
                  <select className="form-select" value={(active.color || {}).adapt || ''} onChange={e => updateColor('adapt', e.target.value)}>
                    <option value="">— elegir —</option><option>Sí</option><option>No</option><option>A medias</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Evidencia (qué dijo o hizo que te lo mostró)</label>
                <textarea className="form-input" value={(active.color || {}).evi || ''} onChange={e => updateColor('evi', e.target.value)} />
              </div>
            </div>
          )}

          {subTab === 'plan' && (
            <div className="section-card glass">
              <h3 className="section-title">Mi plan como closer</h3>
              <p className="section-subtitle">Después de mirar la llamada: ¿en qué te reconociste y qué vas a probar distinto en la próxima?</p>
              {[
                ['fase', '¿En qué fase me reconocí?'],
                ['distinto', '¿Qué voy a hacer distinto?'],
                ['frase', 'Frase exacta que voy a probar'],
                ['saber', '¿Cómo voy a saber si funcionó?']
              ].map(([k, label]) => (
                <div key={k} className="form-group">
                  <label>{label}</label>
                  <textarea className="form-input" value={(active.plan || {})[k] || ''} onChange={e => updatePlan(k, e.target.value)} />
                </div>
              ))}
            </div>
          )}

          {subTab === 'datos' && (
            <div className="section-card glass">
              <h3 className="section-title">Datos de la llamada</h3>
              <p className="section-subtitle">Se completa antes de darle play. Sirve para que después se entienda el contexto de tus notas.</p>
              <div className="form-group">
                <label>Título de la llamada (así te encuentra el grupo si alguien más la analiza)</label>
                <input className="form-input" value={active.titulo || ''} placeholder="Ej: Llamada ejemplo — semana 3" onChange={e => updateTitulo(e.target.value)} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Analiza: <b style={{ color: 'var(--text-main)' }}>{active.member_name || currentUser.name}</b> ({active.member_email || currentUser.email})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group"><label>Fecha del análisis</label><input type="date" className="form-input" value={(active.meta || {}).fecha || ''} onChange={e => updateMeta('fecha', e.target.value)} /></div>
                <div className="form-group"><label>Closer de la llamada</label><input className="form-input" placeholder="Nombre o «externa»" value={(active.meta || {}).closer || ''} onChange={e => updateMeta('closer', e.target.value)} /></div>
                <div className="form-group"><label>Rubro del prospecto</label><input className="form-input" value={(active.meta || {}).rubro || ''} onChange={e => updateMeta('rubro', e.target.value)} /></div>
                <div className="form-group"><label>Cómo llegó</label><input className="form-input" placeholder="Referido, anuncio, contenido…" value={(active.meta || {}).origen || ''} onChange={e => updateMeta('origen', e.target.value)} /></div>
                <div className="form-group"><label>Qué dice que necesita</label><input className="form-input" value={(active.meta || {}).necesita || ''} onChange={e => updateMeta('necesita', e.target.value)} /></div>
                <div className="form-group"><label>Producto y precio</label><input className="form-input" value={(active.meta || {}).producto || ''} onChange={e => updateMeta('producto', e.target.value)} /></div>
                <div className="form-group"><label>Duración total</label><input className="form-input" placeholder="Ej: 48:20" value={(active.meta || {}).duracion || ''} onChange={e => updateMeta('duracion', e.target.value)} /></div>
                <div className="form-group">
                  <label>Resultado</label>
                  <select className="form-select" value={(active.meta || {}).resultado || ''} onChange={e => updateMeta('resultado', e.target.value)}>
                    <option value="">— elegir —</option><option>Cerró</option><option>No cerró</option><option>Quedó pendiente</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {subTab === 'consulta' && (
            <div className="section-card glass" style={{ gap: 18 }}>
              <h3 className="section-title">Material de consulta</h3>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Vocabulario común — cada fase tiene varios nombres</b>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table className="ca-vocab-table">
                    <thead><tr><th style={{ width: '20%' }}>Acá lo llamamos</th><th style={{ width: '45%' }}>También se le dice</th><th>En una frase</th></tr></thead>
                    <tbody>
                      <tr><td><b>Química</b></td><td>Rapport · Apertura · Conexión · Ice breaker · Small talk</td><td>Los primeros minutos, romper el hielo.</td></tr>
                      <tr><td><b>Marco</b></td><td>Encuadre · Frame · Setup · Agenda · Reglas del juego</td><td>Explicar cómo va a ser la llamada y qué pasa al final.</td></tr>
                      <tr><td><b>Descubrimiento</b></td><td>Discovery · Diagnóstico · Indagación · Calificación</td><td>Preguntar y escuchar para entender el problema real.</td></tr>
                      <tr><td><b>Transición</b></td><td>Puente · Bridge · Recap · Resumen · Espejo</td><td>Resumir lo entendido y pedir permiso para presentar.</td></tr>
                      <tr><td><b>Pitch</b></td><td>Presentación · Oferta · Propuesta · Solución</td><td>Mostrar la solución y el precio.</td></tr>
                      <tr><td><b>Cierre</b></td><td>Closing · Petición de decisión · Manejo de objeciones</td><td>Pedir la decisión y resolver lo que frena.</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Las 6 fases — qué mirar en cada una</b>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {FASES.map(f => (
                    <div key={f.id} style={{ fontSize: 12.5 }}>
                      <b style={{ color: 'var(--color-accent)' }}>{f.n}</b> <span style={{ color: 'var(--text-muted)' }}>— {f.alt}</span>
                      <div><b>Qué pasa:</b> {f.pasa}</div>
                      <div><b>Qué mirar:</b> {f.mirar}</div>
                      <div><b>Salió bien si:</b> {f.bien}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Qué observar siempre — Palabras, Voz, Cuerpo, Imagen</b>
                <div className="ca-ref-grid" style={{ marginTop: 8 }}>
                  {CAPAS.map(c => (
                    <div key={c.n} className="ca-ref-card">
                      <div className="ca-ref-card-head" style={{ background: c.c }}><span>{c.n}</span><i>{c.s}</i></div>
                      <div className="ca-ref-card-body">{c.items.map(i => <div key={i[0]}><b>{i[0]}:</b> {i[1]}</div>)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Cómo se conectan las piezas</b>
                <div style={{ marginTop: 8 }}>
                  <div className="ca-linkrow"><b>Imagen + Voz + Palabras →</b> te dan el color de personalidad.</div>
                  <div className="ca-linkrow"><b>Color de personalidad →</b> te dice cómo debería sonar el Pitch y el Cierre.</div>
                  <div className="ca-linkrow"><b>Nivel del Iceberg alcanzado →</b> explica la fuerza de las objeciones del Cierre.</div>
                  <div className="ca-linkrow"><b>Cuerpo y Voz del prospecto →</b> son la señal de que hay algo sin decir.</div>
                  <div className="ca-linkrow"><b>Marco flojo →</b> casi siempre reaparece como «lo tengo que pensar» en el Cierre.</div>
                </div>
              </div>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Los 4 colores de personalidad</b>
                <div className="ca-ref-grid" style={{ marginTop: 8 }}>
                  {COLORES.map(c => (
                    <div key={c.n} className="ca-ref-card">
                      <div className="ca-ref-card-head" style={{ background: c.c }}><span>{c.n}</span><i>{c.t}</i></div>
                      <div className="ca-ref-card-body">{c.items.map(i => <div key={i[0]}><b>{i[0]}:</b> {i[1]}</div>)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Iceberg del Descubrimiento y secuencia P.A.R.A.</b>
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table className="ca-vocab-table">
                    <tbody>
                      <tr><td><b>1. Situación</b></td><td>¿Qué está ocurriendo actualmente?</td></tr>
                      <tr><td><b>2. Problema</b></td><td>¿Qué no está funcionando?</td></tr>
                      <tr><td><b>3. Impacto</b></td><td>¿Cómo afecta esto su vida, negocio o futuro?</td></tr>
                      <tr><td><b>4. Significado</b></td><td>¿Qué representa esta situación para esa persona?</td></tr>
                      <tr><td><b>5. Motivación</b></td><td>¿Por qué realmente quiere cambiar?</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="section-subtitle" style={{ marginTop: 8 }}>
                  <b>Regla del Descubrimiento:</b> no presentes hasta comprender. Si se pasó al Pitch sin llegar al menos a Impacto, esa es la observación central de toda la llamada.
                </p>
              </div>

              <div>
                <b style={{ color: 'var(--text-main)', fontSize: 13.5 }}>Reglas de oro</b>
                <ol style={{ fontSize: 12.5, color: 'var(--text-muted)', paddingLeft: 18, marginTop: 8 }}>
                  <li>Dato concreto + minuto exacto vale más que una opinión general.</li>
                  <li>Separá el hecho (qué dijo o hizo) de la interpretación (qué creés que significa).</li>
                  <li>Primero lo que funcionó, con la misma exigencia de prueba que lo mejorable.</li>
                  <li>Toda objeción: pensá 2-3 explicaciones posibles antes de quedarte con la primera.</li>
                  <li>Cada observación termina con: «¿qué regla general puedo sacar de esto?»</li>
                  <li>El análisis termina con 1–2 acciones concretas para tu próxima llamada.</li>
                </ol>
              </div>
            </div>
          )}

          {subTab === 'mis' && (
            <div className="section-card glass">
              <h3 className="section-title">Mis análisis</h3>
              <p className="section-subtitle">Cada llamada que analizás queda guardada en tu cuenta — se ve desde cualquier dispositivo en el que inicies sesión.</p>
              <button type="button" className="btn btn-indigo" style={{ alignSelf: 'flex-start' }} onClick={createAnalysis}>+ Nuevo análisis</button>
              {analyses.map(a => (
                <div key={a.id} className={`ca-analysis-row ${a.id === activeId ? 'active' : ''}`}>
                  <div className="ca-info">
                    <b>{a.titulo || 'Sin título'}</b>
                    <span>{tituloAnalisis(a)} · {(a.meta && a.meta.fecha) || (a.created_at || '').slice(0, 10)}{a.id === activeId ? ' · en uso' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {a.id !== activeId && <button type="button" className="btn btn-outline btn-small" onClick={() => setActiveId(a.id)}>Abrir</button>}
                    <button type="button" className="btn btn-outline btn-small" onClick={() => duplicateAnalysis(a.id)}>Duplicar</button>
                    <button type="button" className="btn-danger-icon" onClick={() => deleteAnalysisRow(a.id)} title="Borrar">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {subTab === 'grupo' && (
            <div className="section-card glass">
              <h3 className="section-title">Juntar las notas del grupo</h3>
              <p className="section-subtitle">
                Cualquiera de la sala que titule su análisis igual que este (<b>{active.titulo || 'Sin título'}</b>) aparece acá automáticamente — nada para exportar ni importar.
              </p>
              {groupLoading ? (
                <div className="empty-state">Buscando…</div>
              ) : groupPeers.length <= 1 ? (
                <div className="empty-state">
                  <div className="empty-state-title">Todavía nadie más analizó esta llamada</div>
                  <div className="empty-state-desc">En cuanto otro miembro de la sala titule su análisis igual que el tuyo, sus notas van a aparecer acá comparadas por fase.</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {groupPeers.length} análisis: {groupPeers.map(p => p.member_name || p.member_email).join(' · ')}
                  </div>
                  {FASES.map(f => {
                    const rows = [];
                    groupPeers.forEach(p => p.notes.filter(n => n.fase === f.id).forEach(n => rows.push({ who: p.member_name || p.member_email, n })));
                    rows.sort((a, b) => a.n.t - b.n.t);
                    const prin = groupPeers.map(p => ({ who: p.member_name || p.member_email, p: (p.principios || {})[f.id] || '' })).filter(x => x.p.trim());
                    if (!rows.length && !prin.length) return null;
                    return (
                      <div key={f.id} className="ca-fase-card">
                        <div className="ca-fase-head"><b>{f.n}</b><span style={{ marginLeft: 'auto' }}>{rows.length} observaciones</span></div>
                        <div className="ca-fase-body">
                          {rows.length === 0 ? <div className="ca-fase-hint">Nadie anotó nada en esta fase.</div> : rows.map((r, idx) => {
                            const tipo = tipoOf(r.n.tipo);
                            return (
                              <div key={idx} style={{ display: 'flex', gap: 8, fontSize: 13, borderLeft: `3px solid ${tipo.c}`, paddingLeft: 8 }}>
                                <b style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtT(r.n.t)}</b>
                                <span>{r.n.text}<span className="ca-who-tag">{r.who}</span></span>
                              </div>
                            );
                          })}
                          {prin.length > 0 && (
                            <>
                              <label style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Principios que sacó cada uno</label>
                              {prin.map((x, idx) => <div key={idx} style={{ fontSize: 13 }}>{x.p}<span className="ca-who-tag">{x.who}</span></div>)}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
