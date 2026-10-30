process.on('disconnect', () => process.exit(0));
import('../web/server.js').catch(error => { console.error(error); process.exit(1); });
