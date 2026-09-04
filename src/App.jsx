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
import {
  C, FONT_DISPLAY,
  waterStatus, fertStatus, compareByUrgency, locationGroup,
  daysSince, relDay, fmtDate,
  conditionsSummary, fertRotationPreview, buildUnifiedHistory, formatHistoryEntry,
  WaterGauge, Chip, StatusBadge, GroupPills,
} from './kastelu-ui.jsx';

const CARD_SHADOW = '0 1px 3px rgba(34,48,31,0.08)';

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
    botanical: p.botanical || '',
    notes: p.notes || p.care?.notes || '',
    // Keep the Mac app's two shapes apart: `conditions` is the pot (size,
    // material, medium, placement); light and humidity are care text. Folding
    // them together lost the pot details entirely.
    conditions: p.conditions || null,
    light: p.light || p.care?.light || '',
    humidity: p.humidity || p.care?.humidity || '',
    wateringMethod: p.wateringMethod || p.watering?.wateringMethod || '',
    groups: p.groups || [],
    lifecycle: p.lifecycle || 'active',
    _normalized: true,
  };
}

function PlantCard({ plant, onTap }) {
  const ws = waterStatus(plant);
  const fs = fertStatus(plant);
  const lc = plant.lifecycle || 'active';

  return (
    <button
      onClick={() => onTap(plant)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '14px 16px',
        background: C.card,
        border: `1px solid ${ws.tone === 'overdue' ? C.rust + '55' : C.line}`,
        borderRadius: 14,
        boxShadow: CARD_SHADOW, cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit', color: C.ink,
        WebkitAppearance: 'none',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, color: C.ink }}>
          {plant.name}
          {plant.botanical && plant.botanical !== plant.name && (
            <span style={{ fontSize: 12, color: C.muted, marginLeft: 6, fontStyle: 'italic' }}>
              {plant.botanical}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <StatusBadge status={ws} />
          {fs && (
            <Chip bg={fs.due ? C.feedPale : C.card} fg={fs.due ? C.feed : C.muted}>
              {fs.due ? '🌱 ' : ''}{fs.label}
            </Chip>
          )}
          {lc !== 'active' && (
            <Chip bg={lc === 'rest' ? C.feedPale : C.track} fg={lc === 'rest' ? C.feed : C.muted}>
              {lc === 'rest' ? 'Resting' : 'Dormant'}
            </Chip>
          )}
        </div>

        <div style={{ margin: '10px 0 8px' }}>
          <WaterGauge fill={ws.fill} tone={ws.tone} />
        </div>

        <div style={{ fontSize: 12.5, color: C.muted }}>
          {plant.lastWatered
            ? `Last watered ${relDay(plant.lastWatered)} · every ${ws.interval} d`
            : `Every ${ws.interval} d · no waterings logged yet`}
        </div>
        <GroupPills groups={plant.groups} />
      </div>

      <svg width="16" height="16" viewBox="0 0 16 16" style={{ opacity: 0.3, flexShrink: 0 }}>
        <path d="M6 3l5 5-5 5" stroke={C.ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function PlantDetail({ plant, onBack, onWater, onFeed, onUndoWater, onUndoFeed }) {
  const ws = waterStatus(plant);
  const fs = fertStatus(plant);
  const lc = plant.lifecycle || 'active';
  const wateredToday = daysSince(plant.lastWatered) === 0;
  const fedToday = daysSince(plant.lastFert) === 0;
  const rotPreview = fertRotationPreview(plant);
  const historyEntries = buildUnifiedHistory(plant);
  const potSummary = conditionsSummary(plant.conditions);

  const panel = {
    background: C.card, border: `1px solid ${C.line}`, borderRadius: 14,
    padding: 16, marginBottom: 14,
  };
  const smallBtn = {
    flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${C.line}`,
    background: 'transparent', color: C.muted, fontSize: 13,
    fontFamily: 'inherit', cursor: 'pointer',
  };
  const infoRow = (label, value) =>
    value ? (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.45 }}>{value}</div>
      </div>
    ) : null;

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

      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, margin: '0 0 4px', color: C.ink }}>
        {plant.name}
      </h1>
      {plant.botanical && plant.botanical !== plant.name && (
        <p style={{ color: C.muted, fontSize: 14, margin: '0 0 4px', fontStyle: 'italic' }}>{plant.botanical}</p>
      )}
      <p style={{ color: C.muted, fontSize: 13, margin: '0 0 12px' }}>{plant.location}</p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <StatusBadge status={ws} />
        {fs && (
          <Chip bg={fs.due ? C.feedPale : C.card} fg={fs.due ? C.feed : C.muted}>
            {fs.due ? '🌱 ' : ''}{fs.label}
          </Chip>
        )}
        {lc !== 'active' && (
          <Chip bg={lc === 'rest' ? C.feedPale : C.track} fg={lc === 'rest' ? C.feed : C.muted}>
            {lc === 'rest' ? 'Resting' : 'Dormant'}
          </Chip>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <WaterGauge fill={ws.fill} tone={ws.tone} />
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>
        {plant.lastWatered
          ? `Last watered ${relDay(plant.lastWatered)} · every ${ws.interval} d`
          : `Every ${ws.interval} d · no waterings logged yet`}
        {plant.wateringMethod ? <span style={{ color: C.water }}>{` · Method: ${plant.wateringMethod}`}</span> : ''}
      </div>
      <GroupPills groups={plant.groups} />

      {/* Water */}
      <button
        onClick={onWater}
        disabled={wateredToday}
        style={{
          width: '100%', padding: '15px 0', borderRadius: 12, border: 'none', marginTop: 16,
          background: wateredToday ? C.track : C.water,
          color: wateredToday ? C.muted : '#fff',
          fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
          cursor: wateredToday ? 'default' : 'pointer',
        }}
      >
        {wateredToday ? 'Watered today ✓' : '💧 Water now'}
      </button>

      {/* Feeding block, mirroring the Mac app's panel */}
      {fs && (
        <div style={{ background: C.feedPale, borderRadius: 12, padding: '12px 14px', marginTop: 14 }}>
          <div style={{ fontSize: 13, color: C.feed }}>
            <strong>🌱 {fs.label}</strong>
            {plant.lastFert ? ` · last fed ${relDay(plant.lastFert)}` : ''}
            {` · every ${plant.fertInterval} d`}
            {plant.fertWinterPause ? ' · paused Nov–Feb' : ''}
          </div>
          {plant.fertNote && <div style={{ fontSize: 12.5, color: C.feed, marginTop: 6 }}>{plant.fertNote}</div>}
          {rotPreview && (
            <div style={{ fontSize: 12.5, color: C.feed, marginTop: 6 }}>
              Next: {rotPreview.next} · then: {rotPreview.then}
            </div>
          )}
          <button
            onClick={onFeed}
            disabled={fedToday || fs.tone === 'paused'}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', marginTop: 10,
              background: fedToday || fs.tone === 'paused' ? C.track : C.feed,
              color: fedToday || fs.tone === 'paused' ? C.muted : '#fff',
              fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
              cursor: fedToday || fs.tone === 'paused' ? 'default' : 'pointer',
            }}
          >
            {fedToday ? 'Fed today ✓' : fs.tone === 'paused' ? 'Feeding paused' : '🌱 Fertilize now'}
          </button>
        </div>
      )}

      {/* Undo */}
      <div style={{ display: 'flex', gap: 12, margin: '14px 0 24px' }}>
        {(plant.history || []).length > 0 && (
          <button onClick={onUndoWater} style={smallBtn}>Undo last watering</button>
        )}
        {(plant.fertHistory || []).length > 0 && (
          <button onClick={onUndoFeed} style={smallBtn}>Undo last feed</button>
        )}
      </div>

      {/* Care info */}
      {(potSummary || plant.light || plant.humidity || plant.notes || plant.lastRepotted) && (
        <div style={panel}>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: C.ink }}>
            Care info
          </h3>
          {infoRow('Pot & conditions', potSummary)}
          {plant.lastRepotted && infoRow(
            'Repotting',
            `Last repotted ${fmtDate(plant.lastRepotted)} (${relDay(plant.lastRepotted)})${plant.repotNote ? ` — ${plant.repotNote}` : ''}`
          )}
          {infoRow('Light', plant.light)}
          {infoRow('Humidity', plant.humidity)}
          {infoRow('Care notes', plant.notes)}
        </div>
      )}

      {/* One timeline, newest first — same as the Mac app */}
      <div style={panel}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, margin: '0 0 10px', color: C.ink }}>
          History
        </h3>
        {historyEntries.length > 0 ? (
          <div style={{ fontSize: 13, color: C.ink }}>
            {historyEntries.map((e, i) => (
              <div key={e.iso + e.type + i} style={{ padding: '4px 0', borderBottom: `1px dashed ${C.line}` }}>
                {formatHistoryEntry(e)}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.muted }}>
            Nothing logged yet — tap “Water now” or “Fertilize now” as you go.
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      width: '100%', padding: '14px 16px', background: C.card, borderRadius: 12,
      boxShadow: CARD_SHADOW, display: 'flex', alignItems: 'center', gap: 12,
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
      if (ready && hasToken()) {
        syncFromDrive();
      }
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
      await clearPendingChanges();
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
      const remote = await readPlantData();
      const localMap = Object.fromEntries(
        latest.plants.map(p => [p.id || p.name, p])
      );
      const mergedPlants = (remote.plants || []).map(rp => {
        const id = rp.id || rp.name;
        const local = localMap[id];
        if (!local) return rp;
        const localWatered = local.lastWatered || local.watering?.lastWatered;
        const remoteWatered = rp.lastWatered || rp.watering?.lastWatered;
        const localFed = local.lastFert || local.feeding?.lastFed;
        const remoteFed = rp.lastFert || rp.feeding?.lastFed;
        if ((localWatered && (!remoteWatered || localWatered > remoteWatered)) ||
            (localFed && (!remoteFed || localFed > remoteFed))) {
          const out = { ...local };
          delete out._normalized;
          if (out.watering) out.watering = { ...out.watering, lastWatered: out.lastWatered || out.watering.lastWatered };
          if (out.feeding) out.feeding = { ...out.feeding, lastFed: out.lastFert || out.feeding.lastFed };
          return out;
        }
        return rp;
      });
      const data = { ...remote, plants: mergedPlants, exportedAt: new Date().toISOString() };
      await writePlantData(data);
      setFullData(data);
      const allPlants = mergedPlants.map(normalizePlant);
      setPlants(allPlants);
      await savePlants(allPlants);
      await clearPendingChanges();
      try { lastModifiedRef.current = await getFileModifiedTime(); } catch {}
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

  const writeToDrive = async (updatedPlants, changedIds) => {
    console.log('[Drive] writeToDrive called, online:', navigator.onLine, 'changed:', changedIds);
    if (!navigator.onLine) {
      console.log('[Drive] Offline — queuing change');
      await addPendingChange({ timestamp: Date.now(), plants: updatedPlants });
      setError('Offline — change saved locally, will sync when back online');
      return;
    }
    try {
      const remote = await readPlantData();
      const changedMap = Object.fromEntries(
        updatedPlants.filter(p => changedIds.includes(p.id)).map(p => [p.id, p])
      );
      const mergedPlants = (remote.plants || []).map(rp => {
        const id = rp.id || rp.name;
        const local = changedMap[id];
        if (!local) return rp;
        const out = { ...rp };
        const remoteWatered = rp.lastWatered || rp.watering?.lastWatered || null;
        const remoteFed = rp.lastFert || rp.feeding?.lastFed || null;
        if (local.lastWatered && (!remoteWatered || local.lastWatered > remoteWatered)) {
          out.lastWatered = local.lastWatered;
          out.history = local.history;
          if (out.watering) out.watering = { ...out.watering, lastWatered: local.lastWatered };
        }
        if (local.lastFert && (!remoteFed || local.lastFert > remoteFed)) {
          out.lastFert = local.lastFert;
          out.fertHistory = local.fertHistory;
          if (out.feeding) out.feeding = { ...out.feeding, lastFed: local.lastFert };
        }
        return out;
      });
      const data = { ...remote, plants: mergedPlants, exportedAt: new Date().toISOString() };
      console.log('[Drive] Writing merged data to Drive...');
      await writePlantData(data);
      console.log('[Drive] Write succeeded');
      setFullData(data);
      const allPlants = mergedPlants.map(normalizePlant);
      setPlants(allPlants);
      await savePlants(allPlants);
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
    await writeToDrive(newPlants, [plant.id]);
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
    await writeToDrive(newPlants, [plant.id]);
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
    await writeToDrive(newPlants, [plant.id]);
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
    await writeToDrive(newPlants, [plant.id]);
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

  // Flat urgency order with a location header inserted whenever the room
  // changes — the same walk the Mac app does, so the most urgent plant is
  // always first rather than buried inside a room bucket.
  const sorted = [...plants].sort(compareByUrgency);

  const needsWater = plants.filter((p) => ['overdue', 'due'].includes(waterStatus(p).tone)).length;
  const needsFeed = plants.filter((p) => fertStatus(p)?.due).length;

  const summary = () => {
    if (loading && plants.length === 0) return 'Loading your plants…';
    if (plants.length === 0) return 'Your houseplant watering & feeding log';
    const bits = [];
    if (needsWater > 0) bits.push(`${needsWater} need${needsWater === 1 ? 's' : ''} water`);
    if (needsFeed > 0) bits.push(`${needsFeed} need${needsFeed === 1 ? 's' : ''} feeding`);
    return bits.length
      ? `${bits.join(' · ')} (of ${plants.length} plants).`
      : `All ${plants.length} plants are looked after. 🌿`;
  };

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
          fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600,
          margin: 0, color: C.pine, lineHeight: 1.1,
        }}>
          Kastelu
        </h1>
        <p style={{ fontSize: 13, color: C.muted, margin: '4px 0 0' }}>
          {summary()}
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
            <p style={{ fontSize: 12, color: C.rust, marginTop: 8, textAlign: 'center' }}>
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
              background: C.rustPale, color: C.rust, fontSize: 13,
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

      {/* Urgency order, with a header each time the room changes */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(() => {
          let lastRoom = null;
          return sorted.map((plant) => {
            const room = locationGroup(plant.location);
            const showHeader = room !== lastRoom;
            lastRoom = room;
            return (
              <div key={plant.id}>
                {showHeader && (
                  <h2 style={{
                    fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
                    color: C.muted, margin: '10px 0 8px', textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    {room}
                  </h2>
                )}
                <PlantCard plant={plant} onTap={setSelectedPlant} />
              </div>
            );
          });
        })()}
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
            background: online ? C.feed : C.rust,
          }} />
          {online ? 'Online' : 'Offline'}
        </span>
      </div>
    </div>
  );
}
