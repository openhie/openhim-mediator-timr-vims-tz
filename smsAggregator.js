'use strict'
const URI = require('urijs')
const request = require('request')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const winston = require('winston')
const utils = require('./utils')

module.exports = function (aggregatorconf) {
  const config = aggregatorconf
  return {

    broadcast: function (phone,msg,orchestrations) {
      let url = URI(config.url) + "?msisdn=" + phone + "&message=" + msg + "&u=" + config.username + "&p=" + config.password
      let before = new Date()

      let options = {
        url: url.toString()
      }
      winston.error(phone)
      request.get(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Sending alert to defaulter', before, 'GET', url.toString(), options.body, res, body))
        winston.info(body)
      })
    }
  }

}
