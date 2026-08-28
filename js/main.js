document.addEventListener('DOMContentLoaded', () => {
  // Set default date range: today → 3 months from now
  const today = new Date()
  const threeMonths = new Date(today)
  threeMonths.setMonth(threeMonths.getMonth() + 3)

  const startInput = document.getElementById('start-date')
  const endInput = document.getElementById('end-date')
  if (startInput) startInput.value = toDateValue(today)
  if (endInput) endInput.value = toDateValue(threeMonths)

  // Create group form
  document.getElementById('create-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const name = document.getElementById('group-name').value.trim()
    const start = document.getElementById('start-date').value
    const end = document.getElementById('end-date').value

    if (!name || !start || !end) return
    if (start >= end) {
      showError('create-error', 'End date must be after start date.')
      return
    }

    const btn = e.target.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = 'Creating…'

    try {
      const groupId = await createGroup(name, start, end)
      window.location.href = `group.html?id=${groupId}`
    } catch (err) {
      btn.disabled = false
      btn.textContent = 'Create Group →'
      showError('create-error', 'Failed to create group. Check your Firebase config.')
      console.error(err)
    }
  })

  // Join group form
  document.getElementById('join-form')?.addEventListener('submit', e => {
    e.preventDefault()
    const raw = document.getElementById('join-id').value.trim()
    const groupId = parseGroupInput(raw)
    if (!groupId) {
      showError('join-error', 'Please enter a valid group ID or link.')
      return
    }
    window.location.href = `group.html?id=${groupId}`
  })
})

function parseGroupInput(input) {
  try {
    const url = new URL(input)
    return url.searchParams.get('id') || null
  } catch {
    // Not a URL — treat as raw ID (alphanumeric)
    return /^[a-zA-Z0-9]{6,20}$/.test(input) ? input : null
  }
}

function toDateValue(date) {
  return date.toISOString().slice(0, 10)
}

function showError(elId, msg) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = msg
  el.hidden = false
}
