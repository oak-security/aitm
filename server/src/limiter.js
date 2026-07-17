// Per-user AI-call limits protecting a shared provider key (Hive RunLimiter pattern):
// a live concurrent cap and an optional per-UTC-day cap. In-memory; restart resets.
export class AiLimiter {
  constructor({ maxConcurrent = 2, maxPerDay = 0 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxPerDay = maxPerDay;
    this.live = new Map(); // uid -> count
    this.daily = new Map(); // uid -> { day, count }
  }

  check(uid) {
    if (this.maxConcurrent > 0 && (this.live.get(uid) || 0) >= this.maxConcurrent) {
      return { ok: false, message: `Limit: at most ${this.maxConcurrent} concurrent AI calls.` };
    }
    if (this.maxPerDay > 0) {
      const d = this.daily.get(uid);
      if (d && d.day === today() && d.count >= this.maxPerDay) {
        return { ok: false, message: `Daily AI call limit reached (${this.maxPerDay}).` };
      }
    }
    return { ok: true };
  }

  begin(uid) {
    this.live.set(uid, (this.live.get(uid) || 0) + 1);
    const d = this.daily.get(uid);
    if (d && d.day === today()) d.count += 1;
    else this.daily.set(uid, { day: today(), count: 1 });
  }

  end(uid) {
    const n = (this.live.get(uid) || 1) - 1;
    if (n <= 0) this.live.delete(uid);
    else this.live.set(uid, n);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
