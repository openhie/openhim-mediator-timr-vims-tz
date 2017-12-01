'use strict'

const URI = require('urijs')
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()

exports.buildOrchestration = (name, beforeTimestamp, method, url, requestContent, res, body) => {
  let uri = new URI(url)
  var body = JSON.stringify({"response":"Response Disabled"})
  if('statusCode' in res)
  var statusCode = res.statusCode
  else {
    var statusCode = 503
    send_email.send("TImR-VIMS Mediator Restarted","Res===>" + res + "Body===>" + body + "Req===>"+requestContent+ "Time===>"+ time,()=>{

    })
  }
  return {
    name: name,
    request: {
      method: method,
      body: requestContent,
      timestamp: beforeTimestamp,
      path: uri.path(),
      querystring: uri.query()

    },
    response: {
      status: statusCode,
      headers: res.headers,
      body: body,
      timestamp: new Date()
    }
  }
}
