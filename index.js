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
const VIMS = require('./vims')
const OIM = require('./openinfoman')
const async = require('async')
const bodyParser = require('body-parser')
var xmlparser = require('express-xml-bodyparser')

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

  app.get('/syncImmunizationCoverage', (req, res) => {
    let orchestrations = []
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2,config.vims)

    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    //process immunization coverage
    //need to put this inside terminology service
    function getDosesMapping (callback) {
      var dosesMapping = []
      dosesMapping.push({'name': 'Dose 0','timrid': '0','vimsid': '0','vimsid1': '1'})
      dosesMapping.push({'name': 'Dose 1','timrid': '1','vimsid': '1','vimsid1': '2'})
      dosesMapping.push({'name': 'Dose 2','timrid': '2','vimsid': '2','vimsid1': '3'})
      dosesMapping.push({'name': 'Dose 3','timrid': '3','vimsid': '3','vimsid1': '4'})
      dosesMapping.push({'name': 'Dose 4','timrid': '4','vimsid': '4','vimsid1': '5'})
      dosesMapping.push({'name': 'Dose 5','timrid': '5','vimsid': '5','vimsid1': '6'})
      callback(dosesMapping)
    }
    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      const promises = []
      for(var fackey in facilities){
        promises.push(new Promise((resolve, reject) => {
          var vimsFacilityId = facilities[fackey].vimsFacilityId
          var timrFacilityId = facilities[fackey].timrFacilityId
          var facilityName = facilities[fackey].facilityName
          if(vimsFacilityId > 0) {
            winston.info("Getting period for " + facilityName)
            vims.getPeriod(vimsFacilityId,orchestrations,(err,period)=>{
              if(err) {
                winston.error(err)
                return resolve()
              }
              winston.info("Done Getting Period")
              if(period.length > 1 ) {
                winston.warn("VIMS has returned two DRAFT reports for " + facilityName + ",processng stoped!!!")
                return resolve()
              }
              else if(period.length == 0) {
                winston.warn("Skip Processing " + facilityName + ", No Period Found")
                return resolve()
              }
              else {
                winston.info("Getting Access Token from TImR")
                if(period.length == 1) {
                  timr.getAccessToken('fhir',orchestrations,(err, res, body) => {
                    if(err) {
                      winston.error("An error occured while getting access token from TImR")
                      return resolve()
                    }
                    winston.info("Done Getting Access Token")
                    winston.info("Processing Coverage For " + facilityName + ", Period " + period[0].periodName)
                    var access_token = JSON.parse(body).access_token
                    winston.info("Getting All VIMS Immunization Data Elements")
                    vims.getValueSets (vimsImmValueSets,(err,vimsImmValueSet) => {
                      winston.info("Done Getting All VIMS Immunization Data Elements")
                      async.eachSeries(vimsImmValueSet,function(vimsVaccCode,processNextDtElmnt) {
                      //const immValPromise
                      //for(var immValSetKey in vimsImmValueSet) {
                        //var vimsVaccCode = vimsImmValueSet[immValSetKey]
                        winston.info("Processing VIMS Data Element With Code " + vimsVaccCode.code)
                        getDosesMapping((doses) =>{
                          async.eachOfSeries(doses,function(dose,doseInd,processNextDose) {
                            timr.getImmunizationData(access_token,vimsVaccCode.code,dose,timrFacilityId,period,orchestrations,(err,values) => {
                              vims.saveImmunizationData(period,values,vimsVaccCode.code,dose,facilityName,orchestrations,(err) =>{
                                return processNextDose()
                              })
                            })
                          },function() {
                            processNextDtElmnt()
                          })
                        })
                      },function() {
                          //before fetching new facility,lets process supplements for this facility first
                          winston.info("Processing Supplements")
                          vims.getValueSets (vimsVitaminValueSets,(err,vimsVitValueSet) => {
                            async.eachSeries(vimsVitValueSet,function(vimsVitCode,processNextDtElmnt) {
                              winston.info("Processing Supplement Id "+vimsVitCode.code)
                              timr.getVitaminData(access_token,vimsVitCode.code,timrFacilityId,period,orchestrations,(err,values) => {
                                vims.saveVitaminData(period,values,vimsVitCode.code,orchestrations,(err) =>{
                                  winston.info("Done processing vacc coverage for " + facilityName)
                                  return resolve()
                                })
                              })
                            })
                          })
                      })
                    })
                  })
                }
              }
            })
          }
        }))
      }

      Promise.all(promises).then(() => {
        winston.info('Done Synchronizing Immunization Coverage!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/syncAdverseEffects', (req, res) => {
    let orchestrations = []
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2,config.vims)

    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var timrFacilityId = facility.timrFacilityId
        var facilityName = facility.facilityName
        if(vimsFacilityId > 0) {
          winston.info("Getting period")
          vims.getPeriod(vimsFacilityId,orchestrations,(err,period)=>{
            if(err) {
              winston.error(err)
              return processNextFacility()
            }
            if(period.length > 1 ) {
              winston.warn("VIMS has returned two DRAFT reports for " + facilityName + ",processng stoped!!!")
              return processNextFacility()
            }
            else if(period.length == 0) {
              winston.warn("Skip Processing " + facilityName + ", No Period Found")
              return processNextFacility()
            }
            else {
              winston.info("Getting Access Token from TImR")
              if(period.length == 1) {
                timr.getAccessToken('fhir',orchestrations,(err, res, body) => {
                  if(err) {
                    winston.error("An error occured while getting access token from TImR")
                    return processNextFacility()
                  }
                  winston.info("Received Access Token")
                  winston.info("Processing Adverse Event For " + facilityName + ", Period " + period[0].periodName)
                  var access_token = JSON.parse(body).access_token
                  vims.getValueSets (vimsImmValueSets,(err,vimsImmValueSet) => {
                    async.eachSeries(vimsImmValueSet,function(vimsVaccCode,processNextValSet) {
                      winston.info("Getting Adverse Effect From TImR For " + vimsVaccCode.code)
                      timr.getAdverseEffectData(access_token,vimsVaccCode.code,timrFacilityId,period,orchestrations,(err,values) => {
                        if(values.length == 0) {
                          winston.info("No Adverse Effect Found For " + facilityName + " Vaccine Code " + vimsVaccCode.code)
                          return processNextValSet()
                        }
                        vims.saveAdverseEffectData(period,values,vimsVaccCode.code,orchestrations,(err) =>{
                          processNextValSet()
                        })
                      })
                    },function() {
                        //before fetching new facility,lets process vitaminA for this facility first
                        winston.info("Done Processing Adverse Event For " + facilityName + ", Period " + period[0].periodName)
                        processNextFacility()
                    })
                  })
                })
              }
            }
          })
        }
      },function(){
        winston.info('Done Synchronizing Immunization Coverage!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/syncDiseases', (req, res) => {
    let orchestrations = []
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2,config.vims)

    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")

    winston.info("Processing Disease Data")
    winston.info("Fetching Facilities")
    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var timrFacilityId = facility.timrFacilityId
        var facilityName = facility.facilityName
        if(vimsFacilityId > 0) {
          winston.info("Getting period")
          vims.getPeriod(vimsFacilityId,orchestrations,(err,period)=>{
            if(err) {
              winston.error(err)
              return processNextFacility()
            }
            if(period.length > 1 ) {
              winston.warn("VIMS has returned two DRAFT reports,processng stoped!!!")
              return processNextFacility()
            }
            else if(period.length == 0) {
              winston.warn("Skip Processing " + facilityName + ", No Period Found")
              return processNextFacility()
            }
            else {
              winston.info("Getting Access Token")
              if(period.length == 1) {
                timr.getAccessToken('fhir',orchestrations,(err, res, body) => {
                  if(err) {
                    winston.error("An error occured while getting access token from TImR")
                    return processNextFacility()
                  }
                  winston.info("Received Access Token")
                  var access_token = JSON.parse(body).access_token
                  vims.getValueSets (vimsDiseaseValueSet,(err,vimsDiseaseValSet) => {
                    timr.getDiseaseData(access_token,vimsDiseaseValSet,timrFacilityId,period,orchestrations,(err,values) => {
                      vims.saveDiseaseData(period,values,orchestrations,(err) =>{
                        winston.info("Done Updating diseaseLineItems In VIMS For " + facilityName)
                        processNextFacility()
                      })
                    })
                  })
                })
              }
            }
          })
        }
      },function(){
        winston.info('Done Synchronizing Disease Data!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/syncStock', (req, res) => {
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    const timr = TImR(config.timr,config.oauth2)
    req.timestamp = new Date()
    let orchestrations = []

    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")

    winston.info("Processing Stock Data")
    winston.info("Fetching Facilities")
    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      winston.info("Done Fetching Facility Data")
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var timrFacilityId = facility.timrFacilityId
        var facilityName = facility.facilityName
        if(vimsFacilityId > 0) {
          winston.info("Getting period")
          vims.getPeriod(vimsFacilityId,orchestrations,(err,period)=>{
            if(err) {
              winston.error(err)
              return processNextFacility()
            }
            if(period.length > 1 ) {
              winston.warn("VIMS has returned two DRAFT reports,processng stoped!!!")
              return processNextFacility()
            }
            else if(period.length == 0) {
              winston.warn("Skip Processing " + facilityName + ", No Period Found")
              return processNextFacility()
            }
            else {
              winston.info("Getting Access Token")
              if(period.length == 1) {
                timr.getAccessToken('gs1',orchestrations,(err, res, body) => {
                  if(err) {
                    winston.error("An error occured while getting access token from TImR")
                    return processNextFacility()
                  }
                  winston.info("Received Access Token")
                  var access_token = JSON.parse(body).access_token
                  winston.info("Fetching TImR Stock Data")
                  winston.info("Processing Stock For " + facilityName + ", Period " + period[0].periodName)
                  timr.getStockData(access_token,timrFacilityId,period,orchestrations,(data) =>{
                    winston.info("\tDone Fetching TImR Stock Data")
                    winston.info("\tExtracting TImR Stock Data")
                    timr.extractStockData(data,timrFacilityId,(timrStockData,stockCodes) =>{
                      winston.info("\tDone Extracting TImR Stock Data")
                      winston.info("\tSending Stock Data In VIMS " + JSON.stringify(timrStockData))
                      vims.getValueSets (vimsItemsValueSets,(err,vimsItemsValSet) => {
                        async.eachSeries(vimsItemsValSet,function(vimsItemsDataElmnt,processNextDtElmnt) {
                          winston.info("\tProcessing ProductID " + vimsItemsDataElmnt.code)
                          vims.saveStockData(period,timrStockData,stockCodes,vimsItemsDataElmnt.code,orchestrations,(res) =>{
                            processNextDtElmnt()
                          })
                        },function(){
                            winston.info("\tDone Processing " + facilityName)
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
        winston.info('Done Synchronizing Stock Data!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/despatchAdviceIL',(req,res)=>{
    /*loop through all districts
    Getting stock distribution from DVS (VIMS)
    */
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims,config.openinfoman)
    const timr = TImR(config.timr,config.oauth2)
    let orchestrations = []

    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")

    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var facilityName = facility.facilityName
        vims.checkDistribution(vimsFacilityId,orchestrations,(err,distribution)=>{
          if(err) {
            winston.error("An error occured while checking distribution for " + facilityName)
            return processNextFacility()
          }
          if(distribution == false || distribution == null || distribution == undefined) {
            winston.info("No Distribution For " + facilityName)
            return processNextFacility()
          }
          winston.info("Now Converting Distribution To GS1")
          distribution = JSON.stringify(distribution)
          vims.convertDistributionToGS1(distribution,orchestrations,(err,despatchAdviceBaseMessage)=>{
            if(err) {
              winston.error("An Error occured while trying to convert Distribution From VIMS,stop sending Distribution to TImR")
              return processNextFacility()
            }
            if(despatchAdviceBaseMessage == false || despatchAdviceBaseMessage == null || despatchAdviceBaseMessage == undefined) {
              winston.error("Failed to convert VIMS Distribution to GS1")
              return processNextFacility()
            }
            winston.info("Done Converting Distribution To GS1")
            winston.info("Getting GS1 Access Token From TImR")
            timr.getAccessToken('gs1',orchestrations,(err, res, body) => {
              winston.info("Received GS1 Access Token From TImR")
              if(err) {
                winston.error("An error occured while getting access token from TImR")
                return processNextFacility()
              }
              var access_token = JSON.parse(body).access_token
              winston.info("Saving Despatch Advice To TImR")
              timr.saveDistribution(despatchAdviceBaseMessage,access_token,orchestrations,(res)=>{
                winston.info("Saved Despatch Advice To TImR")
                winston.info(res)
                return processNextFacility()
              })
            })
          })
        })
      },function(){
        winston.info('Done Getting Despatch Advice!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/syncColdChain',(req,res)=>{
    let orchestrations = []
    const timr = TImR(config.timr,config.oauth2,config.vims,config.openinfoman)
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    timr.getAccessToken('fhir',orchestrations,(err, res, body) => {
      if(err) {
        winston.error("An error occured while getting access token from TImR")
        return
      }
      var access_token = JSON.parse(body).access_token
      winston.info("Processing Cold Chain Data")
      timr.processColdChain(access_token,'',orchestrations,(err,res)=>{
        winston.info("Done Processing Cold Chain")
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/initializeReport',(req,res)=>{
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims,config.openinfoman)
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")

    let orchestrations = []
    oim.getVimsFacilities(orchestrations,(err,facilities)=>{
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      async.eachSeries(facilities,function(facility,processNextFacility){
        var vimsFacilityId = facility.vimsFacilityId
        var facilityName = facility.facilityName
        //var vimsFacilityId = 19630
        winston.info('Trying To Initilize Report For ' + facilityName)
        vims.getAllPeriods(vimsFacilityId,orchestrations,(err,body)=>{
          if (err) {
            return processNextFacility()
          }
          var periods = []
          if(body.indexOf('error') == -1) {
            body = JSON.parse(body)
            if(body.hasOwnProperty("periods") && body.periods.length < 1)
            return processNextFacility()
            else if(!body.hasOwnProperty("periods"))
            return processNextFacility()
            body.periods.forEach ((period,index)=>{
              if(period.id == null && period.status == null){
                //lets initialize only one report on index 0
                if(index == 0)
                vims.initializeReport(vimsFacilityId,period.periodId,orchestrations,(err,body)=>{
                  if(err) {
                    winston.error(err)
                  }
                  winston.info("Report for " + period.periodName + " Facility " + facilityName + " Initialized")
                })
              }
              if(index == body.periods.length-1) {
                return processNextFacility()
              }
            })
          }
          else {
            return processNextFacility()
          }
        })
      },function(){
        winston.info('Done Initilizing Reports To Facilities!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.post('/despatchAdviceVims',(req,res)=>{
    /*loop through all districts
    Getting stock distribution from DVS (VIMS)
    */
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    winston.info("Received Despactch Advise From VIMS")
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims,config.openinfoman)
    const timr = TImR(config.timr,config.oauth2)
    let orchestrations = []

    updateTransaction (req,"Still Processing","Processing","200","")
    var distribution = req.rawBody
    vims.convertDistributionToGS1(distribution,orchestrations,(err,despatchAdviceBaseMessage)=>{
      if(err) {
        winston.error("An Error occured while trying to convert Distribution From VIMS,stop sending Distribution to TImR")
        updateTransaction(req,"","Completed","200",orchestrations)
        return
      }
      if(despatchAdviceBaseMessage == false) {
        winston.info("Failed to convert VIMS Distribution to GS1")
        updateTransaction(req,"","Completed","200",orchestrations)
        return
      }
      timr.getAccessToken('gs1',orchestrations,(err, res, body) => {
        if(err) {
          winston.error("An error occured while getting access token from TImR")
          updateTransaction(req,"","Completed","200",orchestrations)
          return
        }
        winston.info("Received GS1 Access Token From TImR")
        var access_token = JSON.parse(body).access_token
        winston.info("Saving Despatch Advice To TImR")
        timr.saveDistribution(despatchAdviceBaseMessage,access_token,orchestrations,(res)=>{
          winston.info("Saved Despatch Advice To TImR")
          winston.info(res)
          updateTransaction(req,"","Successful","200",orchestrations)
          orchestrations = []
        })
      })
    })
  }),

  app.post('/receivingAdvice', (req, res) => {
    req.timestamp = new Date()
    let orchestrations = []
    const oim = OIM(config.openinfoman)
    const vims = VIMS(config.vims)
    //get the distribution

    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    winston.info("Received Receiving Advice From TImR")

    function getDistributionById(distributionId,orchestrations,callback) {
      vims.j_spring_security_check(orchestrations,(err,header)=>{
        if(err){
          return callback("",err)
        }
        var startDate = moment().startOf('month').format("YYYY-MM-DD")
        var endDate = moment().endOf('month').format("YYYY-MM-DD")
        var url = URI(config.vims.url).segment("vaccine/orderRequisition/sendNotification/" + distributionId)
        var options = {
          url: url.toString(),
          headers: {
            Cookie:header["set-cookie"]
          }
        }
        let before = new Date()
        request.get(options, (err, res, body) => {
          orchestrations.push(utils.buildOrchestration('Fetching Distribution', before, 'GET', options.url, JSON.stringify(options.headers), res, body))
          var distribution = JSON.parse(body).message
          if(distribution != null || distribution != "" || distribution != undefined) {
            return callback(distribution,err)
          }
          else {
            return callback("",err)
          }
        })
      })
    }

    function getDistributionByFacilityId(vimsToFacilityId,timr_distributionId,orchestrations,callback) {
      vims.j_spring_security_check(orchestrations,(err,header)=>{
        if(err){
          return callback("",err)
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
          orchestrations.push(utils.buildOrchestration('Fetching Distribution', before, 'GET', options.url, JSON.stringify(options.headers), res, body))
          if(isJSON(body)) {
            var distribution = JSON.parse(body).distribution
          }
          else {
            var distribution = null
          }
          if(distribution != null && distribution != "" && distribution != undefined) {
            //in case we dont get the distribution id we expected then try fetching distr by id
            if(timr_distributionId != distribution.id) {
              winston.info("VIMS Distribution ID " + distribution.id + " Mismatch distribution ID " + timr_distributionId + ",that we are looking,trying fetching by distribution ID")
              getDistributionById(timr_distributionId,orchestrations,(distribution,err)=>{
                return callback(distribution,err)
              })
            }
            else
            return callback(distribution,err)
          }
          else {
            //in case we dont get any distribution then may be lets try fetching distr by id
            winston.info("No distribution received from VIMS,try fetching by distribution ID")
            getDistributionById(timr_distributionId,orchestrations,(distribution,err)=>{
              return callback(distribution,err)
            })
          }
        })
      })
    }

    var distr = req.rawBody
    if(distr == "" || distr == null || distr == undefined) {
      winston.warn("TImR has sent empty receiving Advice,stop processing")
      return updateTransaction (req,"TImR has sent empty receiving Advice","Completed","200","")
    }

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

    if(toFacilityId == "" || toFacilityId == null || toFacilityId == undefined) {
      winston.error("Empty Destination Facility found in TImR Receiving Advice,stop processing")
      return updateTransaction (req,"Empty Destination Facility found in TImR Receiving Advice","Completed","200","")
    }

    var shipfromLength = xmlQuery(ast).find("receivingAdvice").children().find("shipper").children().size()
    var shipfrom = xmlQuery(ast).find("receivingAdvice").children().find("shipper").children()
    var fromFacilityId = ""
    for(var counter=0;counter<shipfromLength;counter++) {
      if(shipfrom.eq(counter).attr("additionalPartyIdentificationTypeCode") == "HIE_FRID")
        fromFacilityId = shipfrom.eq(counter).find("additionalPartyIdentification").text()
    }

    if(fromFacilityId == "" || fromFacilityId == null || fromFacilityId == undefined) {
      winston.error("Empty Source Facility found in TImR Receiving Advice,stop processing")
      return updateTransaction (req,"Empty Source Facility found in TImR Receiving Advice","Completed","200","")
    }

    var vimsToFacilityId = null
    winston.info("Getting VIMS facility ID")
    oim.getVimsFacilityId(toFacilityId,orchestrations,(err,vimsFacId)=>{
      if(err) {
        winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
        return
      }
      if(vimsFacId == "" || vimsFacId == null || vimsFacId == undefined) {
        winston.error("No matching VIMS Facility ID for " + toFacilityId + ",Stop Processing")
        return updateTransaction (req,"No matching VIMS Facility ID for " + toFacilityId,"Completed","200","")
      }
      winston.info("Received VIMS facility ID")
      vimsToFacilityId = vimsFacId
      winston.info("Getting Distribution From VIMS For Receiving Advice")
      if(vimsToFacilityId)
      getDistributionByFacilityId(vimsToFacilityId,distributionid,orchestrations,(distribution,err)=>{
        winston.info("Received Distribution From VIMS For Receiving Advice")
        if(!distribution) {
          winston.warn('No matching DespatchAdvice in VIMS!!!')
          updateTransaction(req,"No matching DespatchAdvice in VIMS!!!","Completed","200",orchestrations)
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
              winston.info("Sending Receiving Advice To VIMS")
              vims.sendReceivingAdvice(distribution,orchestrations,(res)=>{
                winston.info(res)
                winston.info('Receiving Advice Submitted To VIMS!!!')
                updateTransaction(req,"","Successful","200",orchestrations)
                orchestrations = []
              })
            })
          }
          else {
            winston.error("VIMS has responded with Despatch Advice ID " + distribution.id + " Which Does Not Match TImR Receiving Advice ID " + distributionid)
            return updateTransaction(req,"VIMS has responded with Despatch Advice ID " + distribution.id + " Which Does Not Match TImR Receiving Advice ID " + distributionid,"Completed","200",orchestrations)
            orchestrations = []
          }
        }
      })
    })
  }),

  app.post('/orderRequest', (req, res) => {
    res.end()
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
            configEmitter.on('error',(error) => {
            	winston.error(error)
              winston.error("an error occured while trying to activate heartbeat")
            })
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
