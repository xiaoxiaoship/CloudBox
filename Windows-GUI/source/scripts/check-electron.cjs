const { app } = require('electron');
app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    console.log('versions', JSON.stringify(process.versions));
    console.log('sqlite', db.prepare('select sqlite_version() as v').get());
    db.close();
    console.log('BETTER_SQLITE3_OK');
    app.exit(0);
  } catch (error) {
    console.error('BETTER_SQLITE3_FAIL', error);
    app.exit(1);
  }
});
