// Chromium follows the user's Windows system proxy/PAC and certificate store.
// Keep this dependency injected so CLI/unit tests do not need Electron.
function createUpdateFetch(net) {
  return (url, options = {}) => net.fetch(url, { ...options, credentials: 'omit', cache: 'no-store' });
}
module.exports = { createUpdateFetch };
