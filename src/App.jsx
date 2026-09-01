import { useState, useEffect, useCallback, useRef } from 'react';
import {
  savePlants, getPlants, updatePlant,
  getMeta, setMeta,
  addPendingChange, getPendingChanges, clearPendingChanges,
} from './db.js';
import {
  initAuth, requestToken, clearToken, hasToken,
  readPlantData, writePlantData, getFileModifiedTime,
} from './drive.js';

const C = {
  bg: '#EDF1EA',
  text: '#2D3A2E',
  muted: '#7A8A7C',
  water: '#5B8FA3',
  feed: '#6B8F4E',
  overdue: '#C4673C',
  line: '#D5DDD1',
  card: '#FFFFFF',
  cardShadow: '0 1px 3px rgba(45,58,46,0.08)',
};

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d)) return Infinity;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

function waterStatus(plant) {
  const days = daysSince(plant.lastWatered);
  const interval = plant.adjustedInterval || plant.baseInterval || 7;
  if (days === Infinity) return { days: null, status: 'unknown', daysLeft: null };
  const daysLeft = interval - days;
  if (daysLeft < -1) return { days, status: 'overdue', daysLeft };
  if (daysLeft <= 1) return { days, status: 'due', daysLeft };
  return { days, status: 'ok', daysLeft };
}

function isWinterPause() {
  const m = new Date().getMonth();
  return m >= 10 || m <= 1; // Nov–Feb
}

function fertStatus(plant) {
  if (!plant.fertInterval) return { days: null, status: 'none', daysLeft: null };
  if (plant.fertWinterPause && isWinterPause()) return { days: daysSince(plant.lastFert), status: 'paused', daysLeft: null };
  const days = daysSince(plant.lastFert);
  const daysLeft = plant.fertInterval - days;
  if (days === Infinity) return { days: null, status: 'unknown', daysLeft: null };
  if (daysLeft < -1) return { days, status: 'overdue', daysLeft };
  if (daysLeft <= 1) return { days, status: 'due', daysLeft };
  return { days, status: 'ok', daysLeft };
}

function urgencyScore(plant) {
  const ws = waterStatus(plant);
  const fs = fertStatus(plant);
  let score = 0;
  if (ws.status === 'overdue') score += 100 + Math.abs(ws.daysLeft || 0);
  else if (ws.status === 'due') score += 50;
  else if (ws.status === 'ok') score += -ws.daysLeft;
  if (fs.status === 'overdue') score += 30;
  else if (fs.status === 'due') score += 15;
  return score;
}

function normalizePlant(p) {
  if (p._normalized) return p;
  return {
    ...p,
    id: p.id || p.name,
    lastWatered: p.lastWatered || p.watering?.lastWatered || null,
    history: p.history || [],
    baseInterval: p.baseInterval || p.watering?.baseIntervalDays || p.watering?.intervalDays || 7,
    adjustedInterval: p.adjustedInterval || p.watering?.effectiveIntervalDays || null,
    lastFert: p.lastFert || p.feeding?.lastFed || null,
    fertHistory: p.fertHistory || [],
    fertInterval: p.fertInterval ?? p.feeding?.intervalDays ?? 0,
    fertWinterPause: p.fertWinterPause ?? p.feeding?.winterPause ?? true,
    fertNote: p.fertNote || p.feeding?.fertNote || '',
    notes: p.notes || p.care?.notes || '',
    conditions: p.conditions?.light
      ? p.conditions
      : {
          light: p.care?.light || '',
          humidity: p.care?.humidity || '',
          temperature: p.conditions?.temperature || '',
          medium: p.conditions?.medium || '',
        },
    _normalized: true,
  };
}

function StatusDot({ status }) {
  const color = status === 'overdue' ? C.overdue : status === 'due' ? '#D4A843' : C.feed;
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      backgroundColor: color, marginRight: 6, flexShrink: 0,
    }} />
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });
}

function PlantCard({ plant, onTap }) {
  const ws = waterStatus(plant);
  const fs = fertStatus(plant);

  return (
    <button
      onClick={() => onTap(plant)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '14px 16px',
        background: C.card, border: 'none', borderRadius: 12,
        boxShadow: C.cardShadow, cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit', color: C.text,
        WebkitAppearance: 'none',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {plant.name}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          {plant.species !== plant.name ? plant.species : ''}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
        <div style={{ textAlign: 'center', minWidth: 44 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StatusDot status={ws.status} />
            <span style={{ fontSize: 13, fontWeight: 600, color: ws.status === 'overdue' ? C.overdue : C.text }}>
              {ws.days != null ? `${ws.days}d` : '?'}
            </span>
          </div>
          <div style={{ fontSize: 10, color: C.muted }}>water</div>
        </div>

        {fs.status !== 'none' && (
          <div style={{ textAlign: 'center', minWidth: 44 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StatusDot status={fs.status === 'paused' ? 'ok' : fs.status} />
              <span style={{ fontSize: 13, fontWeight: 600, color: fs.status === 'overdue' ? C.overdue : C.text }}>
                {fs.status === 'paused' ? '❄' : fs.days != null ? `${fs.days}d` : '?'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>feed</div>
          </div>
        )}

        <svg width="16" height="16" viewBox="0 0 16 16" style={{ opacity: 0.3 }}>
          <path d="M6 3l5 5-5 5" stroke={C.text} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </button>
  );
}

function PlantDetail({ plant, onBack, onWater, onFeed, onUndoWater, onUndoFeed }) {
  const ws = waterStatus(plant);
  const fs = fertStatus(plant);
  const interval = plant.adjustedInterval || plant.baseInterval || 7;

  const waterHistory = (plant.history || []).slice(-10).reverse();
  const feedHistory = (plant.fertHistory || []).slice(-10).reverse();

  return (
    <div style={{ padding: '0 16px 100px', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', color: C.water, fontSize: 15,
        padding: '16px 0', cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M10 3l-5 5 5 5" stroke={C.water} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
        Back
      </button>

      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>
        {plant.name}
      </h1>
      {plant.species !== plant.name && (
        <p style={{ color: C.muted, fontSize: 14, margin: '0 0 4px' }}>{plant.species}</p>
      )}
      <p style={{ color: C.muted, fontSize: 13, margin: '0 0 20px' }}>{plant.location}</p>

      {/* Status cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{
          flex: 1, background: C.card, borderRadius: 12, padding: 16,
          boxShadow: C.cardShadow, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Water</div>
          <div style={{
            fontSize: 28, fontWeight: 700, fontFamily: "'Fraunces', serif",
            color: ws.status === 'overdue' ? C.overdue : ws.status === 'due' ? '#D4A843' : C.water,
          }}>
            {ws.days != null ? ws.days : '?'}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>days ago</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>every {interval}d</div>
        </div>

        {fs.status !== 'none' && (
          <div style={{
            flex: 1, background: C.card, borderRadius: 12, padding: 16,
            boxShadow: C.cardShadow, textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feed</div>
            <div style={{
              fontSize: 28, fontWeight: 700, fontFamily: "'Fraunces', serif",
              color: fs.status === 'paused' ? C.muted : fs.status === 'overdue' ? C.overdue : fs.status === 'due' ? '#D4A843' : C.feed,
            }}>
              {fs.status === 'paused' ? '❄' : fs.days != null ? fs.days : '?'}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>{fs.status === 'paused' ? 'winter pause' : 'days ago'}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>every {plant.fertInterval}d</div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button onClick={onWater} style={{
          flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
          background: C.water, color: '#fff', fontSize: 15, fontWeight: 600,
          fontFamily: 'inherit', cursor: 'pointer',
        }}>
          💧 Water now
        </button>
        {fs.status !== 'none' && (
          <button onClick={onFeed} style={{
            flex: 1, padding: '14px 0', borderRadius: 12, border: 'none',
            background: C.feed, color: '#fff', fontSize: 15, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>
            🌱 Fertilize
          </button>
        )}
      </div>

      {/* Undo buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {(plant.history || []).length > 0 && (
          <button onClick={onUndoWater} style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: `1px solid ${C.line}`,
            background: 'transparent', color: C.muted, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>
            Undo last watering
          </button>
        )}
        {(plant.fertHistory || []).length > 0 && (
          <button onClick={onUndoFeed} style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: `1px solid ${C.line}`,
            background: 'transparent', color: C.muted, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>
            Undo last feed
          </button>
        )}
      </div>

      {/* Care info */}
      {(plant.notes || plant.fertNote || plant.conditions) && (
        <div style={{ background: C.card, borderRadius: 12, padding: 16, boxShadow: C.cardShadow, marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Care info</h3>
          {plant.conditions && (
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8, lineHeight: 1.6 }}>
              {plant.conditions.light && <div>☀️ {plant.conditions.light}</div>}
              {plant.conditions.humidity && <div>💨 {plant.conditions.humidity}</div>}
              {plant.conditions.temperature && <div>🌡 {plant.conditions.temperature}</div>}
              {plant.conditions.medium && <div>🪴 {plant.conditions.medium}</div>}
            </div>
          )}
          {plant.notes && <p style={{ fontSize: 13, color: C.text, margin: '8px 0', lineHeight: 1.5 }}>{plant.notes}</p>}
          {plant.fertNote && <p style={{ fontSize: 13, color: C.feed, margin: '8px 0', lineHeight: 1.5 }}>🌱 {plant.fertNote}</p>}
        </div>
      )}

      {/* History */}
      {(waterHistory.length > 0 || feedHistory.length > 0) && (
        <div style={{ background: C.card, borderRadius: 12, padding: 16, boxShadow: C.cardShadow }}>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>History</h3>
          <div style={{ display: 'flex', gap: 24 }}>
            {waterHistory.length > 0 && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase' }}>Watered</div>
                {waterHistory.map((d, i) => (
                  <div key={i} style={{ fontSize: 13, color: C.text, padding: '3px 0', borderBottom: i < waterHistory.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                    {formatDate(d)}
                  </div>
                ))}
              </div>
            )}
            {feedHistory.length > 0 && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase' }}>Fed</div>
                {feedHistory.map((d, i) => (
                  <div key={i} style={{ fontSize: 13, color: C.text, padding: '3px 0', borderBottom: i < feedHistory.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                    {formatDate(d)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      width: '100%', padding: '14px 16px', background: C.card, borderRadius: 12,
      boxShadow: C.cardShadow, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ width: '60%', height: 14, background: C.line, borderRadius: 4, marginBottom: 6 }} />
        <div style={{ width: '40%', height: 10, background: C.line, borderRadius: 4 }} />
      </div>
      <div style={{ width: 44, height: 28, background: C.line, borderRadius: 4 }} />
    </div>
  );
}

export default function App() {
  const [plants, setPlants] = useState([]);
  const [fullData, setFullData] = useState(null);
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState(null);
  const touchStartY = useRef(0);
  const pullRef = useRef(null);
  const lastModifiedRef = useRef(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    (async () => {
      const ready = await initAuth();
      setAuthReady(ready);
      const cached = await getPlants();
      if (cached.length > 0) {
        setPlants(cached.map(normalizePlant));
      }
      setLoading(false);
      const syncTime = await getMeta('lastSync');
      if (syncTime) setLastSync(new Date(syncTime));
    })();
  }, []);

  const syncFromDrive = useCallback(async () => {
    if (!online) return;
    setSyncing(true);
    setError(null);
    try {
      const data = await readPlantData();
      setFullData(data);
      const plantList = (data.plants || []).map(normalizePlant);
      setPlants(plantList);
      await savePlants(plantList);
      const now = new Date();
      setLastSync(now);
      await setMeta('lastSync', now.toISOString());
      setAuthed(true);
      try { lastModifiedRef.current = await getFileModifiedTime(); } catch {}
    } catch (e) {
      console.error('Sync failed:', e);
      setError(e.message);
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [online]);

  const fullDataRef = useRef(null);
  useEffect(() => { fullDataRef.current = fullData; }, [fullData]);

  const flushPendingChanges = useCallback(async () => {
    const pending = await getPendingChanges();
    if (pending.length === 0) return;
    const latest = pending[pending.length - 1];
    try {
      const base = fullDataRef.current || {};
      const data = { ...base, plants: latest.plants, exportedAt: new Date().toISOString() };
      await writePlantData(data);
      setFullData(data);
      await clearPendingChanges();
      setError(null);
      const now = new Date();
      setLastSync(now);
      await setMeta('lastSync', now.toISOString());
      console.log(`[Drive sync] Flushed ${pending.length} pending change(s)`);
    } catch (e) {
      console.error('Flush failed:', e);
      setError(`Sync retry failed: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    if (online && authed) flushPendingChanges();
  }, [online, authed, flushPendingChanges]);

  const handleSignIn = async () => {
    try {
      await requestToken();
      await syncFromDrive();
    } catch (e) {
      setError(e.message);
    }
  };

  const preparePlantsForDrive = (plantList) =>
    plantList.map(p => {
      const out = { ...p };
      if (out.watering) {
        out.watering = { ...out.watering, lastWatered: out.lastWatered || out.watering.lastWatered };
      }
      if (out.feeding) {
        out.feeding = { ...out.feeding, lastFed: out.lastFert || out.feeding.lastFed };
      }
      delete out._normalized;
      return out;
    });

  const writeToDrive = async (updatedPlants) => {
    console.log('[Drive] writeToDrive called, online:', navigator.onLine, 'plants:', updatedPlants.length);
    if (!navigator.onLine) {
      console.log('[Drive] Offline — queuing change');
      await addPendingChange({ timestamp: Date.now(), plants: updatedPlants });
      setError('Offline — change saved locally, will sync when back online');
      return;
    }
    try {
      const base = fullDataRef.current || {};
      const exportPlants = preparePlantsForDrive(updatedPlants);
      const data = { ...base, plants: exportPlants, exportedAt: new Date().toISOString() };
      console.log('[Drive] Writing to Drive...', Object.keys(data));
      await writePlantData(data);
      console.log('[Drive] Write succeeded');
      setFullData(data);
      try { lastModifiedRef.current = await getFileModifiedTime(); } catch {}

      setError(null);
      const now = new Date();
      setLastSync(now);
      await setMeta('lastSync', now.toISOString());
    } catch (e) {
      console.error('[Drive] Write failed:', e);
      await addPendingChange({ timestamp: Date.now(), plants: updatedPlants });
      setError(`Sync failed: ${e.message}. Change saved locally.`);
    }
  };

  const doWater = async (plant) => {
    console.log('[Action] Water now:', plant.name);
    const now = new Date().toISOString();
    const updated = {
      ...plant,
      lastWatered: now,
      history: [...(plant.history || []), now],
    };
    const newPlants = plants.map(p => p.id === plant.id ? updated : p);
    setPlants(newPlants);
    setSelectedPlant(updated);
    await updatePlant(updated);
    console.log('[Action] Local state updated, pushing to Drive...');
    await writeToDrive(newPlants);
    console.log('[Action] Water done');
  };

  const doFeed = async (plant) => {
    console.log('[Action] Fertilize now:', plant.name);
    const now = new Date().toISOString();
    const updated = {
      ...plant,
      lastFert: now,
      fertHistory: [...(plant.fertHistory || []), now],
    };
    const newPlants = plants.map(p => p.id === plant.id ? updated : p);
    setPlants(newPlants);
    setSelectedPlant(updated);
    await updatePlant(updated);
    console.log('[Action] Local state updated, pushing to Drive...');
    await writeToDrive(newPlants);
    console.log('[Action] Feed done');
  };

  const undoWater = async (plant) => {
    console.log('[Action] Undo water:', plant.name);
    const history = [...(plant.history || [])];
    history.pop();
    const updated = {
      ...plant,
      lastWatered: history.length > 0 ? history[history.length - 1] : null,
      history,
    };
    const newPlants = plants.map(p => p.id === plant.id ? updated : p);
    setPlants(newPlants);
    setSelectedPlant(updated);
    await updatePlant(updated);
    await writeToDrive(newPlants);
  };

  const undoFeed = async (plant) => {
    console.log('[Action] Undo feed:', plant.name);
    const fertHistory = [...(plant.fertHistory || [])];
    fertHistory.pop();
    const updated = {
      ...plant,
      lastFert: fertHistory.length > 0 ? fertHistory[fertHistory.length - 1] : null,
      fertHistory,
    };
    const newPlants = plants.map(p => p.id === plant.id ? updated : p);
    setPlants(newPlants);
    setSelectedPlant(updated);
    await updatePlant(updated);
    await writeToDrive(newPlants);
  };

  // Poll Drive for external changes every 30s
  useEffect(() => {
    if (!authed || !online) return;
    const poll = async () => {
      try {
        const modTime = await getFileModifiedTime();
        if (lastModifiedRef.current && modTime !== lastModifiedRef.current) {
          console.log('[Poll] Drive file changed externally, re-syncing...');
          await syncFromDrive();
        }
        lastModifiedRef.current = modTime;
      } catch (e) {
        console.warn('[Poll] modifiedTime check failed:', e.message);
      }
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [authed, online, syncFromDrive]);

  // Re-sync when tab becomes visible again
  useEffect(() => {
    if (!authed) return;
    const onVisible = async () => {
      if (document.visibilityState === 'visible' && navigator.onLine && hasToken()) {
        try {
          const modTime = await getFileModifiedTime();
          if (lastModifiedRef.current && modTime !== lastModifiedRef.current) {
            console.log('[Visibility] Drive file changed while away, re-syncing...');
            await syncFromDrive();
          }
          lastModifiedRef.current = modTime;
        } catch (e) {
          console.warn('[Visibility] check failed:', e.message);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [authed, syncFromDrive]);

  // Pull-to-refresh
  const handleTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const handleTouchEnd = async (e) => {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (dy > 80 && window.scrollY === 0 && !syncing) {
      await syncFromDrive();
    }
  };

  // Group plants by location
  const grouped = {};
  const sorted = [...plants].sort((a, b) => urgencyScore(b) - urgencyScore(a));
  for (const p of sorted) {
    const loc = p.location || 'Unknown';
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(p);
  }

  const roomOrder = Object.keys(grouped).sort((a, b) => {
    const maxA = Math.max(...grouped[a].map(urgencyScore));
    const maxB = Math.max(...grouped[b].map(urgencyScore));
    return maxB - maxA;
  });

  if (selectedPlant) {
    const current = plants.find(p => p.id === selectedPlant.id) || selectedPlant;
    return (
      <PlantDetail
        plant={current}
        onBack={() => setSelectedPlant(null)}
        onWater={() => doWater(current)}
        onFeed={() => doFeed(current)}
        onUndoWater={() => undoWater(current)}
        onUndoFeed={() => undoFeed(current)}
      />
    );
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      ref={pullRef}
      style={{ minHeight: '100vh', paddingBottom: 60 }}
    >
      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        position: 'sticky', top: 0, zIndex: 10,
        background: C.bg,
      }}>
        <h1 style={{
          fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 700,
          margin: 0, color: C.text,
        }}>
          Kastelu
        </h1>
        <p style={{ fontSize: 12, color: C.muted, margin: '2px 0 0' }}>
          {plants.length} plant{plants.length !== 1 ? 's' : ''}
          {syncing && ' · syncing…'}
        </p>
      </div>

      {/* Auth prompt */}
      {!authed && !loading && authReady && (
        <div style={{ padding: '0 16px', marginBottom: 16 }}>
          <button onClick={handleSignIn} style={{
            width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
            background: C.water, color: '#fff', fontSize: 15, fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>
            Sign in with Google
          </button>
          {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <p style={{ fontSize: 12, color: C.overdue, marginTop: 8, textAlign: 'center' }}>
              VITE_GOOGLE_CLIENT_ID not set — add it to .env
            </p>
          )}
        </div>
      )}

      {!authReady && !loading && plants.length === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: C.muted }}>
            Set VITE_GOOGLE_CLIENT_ID in .env to connect to Google Drive
          </p>
        </div>
      )}

      {error && (
        <div style={{ padding: '0 16px', marginBottom: 12 }}>
          <button
            onClick={() => setError(null)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '10px 14px', borderRadius: 10, border: 'none',
              background: '#FEF2F0', color: C.overdue, fontSize: 13,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {error}
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && plants.length === 0 && (
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Plant list grouped by room */}
      <div style={{ padding: '0 16px' }}>
        {roomOrder.map(room => (
          <div key={room} style={{ marginBottom: 20 }}>
            <h2 style={{
              fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600,
              color: C.muted, margin: '0 0 8px', textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {room}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grouped[room].map(plant => (
                <PlantCard key={plant.id} plant={plant} onTap={setSelectedPlant} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom status bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '8px 16px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
        background: 'rgba(237,241,234,0.92)', backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderTop: `1px solid ${C.line}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: C.muted,
        zIndex: 20,
      }}>
        <span>
          {lastSync ? `Synced ${lastSync.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}` : 'Not synced'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: online ? C.feed : C.overdue,
          }} />
          {online ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  );
}
