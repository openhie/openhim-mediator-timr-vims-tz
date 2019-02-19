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
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const TImR = require('./timr')
const VIMS = require('./vims_force_pod')
const OIM = require('./openinfoman')
const async = require('async')
const bodyParser = require('body-parser')
const SENDEMAIL = require('./send_email')
const send_email = SENDEMAIL()
var xmlparser = require('express-xml-bodyparser')
const port  = 8888

const vimsDiseaseValueSet = require('./terminologies/vims-diseases-valuesets.json')
const vimsImmValueSets = require('./terminologies/vims-immunization-valuesets.json')
const vimsVitaminValueSets = require('./terminologies/vims-vitamin-valuesets.json')
const vimsItemsValueSets = require('./terminologies/vims-items-valuesets.json')

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
winston.add(winston.transports.Console, {level: 'info', timestamp: true, colorize: true})

//set environment variable so that the mediator can be registered
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp () {
  const app = express()
  app.use(xmlparser())
  var rawBodySaver = function (req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}
  app.use(bodyParser.raw({ verify: rawBodySaver, type: '*/*' }));
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.use(bodyParser.json())

  function getOpenHimTransationData(transactionId,callback) {
    medUtils.authenticate(apiConf.api, function (err) {
      if (err) {
        return winston.error(err.stack);
      }
      var headers = medUtils.genAuthHeaders(apiConf.api)
      var options = {
        url: apiConf.api.apiURL + '/transactions/' + transactionId,
        headers: headers
      }
      request.get(options, function(err, apiRes, body) {
        if (err) {
          return winston.error(err);
        }
        if (apiRes.statusCode !== 200) {
          return winston.error(new Error('Unable to get transaction data from OpenHIM-core, received status code ' + apiRes.statusCode + ' with body ' + body).stack);
        }
        callback(body)
      })

    })
  }

  function updateTransaction (req,body,statatusText,statusCode,orchestrations) {
    const transactionId = req.headers['x-openhim-transactionid']
    var update = {
      'x-mediator-urn': mediatorConfig.urn,
      status: statatusText,
      response: {
        status: statusCode,
        timestamp: new Date(),
        body: body
      },
      orchestrations: orchestrations
    }
    medUtils.authenticate(apiConf.api, function (err) {
      if (err) {
        return winston.error(err.stack);
      }
      var headers = medUtils.genAuthHeaders(apiConf.api)
      var options = {
        url: apiConf.api.apiURL + '/transactions/' + transactionId,
        headers: headers,
        json:update
      }

      request.put(options, function(err, apiRes, body) {
        if (err) {
          return winston.error(err);
        }
        if (apiRes.statusCode !== 200) {
          return winston.error(new Error('Unable to save updated transaction to OpenHIM-core, received status code ' + apiRes.statusCode + ' with body ' + body).stack);
        }
        winston.info('Successfully updated transaction with id ' + transactionId);
      });
    })
  }

  app.get('/despatchAdviceIL',(req,res)=>{
    /*loop through all districts
    Getting stock distribution from DVS (VIMS)
    */
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims,config.openinfoman)
    const timr = TImR(config.timr,config.oauth2)
    let orchestrations = []

    res.end()
    //updateTransaction (req,"Still Processing","Processing","200","")
    winston.info("getting openinfoman facilities")
    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      winston.info("Done receiving openinfoman facilities")
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var facilityName = facility.facilityName
        vims.checkDistribution(vimsFacilityId,orchestrations,(err,distribution,receivingAdvice)=>{
          if(err) {
            winston.error("An error occured while checking distribution for " + facilityName)
            return processNextFacility()
          }
          if(distribution == false || distribution == null || distribution == undefined) {
            winston.info("No Distribution For " + facilityName)
            return processNextFacility()
          } else {
		        winston.info("Found distribution for " + facilityName)
          }
          winston.info("Now Converting Distribution To GS1")
          distribution = JSON.stringify(distribution)
          vims.convertDistributionToGS1(distribution, orchestrations, (err, despatchAdviceBaseMessage, markReceived) => {
            if(err) {
              winston.error("An Error occured while trying to convert Distribution From VIMS,stop sending Distribution to TImR")
              if (markReceived) {
                winston.error("Sending Receiving Advice")
                vims.sendReceivingAdvice(receivingAdvice, orchestrations, (res) => {
                  winston.info(res)
                  winston.info('Receiving Advice Submitted To VIMS!!!')
                  orchestrations = []
                  return processNextFacility()
                })
              } else {
                return processNextFacility()
              }
            } else if(despatchAdviceBaseMessage == false || despatchAdviceBaseMessage == null || despatchAdviceBaseMessage == undefined) {
              winston.error("Failed to convert VIMS Distribution to GS1")
              return processNextFacility()
            } else {
              winston.info("Done Converting Distribution To GS1")
              winston.info("Getting GS1 Access Token From TImR")
              timr.getAccessToken('gs1', orchestrations, (err, res, body) => {
                winston.info("Received GS1 Access Token From TImR")
                if (err) {
                  winston.error("An error occured while getting access token from TImR")
                  return processNextFacility()
                }
                var access_token = JSON.parse(body).access_token
                winston.info("Saving Despatch Advice To TImR")
                timr.saveDistribution(despatchAdviceBaseMessage, access_token, orchestrations, (res) => {
                  if (res) {
                    winston.error("An error occured while saving despatch advice to TImR")
                    winston.warn(distribution)
                    winston.warn(despatchAdviceBaseMessage)
                    winston.error(res)
                  } else {
                    winston.info("Despatch Advice Saved To TImR Successfully")
                  }
                  var time = moment().format()
                  if (facility.multiplevimsid == true)
                    send_email.send("Multiple Matching", "TImR ID " + facility.timrFacilityId + " " + time, () => {

                    })
                  if (res == "" && facility.multiplevimsid != true) {
                    winston.error("Sending Receiving Advice")
                    vims.sendReceivingAdvice(receivingAdvice, orchestrations, (res) => {
                      winston.info(res)
                      winston.info('Receiving Advice Submitted To VIMS!!!')
                      orchestrations = []
                      return processNextFacility()
                    })
                  } else
                    return processNextFacility()

                })
              })
            }
          })
        })
      },function(){
        winston.info('Done Getting Despatch Advice!!!')
        //updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  })

  return app
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start (callback) {
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
