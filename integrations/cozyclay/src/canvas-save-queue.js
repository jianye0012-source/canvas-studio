export function createSaveQueue(runSave) {
  let running = false, pending;
  const execute = item => {
    running = true;
    Promise.resolve().then(() => runSave(item.force)).then(item.resolve, item.reject).finally(() => {
      if (pending) { const next = pending; pending = undefined; execute(next); }
      else running = false;
    });
  };
  return (force = false) => {
    if (!running) return new Promise((resolve, reject) => execute({ force, resolve, reject }));
    if (!pending) {
      let resolve, reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      pending = { force, resolve, reject, promise };
    } else pending.force ||= force;
    return pending.promise;
  };
}
