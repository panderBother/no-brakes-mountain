export const TOTAL_LEVELS = 9;

export function campaignProgress(completed = [], afterId = 0) {
  const ids = [...new Set((Array.isArray(completed) ? completed : []).filter(id => Number.isInteger(id) && id >= 1 && id <= TOTAL_LEVELS))];
  const remaining = Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1).filter(id => !ids.includes(id));
  return {
    completed: ids, count: ids.length, remaining: remaining.length,
    allCleared: remaining.length === 0,
    nextId: remaining.find(id => id > afterId) ?? remaining[0] ?? null,
  };
}

// Monotonic real time, independent of simulation speed and attempt restarts.
// Call at activity boundaries as well as frames so pauses/hidden tabs add nothing.
export class PlayTimeTracker {
  constructor(totalMs = 0) {
    this.totalMs = Number.isFinite(totalMs) && totalMs > 0 ? totalMs : 0;
    this.lastTime = null;
    this.active = false;
  }

  checkpoint(now, active) {
    if (!Number.isFinite(now) || (this.lastTime !== null && now < this.lastTime)) return this.totalMs;
    if (this.lastTime !== null && this.active) this.totalMs += now - this.lastTime;
    this.lastTime = now;
    this.active = Boolean(active);
    return this.totalMs;
  }
}

export function investmentText(milliseconds) {
  const seconds = Math.floor((Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours} 小时 ` : ''}${hours || minutes ? `${minutes} 分 ` : ''}${rest} 秒`;
}

export const EASTER_EGGS = [
  '山脚便利店发来贺电：恭喜获得一张不存在的刹车优惠券。',
  '护栏售后提醒您：超过 150 km/h 的拥抱，不在保修范围内。',
  '山谷里的回声说：好耶——耶——耶！',
  '时间管理员偷偷点了个赞，然后拒绝给倒计时加班。',
  '雨刷的内心独白：我都这么努力了，你可别掉下去啊。',
  '雪人裁判举牌：技术满分，胆量超标。',
  '断桥施工队留言：感谢您选择飞过去，本桥暂不接受催修。',
  '终点观众已经站起来了。还有一条山道，大伙儿等你！',
  '隐藏称号已解锁：山道时间管理大师。掌声送给还没松开方向键的你。',
];
