'use strict'
const URI = require('urijs')
const request = require('request')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const winston = require('winston')
const utils = require('./utils')

module.exports = function (rpconf) {
  const config = rpconf
  return {

    broadcast: function (rp_req,callback) {
      rp_req = JSON.parse(rp_req)
      let url = URI(config.url)
      .segment("api/v2/broadcasts.json")
      let before = new Date()

      let options = {
        url: url.toString(),
        headers: {
          Authorization: `Token ${config.token}`
        },
        body: rp_req,
        json: true
      }
      request.post(options, (err, res, body) => {
        winston.error(body)
      })
    }
  }

}
