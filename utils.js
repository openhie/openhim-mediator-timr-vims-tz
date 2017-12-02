'use strict'

const URI = require('urijs')
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()

exports.buildOrchestration = (name, beforeTimestamp, method, url, requestContent, res, body) => {
  let uri = new URI(url)
  var body = JSON.stringify({"response":"Response Disabled"})
  if(res == undefined || res == null || res == false) {
    var statusCode = 503
    var header = JSON.stringify({"response_header":"Empty Header Returned"})
    send_email.send("Empty Response Data","Res===>" + res + "Body===>" + body + "Req===>"+requestContent+ "Time===>"+ time,()=>{

    })
  }
  else if('statusCode' in res) {
    var statusCode = res.statusCode
    var header = res.headers
  }
  console.log(header)
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
      headers: header,
      body: body,
      timestamp: new Date()
    }
  }
}
