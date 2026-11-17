export function createOutputRequests({ post, onAccepted = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, makeId = () => crypto.randomUUID() }) {
  const pending = new Map();
  return {
    send(type, payload) {
      return new Promise((resolve, reject) => {
        const requestId = makeId();
        const timer = setTimer(() => {
          pending.delete(requestId);
          reject(new Error('画布未响应，请确认画布页面仍然打开后重试'));
        }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        try { post(type, { ...payload, requestId }); }
        catch (error) { clearTimer(timer); pending.delete(requestId); reject(error); }
      });
    },
    receive(type, payload) {
      const request = pending.get(payload?.requestId);
      if (!request) return;
      if (type === 'storyai:director-output-accepted') {
        clearTimer(request.timer); onAccepted();
      } else if (type === 'storyai:director-output-result') {
        clearTimer(request.timer); pending.delete(payload.requestId);
        if (payload.ok) request.resolve();
        else request.reject(new Error(typeof payload.error === 'string' ? payload.error.slice(0, 300) : '截图或动画未写入磁盘，请检查数据目录并重试'));
      }
    },
    close() {
      for (const request of pending.values()) { clearTimer(request.timer); request.reject(new Error('导演台已关闭')); }
      pending.clear();
    },
  };
}
