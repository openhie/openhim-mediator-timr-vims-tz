'use strict'
const URI = require('urijs')
const request = require('request')
const winston = require('winston')
const utils = require('./utils')

module.exports = function (aggregatorconf) {
  const config = aggregatorconf
  return {

    broadcast: function (phone, msg, orchestrations, callback) {
      let url = URI(config.url)
        .addQuery("action", "compose")
        .addQuery("username", "timr")
        .addQuery("api_key", "fcdd31373486aab75aa9510351c0d262:oss0H7yxTh2BkESeQIN4C07tuGJWrpLE")
        .addQuery("sender", "EVMAKTEST")
        .addQuery("to", phone)
        .addQuery("message", msg)
        .toString()
      let before = new Date()

      let options = {
        url: url.toString()
      }
      request.get(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Sending message', before, 'GET', url.toString(), options.body, res, body))
        winston.info(body)
        return callback(err, res, body)
      })
    }
  }

}