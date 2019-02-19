#!/usr/bin/env node

'use strict'

const express = require('express')
const medUtils = require('openhim-mediator-utils')
const utils = require('./utils')
const winston = require('winston')
const moment = require("moment")
const request = require('request')
const isJSON = require('is-json')
const URI = require('urijs')
const querystring = require('querystring')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const TImR = require('./timr')
const VIMS = require('./vims')
const OIM = require('./openinfoman')
const async = require('async')
const bodyParser = require('body-parser')
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()
var xmlparser = require('express-xml-bodyparser')

const port = 9003
// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config')
const mediatorConfig = require('./config/mediator')

// socket config - large documents can cause machine to max files open
const https = require('https')
const http = require('http')

https.globalAgent.maxSockets = 32
http.globalAgent.maxSockets = 32

// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {
  level: 'info',
  timestamp: true,
  colorize: true
})

//set environment variable so that the mediator can be registered
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */

function setupApp() {
  const app = express()
  app.use(xmlparser())
  var rawBodySaver = function (req, res, buf, encoding) {
    if (buf && buf.length) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  }
  app.use(bodyParser.raw({
    verify: rawBodySaver,
    type: '*/*'
  }));
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.use(bodyParser.json())
  app.get('/stock', (req, res) => {
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims, config.openinfoman)
    const timr = TImR(config.timr, config.oauth2, config.vims)
    let orchestrations = []
    var DVS = ["20220"]

    async.eachSeries(DVS, (district, nextdvs) => {
      winston.info("Processing DVS " + district)
      j_spring_security_check((err, header) => {
        var url = URI(config.vims.url).segment("vaccine/inventory/distribution/get-by-date-range/" + district) + "?date=2018-04-01&endDate=2018-05-17"
        var options = {
          url: url.toString(),
          headers: {
            Cookie: header["set-cookie"]
          }
        }
        let before = new Date()
        request.get(options, (err, res, body) => {
          var distributions = JSON.parse(body).distributions
          if (Object.keys(distributions).length == 0)
            return nextdvs()
          async.eachSeries(distributions, (distr, nextDistr) => {
            distr.status = "PENDING"
            var distribution = JSON.stringify(distr)
            winston.error(distr.toFacilityId)
            if (distr.toFacilityId != "15033")
              return nextDistr()
            vims.convertDistributionToGS1(distribution, orchestrations, (err, despatchAdviceBaseMessage) => {
              if (err) {
                winston.error("An Error occured while trying to convert Distribution From VIMS,stop sending Distribution to TImR")
                return nextDistr()
              }
              if (despatchAdviceBaseMessage == false || despatchAdviceBaseMessage == null || despatchAdviceBaseMessage == undefined) {
                winston.error("Failed to convert VIMS Distribution to GS1")
                return nextDistr()
              }
              winston.info("Done Converting Distribution To GS1")
              winston.info("Getting GS1 Access Token From TImR")
              timr.getAccessToken('gs1', orchestrations, (err, res, body) => {
                winston.info("Received GS1 Access Token From TImR")
                if (err) {
                  winston.error("An error occured while getting access token from TImR")
                  return nextDistr()
                }
                var access_token = JSON.parse(body).access_token
                winston.info("Saving Despatch Advice To TImR")
                timr.saveDistribution(despatchAdviceBaseMessage, access_token, orchestrations, (res) => {
                  winston.info("Saved Despatch Advice To TImR")
                  winston.info(res)
                  var time = moment().format()
                  return nextDistr()
                })
              })
            })
          }, function () {
            return nextdvs()
          })
        })
      })
    }, function () {
      winston.info("Done")
    })

    function j_spring_security_check(callback) {
      var url = URI(config.vims.url).segment('j_spring_security_check')
      var postData = querystring.stringify({
        j_username: config.vims.username,
        j_password: config.vims.password
      });
      var options = {
        url: url.toString(),
        headers: {
          'Content-type': 'application/x-www-form-urlencoded'
        },
        body: postData
      }
      let before = new Date()
      request.post(options, (err, res, body) => {
        callback(err, res.headers)
      })
    }
  })
  return app
}


function start(callback) {
  if (apiConf.register) {
    medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        winston.error('Failed to register this mediator, check your config')
        winston.error(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
        winston.info('Received initial config:', newConfig)
        config = newConfig
        if (err) {
          winston.info('Failed to fetch initial config')
          winston.info(err.stack)
          process.exit(1)
        } else {
          winston.info('Successfully registered mediator!')
          let app = setupApp()
          const server = app.listen(port, () => {
            let configEmitter = medUtils.activateHeartbeat(apiConf.api)
            configEmitter.on('config', (newConfig) => {
              winston.info('Received updated config:', newConfig)
              // set new config for mediator
              config = newConfig
            })
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let app = setupApp()
    const server = app.listen(port, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info('Listening on ' + port + '...'))
}