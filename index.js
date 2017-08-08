#!/usr/bin/env node
'use strict'

const express = require('express')
const medUtils = require('openhim-mediator-utils')
const utils = require('./utils')
const winston = require('winston')
const moment = require("moment")
const request = require('request')
const circularJson = require('circular-json')
const URI = require('urijs')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const TImR = require('./timr')
const VIMS = require('./vims')
const OIM = require('./openinfoman')
const async = require('async')
const bodyParser = require('body-parser')
var xmlparser = require('express-xml-bodyparser');

// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config')
const mediatorConfig = require('./config/mediator')

// socket config - large documents can cause machine to max files open
const https = require('https')
const http = require('http')

https.globalAgent.maxSockets = 10
http.globalAgent.maxSockets = 10

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

  function updateTransaction (req,body,orchestrations) {
    const transactionId = req.headers['x-openhim-transactionid']
    var update = {
      'x-mediator-urn': mediatorConfig.urn,
      status: 'Successful',
      response: {
        status: 404,
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

  app.get('/syncImmunizationCoverage', (req, res) => {
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2)
    //process immunization coverage
    //need to put this inside terminology service
    function getDosesMapping (callback) {
      var dosesMapping = []
      dosesMapping.push({'name': 'Dose 0','timrid': '0','vimsid': '0','vimsid1': '1'})
      dosesMapping.push({'name': 'Dose 1','timrid': '1','vimsid': '1','vimsid1': '2'})
      dosesMapping.push({'name': 'Dose 2','timrid': '2','vimsid': '2','vimsid1': '3'})
      dosesMapping.push({'name': 'Dose 3','timrid': '3','vimsid': '3','vimsid1': '4'})
      callback(dosesMapping)
    }
    oim.getVimsFacilities(facilities=>{
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var timrFacilityId = facility.timrFacilityId
        var facilityName = facility.facilityName
        if(vimsFacilityId > 0) {
          winston.info("Getting Periods")
          vims.getPeriod(vimsFacilityId,(periods)=>{
            if(periods.length > 1 ) {
              winston.error("VIMS has returned two DRAFT reports,processng stoped!!!")
              processNextFacility()
            }
            else if(periods.length == 0) {
              winston.error("Skip Processing " + facilityName + ", No Period Found")
              processNextFacility()
            }
            else {
              winston.info("Getting Access Token")
              if(periods.length == 1) {
                timr.getAccessToken('fhir',(err, res, body) => {
                  winston.info("Processing Stock For " + facilityName + ", Period " + periods[0].periodName)
                  var access_token = JSON.parse(body).access_token
                  vims.getImmunDataElmnts ((err,vimsImmDataElmnts) => {
                    async.eachSeries(vimsImmDataElmnts,function(vimsVaccCode,processNextDtElmnt) {
                      getDosesMapping((doses) =>{
                        async.eachOfSeries(doses,function(dose,doseInd,processNextDose) {
                          timr.getImmunizationData(access_token,vimsVaccCode.code,dose,timrFacilityId,periods,(err,values) => {
                            vims.saveImmunizationData(periods,values,vimsVaccCode.code,dose,(err) =>{
                              processNextDose()
                            })
                          })
                        },function() {
                          winston.info("Getting New Data Element")
                          processNextDtElmnt()
                        })
                      })
                    },function() {
                      winston.info("Getting New Facility")
                      processNextFacility()
                    })
                  })
                })
              }
            }
          })
        }
      },function(){
        winston.info('Done!!!')
      })
    })
  }),

  app.get('/syncStock', (req, res) => {
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2)
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

    oim.getVimsFacilities(facilities=>{
      winston.info("Processing Stock Data")
      winston.info("Fetching Facilities")
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var timrFacilityId = facility.timrFacilityId
        var facilityName = facility.facilityName
        if(vimsFacilityId > 0) {
          winston.info("Getting Periods")
          vims.getPeriod(vimsFacilityId,(periods,orchs)=>{
            if (orchs) {
              orchestrations = orchestrations.concat(orchs)
            }


            if(periods.length > 1 ) {
              winston.error("VIMS has returned two DRAFT reports,processng stoped!!!")
              processNextFacility()
            }
            else if(periods.length == 0) {
              winston.error("Skip Processing " + facilityName + ", No Period Found")
              processNextFacility()
            }
            else {
              winston.info("Getting Access Token")
              if(periods.length == 1) {
                timr.getAccessToken('gs1',(err, res, body) => {
                  var access_token = JSON.parse(body).access_token
                  timr.getStockData(access_token,timrFacilityId,periods,(data) =>{
                    timr.extractStockData(data,timrFacilityId,(timrStockData,stockCodes) =>{
                      vims.getItemsDataElmnts ((err,vimsItemsDataElmnts) => {
                          async.eachSeries(vimsItemsDataElmnts,function(vimsItemsDataElmnt,processNextDtElmnt) {
                            winston.info("Processing Stock For " + facilityName +
                                         ", ProductID " + vimsItemsDataElmnt.code +
                                         ", Period " + periods[0].periodName)
                            vims.saveStockData(periods,timrStockData,stockCodes,vimsItemsDataElmnt.code,(res) =>{
                              processNextDtElmnt()
                            })
                          },function(){
                              winston.info("Done Processing " + facilityName)
                              processNextFacility()
                          })
                      })
                    })
                  })
                })
              }
            }
          })
        }
      },function(){
        res.writeHead(200, { 'Content-Type': 'application/json+openhim' })
        res.end(JSON.stringify({
          'x-mediator-urn': mediatorConfig.urn,
          status: 'Successful',
          request: {
            method: req.method,
            headers: req.headers,
            timestamp: req.timestamp,
            path: req.path
          },
          response: {
            status: 200,
            timestamp: new Date()
          },
          orchestrations: orchestrations
        }))
      })
    })
  }),

  app.get('/despatchAdvice',(req,res)=>{
    /*loop through all districts
    Getting stock distribution from DVS (VIMS)
    */
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2)
    oim.getVimsFacilities(facilities=>{
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var facilityName = facility.facilityName
        vims.getDistribution(vimsFacilityId,(despatchAdviceBaseMessage,err)=>{
          if(despatchAdviceBaseMessage){
            winston.info(despatchAdviceBaseMessage)
            timr.getAccessToken('gs1',(err, res, body) => {
              var access_token = JSON.parse(body).access_token
              timr.saveDistribution(despatchAdviceBaseMessage,access_token,(res)=>{
                winston.info(res)
                processNextFacility()
              })
            })
          }
          else {
            winston.error("No Distribution For "+vimsFacilityId)
            processNextFacility()
          }
        })
      },function(){
        //res.send("Done")
      })
    })
  }),

  app.post('/receivingAdvice', (req, res) => {
    req.timestamp = new Date()
    let orchestrations = []
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    //get the distribution

    function getDistribution(vimsToFacilityId,callback) {
      vims.j_spring_security_check((err,header,orchs)=>{
        if(err){
          callback("",err)
        }
        var startDate = moment().startOf('month').format("YYYY-MM-DD")
        var endDate = moment().endOf('month').format("YYYY-MM-DD")
        var url = URI(config.vims.url).segment("vaccine/inventory/distribution/distribution-supervisorid/" + vimsToFacilityId)
        var options = {
          url: url.toString(),
          headers: {
            Cookie:header["set-cookie"]
          }
        }
        let before = new Date()
        request.get(options, (err, res, body) => {
          var distribution = JSON.parse(body).distribution
          if(distribution !== null) {
            orchs = orchs.concat([utils.buildOrchestration('Fetching Distribution', before, 'GET', options.url, options.body, res, body)])
            callback(distribution,err,orchs)
          }
          else {
            orchs = orchs.concat([utils.buildOrchestration('Fetching Distribution', before, 'GET', options.url, options.body, res, body)])
            callback("",err,orchs)
          }
        })
      })
    }

    var distr = req.rawBody
    var ast = XmlReader.parseSync(distr)
    var distributionid = xmlQuery(ast).find("receivingAdvice").children().
                                        find("despatchAdvice").children().
                                        find("entityIdentification").text()
    var shiptoLength = xmlQuery(ast).find("receivingAdvice").children().find("shipTo").children().size()
    var shipto = xmlQuery(ast).find("receivingAdvice").children().find("shipTo").children()
    var toFacilityId = ""
    for(var counter=0;counter<shiptoLength;counter++) {
      if(shipto.eq(counter).attr("additionalPartyIdentificationTypeCode") == "HIE_FRID")
        toFacilityId = shipto.eq(counter).find("additionalPartyIdentification").text()
    }

    var shipfromLength = xmlQuery(ast).find("receivingAdvice").children().find("shipper").children().size()
    var shipfrom = xmlQuery(ast).find("receivingAdvice").children().find("shipper").children()
    var fromFacilityId = ""
    for(var counter=0;counter<shiptoLength;counter++) {
      if(shipfrom.eq(counter).attr("additionalPartyIdentificationTypeCode") == "GIIS_FACID")
        fromFacilityId = shipfrom.eq(counter).find("additionalPartyIdentification").text()
    }

    var vimsToFacilityId = null
    oim.getVimsFacilityId(toFacilityId,vimsFacId=>{
      vimsToFacilityId = vimsFacId
      if(vimsToFacilityId)
      getDistribution(vimsToFacilityId,(distribution,err,orchestrations)=>{
        if(!distribution) {
          var himHeader = res.status(422).send("No Matching Despatch Advice in VIMS")
          var body = "No matching DespatchAdvice in VIMS"
          updateTransaction(req,body,orchestrations)
        }
        if(distribution){
          if(distributionid == distribution.id) {
            distribution.status = "RECEIVED"
            async.eachSeries(distribution.lineItems,function(lineItems,nextlineItems) {
              var lineItemQuantity = 0
              async.eachSeries(lineItems.lots,function(lot,nextLot) {
                var lotId = lot.lotId
                var lotQuantity = lot.quantity

                //find quantity accepted for this lot
                var productsLength = xmlQuery(ast).find("receivingAdvice").children().find("receivingAdviceLogisticUnit").children().size()
                var products = xmlQuery(ast).find("receivingAdvice").children().find("receivingAdviceLogisticUnit").children()
                var quantityAcc = 0
                for(var counter=0;counter<productsLength;counter++){
                  if(products.eq(counter).find("receivingAdviceLineItem").children().
                                          find("transactionalTradeItem").children().
                                          find("additionalTradeItemIdentification").
                                          attr("additionalTradeItemIdentificationTypeCode") == "VIMS_STOCK_ID" && products.eq(counter).find("receivingAdviceLineItem").children().
                                          find("transactionalTradeItem").children().
                                          find("additionalTradeItemIdentification").text() == lotId)
                  quantityAcc = products.eq(counter).find("receivingAdviceLineItem").children().find("quantityAccepted").text()
                }
                //set this lot to quantity Accepted
                lot.quantity = Number(quantityAcc)

                lineItemQuantity = Number(lineItemQuantity) + Number(quantityAcc)
                nextLot()
              },function(){
                lineItems.quantity = lineItemQuantity
                nextlineItems()
              })
            },function(){
              //submit Receiving Advice To VIMS
              vims.sendReceivingAdvice(distribution,(res)=>{

              })
            })
          }
        }
      })
    })
  }),

  app.post('/orderRequest', (req, res) => {
    res.send(200)
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
          const server = app.listen(9000, () => {
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
    const server = app.listen(9000, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info('Listening on 9000...'))
}
