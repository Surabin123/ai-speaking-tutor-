// progress.js
// Dynamic dashboard: reads localStorage.smarttalk_sessions and updates the UI (cards, calendar, chart, daily summary).

(function () {
  // ---------- Config & DOM refs ----------
  const STORAGE_KEY = 'smarttalk_sessions';

  // Overview cards (based on your HTML: four .card elements in order)
  const overviewCards = document.querySelectorAll('.overview .card');
  const fluencyCardSpan = overviewCards[0]?.querySelector('span'); // Fluency Level
  const totalSessionsSpan = overviewCards[1]?.querySelector('span'); // Total Sessions
  const streakSpan = overviewCards[2]?.querySelector('span'); // Current Streak
  const totalTimeSpan = overviewCards[3]?.querySelector('span'); // Total Speaking Time

  // Calendar and chart canvas
  const calendarGrid = document.getElementById('calendarGrid');
  const chartCanvas = document.getElementById('progressChart');

  // Daily summary boxes (your .daily-performance .stats-box order)
  const statsBoxes = document.querySelectorAll('.daily-performance .stats-box div');
  // indexes: 0=Speech Efficiency,1=Confidence Score,2=Fillers,3=Speaking Time,4=Sessions,5=Badge

  // Chart instance holder
  let chartInstance = null;

  // ---------- Helpers ----------
  function safeText(el, txt) { if (el) el.textContent = txt; }

  function loadSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '[]';
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // normalize fields
      return arr.map(s => ({
        id: s.id || `sess_${Date.now()}`,
        dateISO: s.dateISO || new Date().toISOString(),
        durationMs: Number(s.durationMs || 0),
        totalFillers: Number(s.totalFillers || 0),
        eyeContactPct: Number(s.eyeContactPct || 0),
        fillerBreakdown: s.fillerBreakdown || {},
        practiceType: s.practiceType || 'unknown',
        frames: Number(s.frames || 0),
        sessionNumber: Number(s.sessionNumber || 0)
      })).sort((a,b) => new Date(a.dateISO) - new Date(b.dateISO));
    } catch (e) {
      console.warn('progress.js: failed to parse sessions', e);
      return [];
    }
  }

  function msToHuman(ms) {
    if (!ms) return '0m';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // Estimate fluency from avg fillers per session (simple heuristic)
  function estimateFluencyPercent(sessions) {
    if (!sessions.length) return 0;
    const avgFillers = sessions.reduce((s, v) => s + (v.totalFillers || 0), 0) / sessions.length;
    // heuristic mapping
    const val = Math.round(100 - Math.min(100, avgFillers * 4));
    return Math.max(0, Math.min(100, val));
  }

  function estimateConfidencePercent(sessions) {
    if (!sessions.length) return 0;
    const avg = Math.round(sessions.reduce((s, v) => s + (v.eyeContactPct || 0), 0) / sessions.length);
    return Math.max(0, Math.min(100, avg));
  }

  function fluencyLabelFromPercent(p) {
    if (p >= 80) return 'Advanced';
    if (p >= 55) return 'Intermediate';
    return 'Beginner';
  }

  // Current streak: consecutive days with >=1 session finishing today backward
  function calculateStreak(sessions) {
    if (!sessions.length) return 0;
    const dates = new Set(sessions.map(s => {
      const d = new Date(s.dateISO);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }));
    let streak = 0;
    const today = new Date();
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    while (true) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
      if (dates.has(key)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return streak;
  }

  // ---------- Calendar rendering ----------
  function renderCalendar(sessions) {
    if (!calendarGrid) return;
    calendarGrid.innerHTML = ''; // clear

    // Build set of days in current month that have sessions
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0..11
    const daysWith = new Map(); // day -> aggregated minutes
    sessions.forEach(s => {
      const d = new Date(s.dateISO);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        const mins = Math.round((s.durationMs || 0) / 60000);
        daysWith.set(day, (daysWith.get(day) || 0) + mins);
      }
    });

    // create 30/31 cells based on current month
    const daysInMonth = new Date(year, month+1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'day';
      cell.textContent = d;
      const mins = daysWith.get(d) || 0;
      // choose intensity class based on minutes
      if (mins >= 30) cell.classList.add('active-3');
      else if (mins >= 10) cell.classList.add('active-2');
      else if (mins > 0) cell.classList.add('active-1');

      // show details on click
      cell.addEventListener('click', () => {
        const dayKey = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const daySessions = sessions.filter(s => {
          const sd = new Date(s.dateISO);
          return sd.getFullYear() === year && sd.getMonth() === month && sd.getDate() === d;
        });
        if (!daySessions.length) {
          alert(`${now.toLocaleString('default',{month:'long'})} ${d}\n\nNo sessions recorded.`);
          return;
        }
        const summary = daySessions.map(ss => {
          const t = new Date(ss.dateISO).toLocaleTimeString();
          return `${t} — ${msToHuman(ss.durationMs)} — Fillers:${ss.totalFillers}`;
        }).join('\n');
        alert(`${now.toLocaleString('default',{month:'long'})} ${d}\n\n${summary}`);
      });

      calendarGrid.appendChild(cell);
    }
  }

  // ---------- Chart rendering (Chart.js expected to be loaded) ----------
  function renderChart(sessions) {
    if (!chartCanvas) return;

    // aggregate last 8 months
    const monthsCount = 8;
    const now = new Date();
    const monthBuckets = [];
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthBuckets.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString(undefined, { month: 'short' }) });
    }

    const confidenceData = [];
    const fluencyData = [];

    monthBuckets.forEach(b => {
      const arr = sessions.filter(s => {
        const d = new Date(s.dateISO);
        return d.getFullYear() === b.year && d.getMonth() === b.month;
      });
      if (!arr.length) {
        confidenceData.push(0);
        fluencyData.push(0);
      } else {
        const conf = Math.round(arr.reduce((a,x) => a + (x.eyeContactPct||0), 0) / arr.length);
        const flu = estimateFluencyPercent(arr);
        confidenceData.push(conf);
        fluencyData.push(flu);
      }
    });

    // destroy old chart
    if (chartInstance) {
      try { chartInstance.destroy(); } catch (e) { /* ignore */ }
      chartInstance = null;
    }

    if (typeof Chart === 'undefined') {
      // fallback message if Chart.js not loaded
      chartCanvas.parentElement.innerHTML = '<div style="padding:12px;color:#666">Chart.js is required to render this chart.</div>';
      return;
    }

    chartInstance = new Chart(chartCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: monthBuckets.map(b => b.label),
        datasets: [
          { label: 'Confidence (%)', data: confidenceData, backgroundColor: 'rgba(37,99,235,0.65)', borderRadius: 8 },
          { label: 'Fluency (%)', data: fluencyData, backgroundColor: 'rgba(147,197,253,0.7)', borderRadius: 8 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, title: { display: true, text: 'Performance (%)' } },
          x: { title: { display: true, text: 'Month' } }
        },
        plugins: { legend: { position: 'top' } }
      }
    });
  }

  // ---------- Daily summary update ----------
  function updateDailySummary(sessions) {
    // produce stats from most recent session if any
    const last = sessions.length ? sessions[sessions.length - 1] : null;
    const speechEfficiency = last ? Math.max(40, Math.min(100, 85 - (last.totalFillers || 0))) : 86;
    const confidence = last ? Math.round(last.eyeContactPct || 0) : 90;
    const fillers = last ? last.totalFillers || 0 : 7;
    const speakingTime = last ? msToHuman(last.durationMs) : '12m';
    const sessionsToday = sessions.filter(s => {
      const d = new Date(s.dateISO);
      const t = new Date();
      return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
    }).length;

    if (statsBoxes && statsBoxes.length >= 6) {
      statsBoxes[0].innerHTML = `<strong>Speech Efficiency:</strong> ${speechEfficiency}%`;
      statsBoxes[1].innerHTML = `<strong>Confidence Score:</strong> ${confidence}%`;
      statsBoxes[2].innerHTML = `<strong>Filler Words:</strong> ${fillers}`;
      statsBoxes[3].innerHTML = `<strong>Speaking Time:</strong> ${speakingTime}`;
      statsBoxes[4].innerHTML = `<strong>Sessions Completed:</strong> ${sessionsToday}`;
      // performance badge simple mapping
      const badge = (speechEfficiency >= 85 && confidence >= 80) ? 'Fluent Starter' : (speechEfficiency >= 70 ? 'Improving' : 'Needs Practice');
      statsBoxes[5].innerHTML = `<strong>Performance Badge:</strong> ${badge}`;
    }
  }

  // ---------- Main update function ----------
  function refreshUI() {
    const sessions = loadSessions();

    // totals
    const totalSessions = sessions.length;
    const totalMs = sessions.reduce((a, s) => a + (s.durationMs || 0), 0);

    // estimates
    const fluencyPct = estimateFluencyPercent(sessions);
    const confidencePct = estimateConfidencePercent(sessions);
    const fluencyLabel = fluencyLabelFromPercent(fluencyPct);
    const streak = calculateStreak(sessions);

    // update DOM
    safeText(fluencyCardSpan, fluencyLabel);
    safeText(totalSessionsSpan, totalSessions.toString());
    safeText(streakSpan, `${streak} ${streak === 1 ? 'Day' : 'Days'}`);
    safeText(totalTimeSpan, msToHuman(totalMs));

    updateDailySummary(sessions);
    renderCalendar(sessions);

    // ensure canvas has a height so Chart.js renders nicely
    if (chartCanvas && !chartCanvas.style.height) chartCanvas.style.height = '320px';
    renderChart(sessions);

    // update header small badge if present
    const hdrSmall = document.querySelector('.header small');
    if (hdrSmall) hdrSmall.textContent = `Sessions: ${totalSessions}`;
  }

  // ---------- Event hooks ----------
  // initial render on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshUI);
  } else {
    refreshUI();
  }

  // listen for storage changes (other tabs)
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORAGE_KEY) refreshUI();
  });

  // listen for custom event (record.js uses this)
  window.addEventListener('smarttalk_sessions_updated', refreshUI);

  // fallback polling small interval to catch same-tab updates if some browsers behave oddly
  setInterval(refreshUI, 4000);

  // Expose debug helper
  window.__smarttalk_progress = { refreshUI };
})();
