const forever = require('forever-monitor');
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()
const moment = require('moment')

var child = new(forever.Monitor)('index.js', {
  append: true,
  silent: false,
  logFile: "/var/log/middleware_forever.log",
  outFile: "/var/log/middleware_info.log",
  errFile: "/var/log/middleware_error.log",
  command: 'node --max_old_space_size=2000',
  args: []
});

child.on('restart', function () {
  console.log('index.js has been restarted');
  var time = moment().format()
  send_email.send("Middleware Restarted", "The middleware was restarted on " + time, () => {

  })
});

child.on('exit', function () {
  console.log('Middleware  has stoped');
  var time = moment().format()
  send_email.send("Middleware has stopped", "The middleware was stopped on " + time, () => {

  })
});

child.start();
