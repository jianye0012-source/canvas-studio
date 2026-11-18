// Chromium follows the user's Windows system proxy/PAC and certificate store.
// Keep this dependency injected so CLI/unit tests do not need Electron.
function createUpdateFetch(net) {
  return async (url, options = {}) => {
    try { return await net.fetch(url, { ...options, credentials: 'omit', cache: 'no-store' }); }
    catch (error) {
      if (['manual', 'error'].includes(options.redirect) &&
          (error?.message === 'Redirect was cancelled' || error?.message === "Attempted to redirect, but redirect policy was 'error'")) error.code = 'ERR_REDIRECT_BLOCKED';
      throw error;
    }
  };
}
module.exports = { createUpdateFetch };
