const forever = require('forever-monitor');
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()
const moment = require('moment')

  var child = new (forever.Monitor)('index.js', {
    silent: false,
    args: []
  });

  child.on('restart', function () {
    console.log('index.js has been restarted');
    var time = moment().format()
    send_email.send("TImR-VIMS Mediator Restarted","The mediator was restarted on "+ time,()=>{

    })
  });

  child.on('exit', function () {
    console.log('Timr-VIMS Mediator has stoped');
    var time = moment().format()
    send_email.send("TImR-VIMS Mediator Restarted","The mediator was restarted on "+ time,()=>{

    })
  });

  child.start();
