// PM2 cluster: N workers share port 3000. Routines use a DB claim lock so only one worker runs each.
module.exports = {
  apps: [{
    name: 'ai-console',
    script: 'server/index.js',
    exec_mode: 'cluster',
    instances: Number(process.env.WEB_CONCURRENCY) || 2,
    max_memory_restart: '400M',
  }],
};
