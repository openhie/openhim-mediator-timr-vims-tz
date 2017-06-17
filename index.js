#!/usr/bin/env node
'use strict'

const express = require('express')
const medUtils = require('openhim-mediator-utils')
const winston = require('winston')
const moment = require("moment")
const TImR = require('./timr')
const VIMS = require('./vims')
const async = require('async')

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

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp () {
  const app = express()

  app.get('/sync', (req, res) => {
    const timr = TImR(config.timr,config.timrOauth2)
    const vims = VIMS(config.vims)
    req.timestamp = new Date()
    let orchestrations = []

    function reportFailure (err, req) {
      res.writeHead(500, { 'Content-Type': 'application/json+openhim' })
      winston.error(err.stack)
      winston.error('Something went wrong, relaying error to OpenHIM-core')
      let response = JSON.stringify({
        'x-mediator-urn': mediatorConfig.urn,
        status: 'Failed',
        request: {
          method: req.method,
          headers: req.headers,
          timestamp: req.timestamp,
          path: req.path
        },
        response: {
          status: 500,
          body: err.stack,
          timestamp: new Date()
        },
        orchestrations: orchestrations
      })
      res.end(response)
    }

    //need to put this inside terminology service
    function getDosesMapping (callback) {
      var dosesMapping = []
      dosesMapping.push({'name': 'Dose 0','timrid': '0','vimsid': '0','vimsid1': '1'})
      dosesMapping.push({'name': 'Dose 1','timrid': '1','vimsid': '1','vimsid1': '2'})
      dosesMapping.push({'name': 'Dose 2','timrid': '2','vimsid': '2','vimsid1': '3'})
      dosesMapping.push({'name': 'Dose 3','timrid': '3','vimsid': '3','vimsid1': '4'})
      callback(dosesMapping)
    }

    /*var vimsFacilityId = 19132 //need to loop through all facilities
    var timrFacilityId = 'urn:uuid:67882F85-DA89-3A79-A7D5-E224859863D6'
    vims.getPeriod(vimsFacilityId,(periods)=>{
      if(periods.length > 0) {
        timr.getStockData(timrFacilityId,(data) =>{
          timr.extractStockData(data,(timrStockData) =>{
            vims.getImmunDataElmnts ((err,vimsImmDataElmnts) => {
              vimsImmDataElmnts.forEach ((vimsVaccCode) => {
                vims.saveStockData(periods,timrStockData,vimsVaccCode.code,(res) =>{

                })
              })
            })
          })
        })
      }
    })*/

    vims.getImmunDataElmnts ((err,vimsImmDataElmnts) => {
      timr.getAccessToken((err, res, body) => {
        var access_token = JSON.parse(body).access_token
        var facilityid = "urn:uuid:EFC948D0-3290-35DE-AE4C-1773C93B987C"//need to loop through all facilities
        vims.getPeriod(19246,(periods)=>{//use fac 19132 (has two per ids) or 14133 (has an error) or 16452 (has one per,index null)
          if(periods.length > 0) {
            async.eachSeries(vimsImmDataElmnts,function(vimsVaccCode,processNextDtElmnt) {
              getDosesMapping((doses) =>{
                async.eachOfSeries(doses,function(dose,doseInd,processNextDose) {
                  timr.getImmunizationData(access_token,vimsVaccCode.code,dose,facilityid,(err,values) => {
                    vims.saveImmunizationData(periods,values,vimsVaccCode.code,dose,(err) =>{
                      processNextDose()
                    })
                  })
                },function() {
                  processNextDtElmnt()
                })
              })
            },function() {
              winston.error('Done!!!')
            })
          }
        })
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
          const server = app.listen(8544, () => {
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
    const server = app.listen(8544, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info('Listening on 8544...'))
}
