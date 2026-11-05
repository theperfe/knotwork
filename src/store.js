// Local progress: best times per level, daily streak. Safe if storage is blocked.
const KEY = 'knotwork.v1';
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export const store = {
  data: Object.assign({ levels: {}, daily: { streak: 0, last: null, best: {} }, seenTutorial: false }, load()),
  levelBest(i) { return this.data.levels[i]; },
  unlocked(i) { return i === 0 || this.data.levels[i - 1] != null || this.data.levels[i] != null; },
  solveLevel(i, t) { const b = this.data.levels[i]; if (b == null || t < b) this.data.levels[i] = t; save(this.data); },
  dailyDone(day) { return this.data.daily.best[day] != null; },
  solveDaily(day, t) {
    const d = this.data.daily;
    if (d.best[day] == null) {
      d.streak = d.last === day - 1 ? d.streak + 1 : d.last === day ? d.streak : 1;
      d.last = day;
    }
    if (d.best[day] == null || t < d.best[day]) d.best[day] = t;
    save(this.data);
    return d.streak;
  },
  streak(today) { const d = this.data.daily; return d.last === today || d.last === today - 1 ? d.streak : 0; },
  markTutorial() { this.data.seenTutorial = true; save(this.data); },
};
export const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
