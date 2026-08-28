// ── Module state ──────────────────────────────────────────────────────────────

let groupId = null
let groupData = null
let allConflicts = []
let filterHardOnly = false
let viewMode = 'aggregate'
let currentWeekStart = getMonday(new Date())
let currentHeatmap = null
let currentTotalUsers = 0
let unsubscribe = null
let editingConflictId = null  // set when editing an existing conflict

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search)
  groupId = params.get('id')

  if (!groupId) {
    showFatalError('No group ID in URL. <a href="index.html">Go home</a>.')
    return
  }

  try {
    groupData = await fetchGroup(groupId)
  } catch (err) {
    showFatalError('Could not load group — check your Firebase configuration.')
    console.error(err)
    return
  }

  if (!groupData) {
    showFatalError('Group not found. <a href="index.html">Go home</a>.')
    return
  }

  renderGroupHeader()
  buildGrid(document.getElementById('heatmap-grid'))
  buildLegend(document.getElementById('legend'))
  initTooltip()
  setupTimeSelects()
  restoreUserName()
  setupEventListeners()
  subscribeRealtime()
})

// ── Header ────────────────────────────────────────────────────────────────────

function renderGroupHeader() {
  document.title = groupData.name + ' — Scheduler'
  document.getElementById('group-title').textContent = groupData.name
  const { start, end } = groupData.dateRange
  document.getElementById('group-date-range').textContent =
    `${formatDate(start)} – ${formatDate(end)}`

  const shareUrl = window.location.href
  const shareBtn = document.getElementById('share-btn')
  shareBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      shareBtn.textContent = 'Copied!'
      setTimeout(() => { shareBtn.textContent = 'Copy Link' }, 1500)
    })
  })
}

// ── Realtime subscription ─────────────────────────────────────────────────────

function subscribeRealtime() {
  if (unsubscribe) unsubscribe()
  unsubscribe = subscribeToConflicts(groupId, conflicts => {
    allConflicts = conflicts
    rerender()
  })
}

// ── Rerender (called whenever state changes) ──────────────────────────────────

function rerender() {
  const { heatmap, totalUsers } = computeHeatmap(allConflicts, {
    filterHardOnly,
    viewMode,
    weekStart: viewMode === 'specific' ? currentWeekStart : null
  })
  currentHeatmap = heatmap
  currentTotalUsers = totalUsers

  updateCells(heatmap, totalUsers)
  renderBestTimes(findBestTimes(heatmap, totalUsers), totalUsers)
  renderMyConflicts()
  renderWeekLabel()

  // Re-bind cell events after any rerender
  bindCellEvents()
}

// ── Cell events (bound after rerender so they see fresh state) ────────────────

function bindCellEvents() {
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      const cell = document.getElementById(`cell-${day}-${slot}`)
      if (!cell) continue
      cell.onclick = () => showCellDetail(day, slot, allConflicts, filterHardOnly)
      cell.onmouseenter = e => showTooltip(e, day, slot, currentHeatmap, currentTotalUsers, allConflicts, filterHardOnly)
      cell.onmouseleave = hideTooltip
      cell.onmousemove = e => positionTooltip(e)
    }
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  // Filter: hard-only toggle
  document.getElementById('hard-only-toggle').addEventListener('change', e => {
    filterHardOnly = e.target.checked
    rerender()
  })

  // View mode toggle buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view
      document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn))
      document.getElementById('week-nav').hidden = viewMode !== 'specific'
      rerender()
    })
  })

  // Week navigation
  document.getElementById('prev-week')?.addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7)
    rerender()
  })
  document.getElementById('next-week')?.addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7)
    rerender()
  })

  // All-day toggles
  document.getElementById('r-allday').addEventListener('change', e => {
    document.getElementById('r-time-row').hidden = e.target.checked
  })
  document.getElementById('o-allday').addEventListener('change', e => {
    document.getElementById('o-time-row').hidden = e.target.checked
  })

  // Form tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn))
      document.getElementById('recurring-form').hidden = tab !== 'recurring'
      document.getElementById('oneoff-form').hidden = tab !== 'oneoff'
    })
  })

  // Username persistence
  document.getElementById('user-name').addEventListener('input', e => {
    localStorage.setItem('userName', e.target.value)
  })

  // Recurring form
  document.getElementById('recurring-form').addEventListener('submit', handleRecurringSubmit)

  // One-off form
  document.getElementById('oneoff-form').addEventListener('submit', handleOneoffSubmit)

  // Close cell detail
  document.getElementById('close-detail').addEventListener('click', closeCellDetail)

  // Cancel edit
  document.getElementById('cancel-edit-recurring')?.addEventListener('click', cancelEdit)
  document.getElementById('cancel-edit-oneoff')?.addEventListener('click', cancelEdit)
}

// ── Recurring conflict submission ─────────────────────────────────────────────

async function handleRecurringSubmit(e) {
  e.preventDefault()
  const name = getUserName()
  if (!name) return

  const selectedDays = [...document.querySelectorAll('.day-check:checked')].map(cb => parseInt(cb.value))
  if (!selectedDays.length) {
    showFormError('recurring-error', 'Select at least one day.')
    return
  }

  const allDay = document.getElementById('r-allday').checked
  const startTime = allDay ? '00:00' : document.getElementById('r-start').value
  const endTime   = allDay ? '23:59' : document.getElementById('r-end').value
  if (!allDay && startTime >= endTime) {
    showFormError('recurring-error', 'End time must be after start time.')
    return
  }

  const severity = document.querySelector('input[name="r-severity"]:checked').value
  const description = document.getElementById('r-description').value.trim()

  const btn = e.target.querySelector('button[type=submit]')
  btn.disabled = true

  try {
    await Promise.all(selectedDays.map(day =>
      addRecurringConflict(groupId, name, day, startTime, endTime, severity, description, allDay)
    ))
    e.target.reset()
    document.getElementById('r-start').value = '17:00'
    document.getElementById('r-end').value = '18:00'
    document.getElementById('r-time-row').hidden = false
    clearFormError('recurring-error')
  } catch (err) {
    showFormError('recurring-error', err.message || 'Failed to save.')
  } finally {
    btn.disabled = false
  }
}

// ── One-off conflict submission ────────────────────────────────────────────────

async function handleOneoffSubmit(e) {
  e.preventDefault()
  const name = getUserName()
  if (!name) return

  const date = document.getElementById('o-date').value
  if (!date) {
    showFormError('oneoff-error', 'Select a date.')
    return
  }

  const { start, end } = groupData.dateRange
  if (date < start || date > end) {
    showFormError('oneoff-error', `Date must be within ${formatDate(start)} – ${formatDate(end)}.`)
    return
  }

  const allDay = document.getElementById('o-allday').checked
  const startTime = allDay ? '00:00' : document.getElementById('o-start').value
  const endTime   = allDay ? '23:59' : document.getElementById('o-end').value
  if (!allDay && startTime >= endTime) {
    showFormError('oneoff-error', 'End time must be after start time.')
    return
  }

  const severity = document.querySelector('input[name="o-severity"]:checked').value
  const description = document.getElementById('o-description').value.trim()

  const btn = e.target.querySelector('button[type=submit]')
  btn.disabled = true

  try {
    await addOneoffConflict(groupId, name, date, startTime, endTime, severity, description, allDay)
    e.target.reset()
    document.getElementById('o-start').value = '17:00'
    document.getElementById('o-end').value = '18:00'
    document.getElementById('o-time-row').hidden = false
    setupTimeSelects()  // re-apply date constraints after reset
    clearFormError('oneoff-error')
  } catch (err) {
    showFormError('oneoff-error', err.message || 'Failed to save.')
  } finally {
    btn.disabled = false
  }
}

function cancelEdit() {
  editingConflictId = null
  document.getElementById('recurring-form').reset()
  document.getElementById('oneoff-form').reset()
  setupTimeSelects()
  document.getElementById('cancel-edit-recurring').hidden = true
  document.getElementById('cancel-edit-oneoff').hidden = true
}

// ── My conflicts list ─────────────────────────────────────────────────────────

function renderMyConflicts() {
  const sessionKey = getSessionKey()
  const mine = allConflicts.filter(c => c.sessionKey === sessionKey)
  const list = document.getElementById('my-conflicts-list')

  if (!mine.length) {
    list.innerHTML = '<p class="empty-hint">No conflicts submitted yet.</p>'
    return
  }

  list.innerHTML = mine.map(c => {
    const label = c.type === 'recurring'
      ? `${DAYS[c.dayOfWeek]} ↻`
      : formatDate(c.date)
    const timeRange = c.allDay ? 'All day' : `${formatTime(c.startTime)} – ${formatTime(c.endTime)}`
    const badge = `<span class="badge-${c.severity}">${c.severity}</span>`

    return `
      <div class="my-conflict-item" data-id="${c.id}">
        <div class="mci-row">
          ${badge}
          <span class="mci-label">${escHtml(label)}</span>
          <span class="mci-time">${timeRange}</span>
          <button class="mci-delete" data-id="${c.id}" title="Delete">✕</button>
        </div>
        ${c.description ? `<div class="mci-desc">${escHtml(c.description)}</div>` : ''}
      </div>
    `
  }).join('')

  list.querySelectorAll('.mci-delete').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id))
  })
}

async function handleDelete(docId) {
  if (!confirm('Delete this conflict?')) return
  try {
    await removeConflict(docId)
  } catch (err) {
    alert(err.message)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function restoreUserName() {
  const saved = localStorage.getItem('userName') || ''
  document.getElementById('user-name').value = saved
}

function getUserName() {
  const val = document.getElementById('user-name').value.trim()
  if (!val) {
    document.getElementById('user-name').focus()
    document.getElementById('user-name').classList.add('input-error')
    setTimeout(() => document.getElementById('user-name').classList.remove('input-error'), 1500)
    return null
  }
  localStorage.setItem('userName', val)
  return val
}

function setupTimeSelects() {
  const { start, end } = groupData.dateRange
  const oDate = document.getElementById('o-date')
  oDate.min = start
  oDate.max = end
}

function renderWeekLabel() {
  const label = document.getElementById('week-label')
  if (!label) return
  const weekEnd = new Date(currentWeekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  label.textContent = `${fmtShortDate(currentWeekStart)} – ${fmtShortDate(weekEnd)}`
}

function fmtShortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function showFatalError(msg) {
  document.body.innerHTML = `<div class="fatal-error"><p>${msg}</p></div>`
}

function showFormError(elId, msg) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = msg
  el.hidden = false
}

function clearFormError(elId) {
  const el = document.getElementById(elId)
  if (el) el.hidden = true
}
