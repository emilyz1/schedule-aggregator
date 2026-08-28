// ── Color scale ───────────────────────────────────────────────────────────────

function ratioToColor(ratio) {
  // 0 → light green, 0.5 → yellow, 1 → red
  const stops = [
    [0,    [220, 252, 231]],   // #dcfce7
    [0.25, [134, 239, 172]],   // #86efac
    [0.5,  [253, 224, 71 ]],   // #fde047
    [0.75, [251, 146, 60 ]],   // #fb923c
    [1.0,  [239, 68,  68 ]]    // #ef4444
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (ratio >= t0 && ratio <= t1) {
      const t = (ratio - t0) / (t1 - t0)
      const rgb = c0.map((v, j) => Math.round(v + (c1[j] - v) * t))
      return `rgb(${rgb.join(',')})`
    }
  }
  return `rgb(239,68,68)`
}

const EMPTY_COLOR = '#f8fafc'

// ── Grid construction ─────────────────────────────────────────────────────────

function buildGrid(container) {
  container.innerHTML = ''

  // Header row: spacer + day labels
  container.appendChild(makeEl('div', 'grid-spacer'))
  DAYS.forEach(day => container.appendChild(makeEl('div', 'grid-day-header', day)))

  // One row per 15-min slot
  for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
    const label = makeEl('div', 'grid-time-label')
    // Show text label only on hour marks (every 4 slots)
    if (slot % 4 === 0) label.textContent = formatTime(slotToTime(slot))
    container.appendChild(label)

    for (let day = 0; day < 7; day++) {
      const cell = makeEl('div', 'grid-cell')
      cell.id = `cell-${day}-${slot}`
      cell.dataset.day = day
      cell.dataset.slot = slot
      cell.style.backgroundColor = EMPTY_COLOR
      container.appendChild(cell)
    }
  }
}

// ── Cell color updates ────────────────────────────────────────────────────────

function updateCells(heatmap, totalUsers) {
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      const cell = document.getElementById(`cell-${day}-${slot}`)
      if (!cell) continue
      const count = heatmap[day][slot].size
      const ratio = totalUsers > 0 ? count / totalUsers : 0
      cell.style.backgroundColor = totalUsers === 0 ? EMPTY_COLOR : ratioToColor(ratio)
      cell.setAttribute('aria-label', totalUsers > 0
        ? `${count} of ${totalUsers} users have a conflict`
        : 'No data'
      )
    }
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

let tooltipEl = null

function initTooltip() {
  tooltipEl = document.getElementById('tooltip')
}

function showTooltip(event, day, slot, heatmap, totalUsers, allConflicts, filterHardOnly) {
  if (!tooltipEl || !heatmap) return

  const count = heatmap[day][slot].size
  const time = formatTime(slotToTime(slot))
  const timeEnd = formatTime(slotToTime(slot + 1))

  let html = `<strong>${DAYS[day]} ${time}–${timeEnd}</strong>`
  html += `<div class="tt-summary">${count} of ${totalUsers} user${totalUsers !== 1 ? 's' : ''} unavailable</div>`

  const relevant = (filterHardOnly ? allConflicts.filter(c => c.severity === 'hard') : allConflicts)
    .filter(c => {
      const startSlot = timeToSlot(c.startTime)
      const endSlot = timeToSlot(c.endTime)
      if (slot < startSlot || slot >= endSlot) return false
      if (c.type === 'recurring') return c.dayOfWeek === day
      const d = new Date(c.date + 'T12:00:00')
      return (d.getDay() + 6) % 7 === day
    })

  if (relevant.length) {
    html += '<ul class="tt-list">'
    relevant.forEach(c => {
      const badge = c.severity === 'hard' ? '<span class="badge-hard">hard</span>' : '<span class="badge-soft">soft</span>'
      const label = c.type === 'recurring' ? '↻' : formatDate(c.date)
      html += `<li>${badge} <strong>${c.userName}</strong> ${label}${c.description ? ` — ${c.description}` : ''}</li>`
    })
    html += '</ul>'
  }

  tooltipEl.innerHTML = html
  tooltipEl.hidden = false
  positionTooltip(event)
}

function positionTooltip(event) {
  if (!tooltipEl) return
  const margin = 12
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = tooltipEl.getBoundingClientRect()
  let left = event.clientX + margin
  let top = event.clientY + margin
  if (left + rect.width > vw - margin) left = event.clientX - rect.width - margin
  if (top + rect.height > vh - margin) top = event.clientY - rect.height - margin
  tooltipEl.style.left = `${left}px`
  tooltipEl.style.top = `${top}px`
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.hidden = true
}

// ── Cell detail panel ─────────────────────────────────────────────────────────

function showCellDetail(day, slot, allConflicts, filterHardOnly) {
  const panel = document.getElementById('cell-detail')
  const title = document.getElementById('cell-detail-title')
  const content = document.getElementById('cell-detail-content')
  if (!panel) return

  const time = formatTime(slotToTime(slot))
  const timeEnd = formatTime(slotToTime(slot + 1))
  title.textContent = `${DAYS[day]} · ${time} – ${timeEnd}`

  const relevant = (filterHardOnly ? allConflicts.filter(c => c.severity === 'hard') : allConflicts)
    .filter(c => {
      const startSlot = timeToSlot(c.startTime)
      const endSlot = timeToSlot(c.endTime)
      if (slot < startSlot || slot >= endSlot) return false
      if (c.type === 'recurring') return c.dayOfWeek === day
      const d = new Date(c.date + 'T12:00:00')
      return (d.getDay() + 6) % 7 === day
    })

  if (relevant.length === 0) {
    content.innerHTML = '<p class="detail-empty">No conflicts in this time slot.</p>'
  } else {
    content.innerHTML = relevant.map(c => `
      <div class="detail-item ${c.severity}">
        <div class="detail-item-header">
          <span class="detail-name">${escHtml(c.userName)}</span>
          <span class="badge-${c.severity}">${c.severity}</span>
          <span class="detail-type">${c.type === 'recurring' ? '↻ recurring' : `${formatDate(c.date)}`}</span>
        </div>
        <div class="detail-time">${formatTime(c.startTime)} – ${formatTime(c.endTime)}</div>
        ${c.description ? `<div class="detail-desc">${escHtml(c.description)}</div>` : ''}
      </div>
    `).join('')
  }

  panel.hidden = false
}

function closeCellDetail() {
  const panel = document.getElementById('cell-detail')
  if (panel) panel.hidden = true
}

// ── Best-times banner ─────────────────────────────────────────────────────────

function renderBestTimes(bestTimes, totalUsers) {
  const banner = document.getElementById('best-times-bar')
  if (!banner) return

  if (!bestTimes.length || totalUsers === 0) {
    banner.hidden = true
    return
  }

  banner.hidden = false
  const chips = bestTimes.map(({ day, slot, conflictedCount }) => {
    const available = totalUsers - conflictedCount
    const startStr = formatTime(slotToTime(slot))
    const endStr   = formatTime(slotToTime(slot + 4))
    return `<span class="best-chip">${DAYS[day]} ${startStr}–${endStr} · ${available}/${totalUsers} free</span>`
  })
  banner.innerHTML = `<span class="best-label">Best times:</span> ${chips.join('')}`
}

// ── Legend ────────────────────────────────────────────────────────────────────

function buildLegend(container) {
  const steps = [0, 0.25, 0.5, 0.75, 1]
  const labels = ['0%', '25%', '50%', '75%', '100%']
  container.innerHTML = '<span style="color:var(--muted);margin-right:4px">Conflicts:</span>' +
    steps.map((r, i) =>
      `<span class="legend-swatch" style="background:${ratioToColor(r)}"></span>${labels[i]}`
    ).join(' ')
}

// ── Time select helpers ───────────────────────────────────────────────────────

function populateTimeSelects(startEl, endEl) {
  startEl.innerHTML = ''
  endEl.innerHTML = ''

  for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
    const opt = document.createElement('option')
    opt.value = slotToTime(slot)
    opt.textContent = formatTime(slotToTime(slot))
    startEl.appendChild(opt)
  }

  for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
    const opt = document.createElement('option')
    opt.value = slotToTime(slot)
    opt.textContent = formatTime(slotToTime(slot))
    endEl.appendChild(opt)
  }

  // Default: start 9 AM, end 10 AM
  const defaultStart = (9 - START_HOUR) * 4
  startEl.selectedIndex = defaultStart
  endEl.selectedIndex = defaultStart + 4 - 1
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function makeEl(tag, className, text) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
