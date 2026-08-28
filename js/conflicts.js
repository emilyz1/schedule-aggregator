// ── Time constants ──────────────────────────────────────────────────────────

const START_HOUR = 7    // 7 AM
const END_HOUR = 23     // 11 PM
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 4  // 64 × 15-min slots

// Display order: Mon=0 … Sun=6
// Stored dayOfWeek uses the same display index.
// JS Date.getDay(): Sun=0 Mon=1 … Sat=6
// Conversion: displayDay = (jsDay + 6) % 7
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── Time helpers ─────────────────────────────────────────────────────────────

function slotToTime(slot) {
  const totalMinutes = START_HOUR * 60 + slot * 15
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function timeToSlot(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return (h - START_HOUR) * 4 + m / 15
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
}

function formatDate(yyyymmdd) {
  const [y, mo, d] = yyyymmdd.split('-').map(Number)
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[mo - 1]} ${d}, ${y}`
}

// ── Session key (owner identity) ─────────────────────────────────────────────

function getSessionKey() {
  let key = localStorage.getItem('sessionKey')
  if (!key) {
    key = crypto.randomUUID()
    localStorage.setItem('sessionKey', key)
  }
  return key
}

// ── Firestore CRUD ────────────────────────────────────────────────────────────

async function createGroup(name, startDate, endDate) {
  const ref = await db.collection('groups').add({
    name,
    dateRange: { start: startDate, end: endDate },
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  return ref.id
}

async function fetchGroup(groupId) {
  const doc = await db.collection('groups').doc(groupId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() }
}

function subscribeToConflicts(groupId, callback) {
  // Avoiding orderBy to prevent requiring a composite Firestore index;
  // we sort client-side by createdAt instead.
  return db.collection('conflicts')
    .where('groupId', '==', groupId)
    .where('deleted', '==', false)
    .onSnapshot(snapshot => {
      const conflicts = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0
          const tb = b.createdAt?.toMillis?.() ?? 0
          return ta - tb
        })
      callback(conflicts)
    })
}

async function addRecurringConflict(groupId, userName, dayOfWeek, startTime, endTime, severity, description) {
  await db.collection('conflicts').add({
    groupId,
    userName,
    sessionKey: getSessionKey(),
    type: 'recurring',
    dayOfWeek,      // display index: 0=Mon, 6=Sun
    startTime,
    endTime,
    severity,
    description,
    deleted: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
}

async function addOneoffConflict(groupId, userName, date, startTime, endTime, severity, description) {
  await db.collection('conflicts').add({
    groupId,
    userName,
    sessionKey: getSessionKey(),
    type: 'oneoff',
    date,           // "YYYY-MM-DD"
    startTime,
    endTime,
    severity,
    description,
    deleted: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
}

// Soft-delete: marks deleted=true. The Firestore rule requires sessionKey to match.
async function removeConflict(docId) {
  const sessionKey = getSessionKey()
  try {
    await db.collection('conflicts').doc(docId).update({
      deleted: true,
      sessionKey    // Firestore rule: request.resource.data.sessionKey == resource.data.sessionKey
    })
  } catch (err) {
    if (err.code === 'permission-denied') {
      throw new Error('You can only delete your own conflicts.')
    }
    throw err
  }
}

// ── Heatmap computation ───────────────────────────────────────────────────────

function computeHeatmap(conflicts, { filterHardOnly = false, viewMode = 'aggregate', weekStart = null } = {}) {
  const filtered = filterHardOnly ? conflicts.filter(c => c.severity === 'hard') : conflicts

  // heatmap[displayDay 0-6][slotIndex 0-63] = Set of userNames
  const heatmap = Array.from({ length: 7 }, () =>
    Array.from({ length: TOTAL_SLOTS }, () => new Set())
  )

  const allUserNames = new Set(conflicts.map(c => c.userName))

  for (const c of filtered) {
    const startSlot = timeToSlot(c.startTime)
    const endSlot = timeToSlot(c.endTime)

    if (c.type === 'recurring') {
      for (let s = startSlot; s < endSlot; s++) {
        if (s >= 0 && s < TOTAL_SLOTS) {
          heatmap[c.dayOfWeek][s].add(c.userName)
        }
      }
    } else {
      // Parse date safely (avoid UTC shift)
      const d = new Date(c.date + 'T12:00:00')
      const displayDay = (d.getDay() + 6) % 7

      if (viewMode === 'specific' && weekStart) {
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekEnd.getDate() + 7)
        if (d < weekStart || d >= weekEnd) continue
      }

      for (let s = startSlot; s < endSlot; s++) {
        if (s >= 0 && s < TOTAL_SLOTS) {
          heatmap[displayDay][s].add(c.userName)
        }
      }
    }
  }

  return { heatmap, totalUsers: allUserNames.size }
}

// Returns top-3 non-overlapping 1-hour windows during business hours with fewest conflicts.
function findBestTimes(heatmap, totalUsers) {
  if (totalUsers === 0) return []

  const workStart = (9 - START_HOUR) * 4    // 9 AM
  const workEnd   = (18 - START_HOUR) * 4   // 6 PM

  const candidates = []

  for (let day = 0; day < 7; day++) {
    for (let slot = workStart; slot <= workEnd - 4; slot++) {
      const conflicted = new Set()
      for (let i = 0; i < 4; i++) {
        for (const u of heatmap[day][slot + i]) conflicted.add(u)
      }
      candidates.push({ day, slot, conflictedCount: conflicted.size })
    }
  }

  candidates.sort((a, b) =>
    a.conflictedCount - b.conflictedCount || a.day - b.day || a.slot - b.slot
  )

  const result = []
  for (const c of candidates) {
    const overlaps = result.some(r => r.day === c.day && Math.abs(r.slot - c.slot) < 4)
    if (!overlaps) result.push(c)
    if (result.length >= 3) break
  }

  return result
}
