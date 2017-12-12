'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require('moment')
const async = require('async')
const querystring = require('querystring')
const util = require('util')
const utils = require('./utils')
const OIM = require('./openinfoman')
const fs = require('fs')
const isJSON = require('is-json')
const timrVimsItems = require('./terminologies/timr-vims-items-conceptmap.json')
module.exports = function (vimscnf,oimcnf) {
  const vimsconfig = vimscnf
  const oimconfig = oimcnf
  const oim = OIM(oimcnf)

  function saveSessionsData(report,data) {
    report.report.plannedOutreachImmunizationSessions = data[periodDate].outreachPlan
    report.report.outreachImmunizationSessions = data[periodDate].outreach
    report.report.outreachImmunizationSessionsCanceled = data[periodDate].outreachCancel
    report.report.fixedImmunizationSessions = data[periodDate].sessions
    var sessionsUpdatedReport = {
                                  "id":report.report.id,
                                  "facilityId":report.report.facilityId,
                                  "periodId":report.report.periodId,
                                  "plannedOutreachImmunizationSessions":report.report.plannedOutreachImmunizationSessions,
                                  "outreachImmunizationSessions":report.report.outreachImmunizationSessions,
                                  "outreachImmunizationSessionsCanceled":report.report.outreachImmunizationSessionsCanceled,
                                  "fixedImmunizationSessions":report.report.fixedImmunizationSessions
                                }
    this.saveVIMSReport (sessionsUpdatedReport,"Sending Sessions Data",orchestrations,(err,res,body)=>{
      if(err) {
        winston.error(err)
        return callback(err)
      }
      else
      return callback(err,res)
    })
  }
  
  return {
    j_spring_security_check: function(orchestrations,callback) {
      var url = URI(vimsconfig.url).segment('j_spring_security_check')
      var postData = querystring.stringify({
        j_username: vimsconfig.username,
        j_password: vimsconfig.password
      });
      var options = {
        url: url.toString(),
        headers: {
          'Content-type': 'application/x-www-form-urlencoded'
        },
        body:postData
      }
      let before = new Date()
      request.post(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Spring Authentication', before, 'POST', options.url, postData, res, JSON.stringify(res.headers) ))
        callback(err,res.headers)
      })
    },

    initializeReport: function(vimsFacId,periodId,orchestrations,callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/initialize/'+vimsFacId+'/82/'+periodId)
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }
      let before = new Date()
      request.get(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Initializing report', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          return callback(err)
        }
        else
        return callback(false,body)
      })
    },

    getAllPeriods: function(vimsFacId,orchestrations,callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/periods/'+vimsFacId+'/82')
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }
      let before = new Date()
      request.get(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Get VIMS Facility Period', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          return callback(err)
        }
        else
        return callback(false,body)
      })
    },

    getPeriod: function(vimsFacId,orchestrations,callback) {
      this.getAllPeriods(vimsFacId,orchestrations,(err,body)=>{
        if (err) {
          return callback(err)
        }
        var periods = []
        if(body.indexOf('error') == -1) {
          body = JSON.parse(body)
          if(body.hasOwnProperty("periods") && body.periods.length < 1)
          return callback(err,periods)
          else if(!body.hasOwnProperty("periods"))
          return callback(periods)
          body.periods.forEach ((period,index)=>{
            var systemMonth = moment(period.periodName, 'MMM YYYY','en').format('MM')
            var prevMonth = moment().subtract(1,'month').format('MM')
            if(period.id > 0 && (period.status == "DRAFT" || period.status == "REJECTED"))
            periods.push({'id':period.id,'periodName':period.periodName})
            if(index == body.periods.length-1) {
              return callback(err,periods)
            }
          })
        }
        else {
          return callback(err,periods)
        }
      })
    },

    getValueSets: function (valueSetName,callback) {
      var concept = valueSetName.compose.include[0].concept
      var valueSets = []
      async.eachSeries(concept,(code,nxtConcept)=>{
        valueSets.push({'code':code.code})
        nxtConcept()
      },function(){
        callback('',valueSets)
      })
    },

    getTimrItemCode: function(vimsItemCode,callback) {
      timrVimsItems.group.forEach((groups) => {
        groups.element.forEach((element)=>{
          if(element.code == vimsItemCode) {
            element.target.forEach((target) => {
              callback(target.code)
            })
          }
        })
      })
    },

    getReport: function (id,orchestrations,callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/get/'+id+'.json')
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }

      let before = new Date()
      request.get(options, (err, res, body) => {
        if(!isJSON(body)) {
          winston.error("Invalid Report Returned By VIMS,stop processing")
          return callback(true,false)
        }
        orchestrations.push(utils.buildOrchestration('Get VIMS Report', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          return callback(err)
        }
        else
        return callback(err,JSON.parse(body))
      })
    },

    saveVIMSReport: function(updatedReport,name,orchestrations,callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/save')
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth
        },
        json:updatedReport
      }
      let before = new Date()
      request.put(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Updating VIMS ' + name, before, 'PUT', url.toString(), updatedReport, res, JSON.stringify(body)))
        if (err) {
          winston.error(err)
          return callback(err,res,body)
        }
        else
        return callback(err,res,body)
      })
    },

    saveImmunizationData: function (period,values,vimsVaccCode,dose,orchestrations,callback) {
      if(values == "" || values == undefined || values == null) {
        winston.error("Empty data Submitted,skip processing data of value "+ JSON.stringify(values))
        return callback()
      }
      if( !values.hasOwnProperty("regularMale") ||
          !values.hasOwnProperty("regularFemale") ||
          !values.hasOwnProperty("outreachMale") ||
          !values.hasOwnProperty("outreachFemale")
        ) {
          winston.error("Invalid data Submitted,ignoring processing data "+ JSON.stringify(values))
          return callback()
        }
      if( values.regularMale === "" || values.regularMale === undefined || values.regularMale === null ||
          values.regularFemale === "" || values.regularFemale === undefined || values.regularFemale === null ||
          values.outreachMale === "" || values.outreachMale === undefined || values.outreachMale === null ||
          values.outreachFemale === "" || values.outreachFemale === undefined || values.outreachFemale === null
        ) {
          winston.error("One of the required data is empty,ignoring processing data "+ JSON.stringify(values))
          return callback()
        }
      period.forEach ((period) => {
        var periodId = period.id
        if(vimsVaccCode == '2413')
        var doseid = dose.vimsid1
        else if(vimsVaccCode == '2412') {
          //VIMS has dose 1 only for BCG
          var doseid = 1
        }
        else
        var doseid = dose.vimsid
        this.getReport (periodId,orchestrations,(err,report) => {
          if(err || !report) {
            return callback()
          }
          var totalCoveLine = report.report.coverageLineItems.length
          var found = false
          winston.info('Processing Vacc Code ' + vimsVaccCode + ' ' + dose.name + JSON.stringify(values))
          report.report.coverageLineItems.forEach((coverageLineItems,index) =>{
            if(coverageLineItems.productId == vimsVaccCode && coverageLineItems.doseId == doseid) {
              found = true
              totalCoveLine--
              report.report.coverageLineItems[index].regularMale = values.regularMale
              report.report.coverageLineItems[index].regularFemale = values.regularFemale
              report.report.coverageLineItems[index].outreachMale = values.outreachMale
              report.report.coverageLineItems[index].outreachFemale = values.outreachFemale
              var updatedReport = {
                                    "id":report.report.id,
                                    "facilityId":report.report.facilityId,
                                    "periodId":report.report.periodId,
                                    "coverageLineItems":[report.report.coverageLineItems[index]]
                                  }
              this.saveVIMSReport(updatedReport,"Immunization Coverage",orchestrations,(err,res,body)=>{
                if (err) {
                  winston.error(err)
                  return callback(err)
                }
                else
                return callback()
              })
            }
            else {
              totalCoveLine--
            }
            if(totalCoveLine == 0 && found == false) {
            callback('')
            }
          })

        })
      })
    },

    extractValuesFromAgeGroup: function (values,ageGroupID,callback) {
      var mergedValues = []
      async.eachSeries(values,(value,nxtValue)=>{
        if(Object.keys(value)[0] == ageGroupID) {
          if(mergedValues.length == 0)
          mergedValues.push({[value[ageGroupID].gender]: value[ageGroupID].value})
          else
          mergedValues[(mergedValues.length-1)][value[ageGroupID].gender] = value[ageGroupID].value
          nxtValue()
        }
        else
          nxtValue()
      },function(){
          return callback(mergedValues)
      })
    },

    saveVitaminData: function (period,values,vimsVitCode,orchestrations,callback) {
      async.eachSeries(period,(period,nextPeriod)=>{
        var periodId = period.id
        this.getReport (periodId,orchestrations,(err,report) => {
          if(err || !report) {
            return callback()
          }
          winston.info('Processing Vitamin Code ' + vimsVitCode + JSON.stringify(values))
          async.eachOfSeries(report.report.vitaminSupplementationLineItems,(vitaminSupplementationLineItems,index,nxtSupplmnt)=>{
            if(report.report.vitaminSupplementationLineItems[index].vaccineVitaminId == vimsVitCode) {
              var ageGroupID = report.report.vitaminSupplementationLineItems[index].vitaminAgeGroupId
              this.extractValuesFromAgeGroup(values,ageGroupID,(mergedValues)=>{
                var maleValue = mergedValues[0].maleValue
                var femaleValue = mergedValues[0].femaleValue
                report.report.vitaminSupplementationLineItems[index].maleValue = maleValue
                report.report.vitaminSupplementationLineItems[index].femaleValue = femaleValue
                var updatedReport = {
                                      "id":report.report.id,
                                      "facilityId":report.report.facilityId,
                                      "periodId":report.report.periodId,
                                      "vitaminSupplementationLineItems":[report.report.vitaminSupplementationLineItems[index]]
                                    }
                this.saveVIMSReport(updatedReport,"Supplements",orchestrations,(err,res,body)=>{
                  if (err) {
                    winston.error(err)
                  }
                  nxtSupplmnt()
                })
              })
            }
            else
              nxtSupplmnt()
          },function(){
            nextPeriod()
          })
        })
      },function(){
          winston.info("Done Processing "+vimsVitCode)
          return callback()
      })
    },

    saveAdverseEffectData: function (period,values,vimsVaccCode,orchestrations,callback) {
      var me = this
      async.eachSeries(period,(period,nextPeriod)=>{
        var periodId = period.id
        this.getReport (periodId,orchestrations,(err,report) => {
          if(err || !report) {
            return callback()
          }
          winston.info('Adding To VIMS AdverseEvent Details '+ JSON.stringify(values))
          //if no adverse effect reported
          if(!report.report.adverseEffectLineItems.hasOwnProperty(0)) {
            async.eachSeries(values,(value,nxtValue)=>{
              if(value.value > 0) {
                var date = value.date
                var value = value.value
                var updatedReport = {
                                      "id":report.report.id,
                                      "facilityId":report.report.facilityId,
                                      "periodId":report.report.periodId,
                                      "adverseEffectLineItems": [{
                                                                  "productId": vimsVaccCode,
                                                                  "date": date,
                                                                  "cases": value,
                                                                  "batch": "",
                                                                  "isInvestigated": true
                                                                }]
                                    }
                this.saveVIMSReport(updatedReport,"Adverse Effect",orchestrations,(err,res,body)=>{
                  if (err) {
                    winston.error(err)
                    return nxtValue()
                  }
                  else
                  nxtValue()
                })
              }
              else{
                nxtValue()
              }
            },function(){
                nextPeriod()
            })
          }
          //if there is adverse effect reported
          else {
            async.eachSeries(values,(value,nxtValue)=>{
              //makesure we dont update Adverse Effect associated with multiple products
              var found = false
              async.eachOfSeries(report.report.adverseEffectLineItems,(adverseEffectLineItems,index,nxtAdvEff)=>{
                if( adverseEffectLineItems.productId == vimsVaccCode &&
                    adverseEffectLineItems.date == value.date &&
                    !adverseEffectLineItems.relatedLineItems.hasOwnProperty(0) &&
                    value.value > 0
                  ) {
                    report.report.adverseEffectLineItems[index].cases = value.value
                    var updatedReport = {
                                          "id":report.report.id,
                                          "facilityId":report.report.facilityId,
                                          "periodId":report.report.periodId,
                                          "adverseEffectLineItems":[report.report.adverseEffectLineItems[index]]
                                        }
                    this.saveVIMSReport(updatedReport,"Adverse Effect",orchestrations,(err,res,body)=>{
                      found = true
                      if (err) {
                        winston.error(err)
                        return nxtValue()
                      }
                      else
                      return nxtValue()
                    })
                  }
                  else
                  return nxtAdvEff()
              },function(){
                //if nothing found then it was not added,add it from scratch
                if(found == false && value.value > 0) {
                  var updatedReport = {
                                        "id":report.report.id,
                                        "facilityId":report.report.facilityId,
                                        "periodId":report.report.periodId,
                                        "adverseEffectLineItems": [{
                                                                    "productId": vimsVaccCode,
                                                                    "date": value.date,
                                                                    "cases": value.value,
                                                                    "batch": "",
                                                                    "isInvestigated": true
                                                                  }]
                                      }
                  me.saveVIMSReport(updatedReport,"Adverse Effect",orchestrations,(err,res,body)=>{
                    if (err) {
                      winston.error(err)
                      return nxtValue()
                    }
                    else
                    return nxtValue()
                  })
                }
                else
                return nxtValue()
              })
            },function(){
                return nextPeriod()
            })
          }
        })
      },function(){
          return callback()
      })
    },

    saveDiseaseData: function (period,values,orchestrations,callback) {
      async.eachSeries(period,(period,nextPeriod)=>{
        var periodId = period.id
        this.getReport (periodId,orchestrations,(err,report) => {
          if(err || !report) {
            return callback()
          }
          winston.info('Adding To VIMS Disease Details '+ JSON.stringify(values))
          async.eachOfSeries(report.report.diseaseLineItems,(diseaseLineItems,index,nxtDisLineItm)=>{
            var diseaseID = report.report.diseaseLineItems[index].diseaseId
            var cases = values[diseaseID]["case"]
            var death = values[diseaseID]["death"]
            if(cases == 0 && death == 0) {
              return nxtDisLineItm()
            }
            report.report.diseaseLineItems[index].cases = cases
            report.report.diseaseLineItems[index].death = death
            var updatedReport = {
                                  "id":report.report.id,
                                  "facilityId":report.report.facilityId,
                                  "periodId":report.report.periodId,
                                  "diseaseLineItems":[report.report.diseaseLineItems[index]]
                                }
            this.saveVIMSReport(updatedReport,"diseaseLineItems",orchestrations,(err,res,body)=>{
              if (err) {
                winston.error(err)
              }
              else
              nxtDisLineItm()
            })
          },function(){
            nextPeriod()
          })
        })
      },function(){
          return callback()
      })
    },

    saveColdChain: function(coldChain,uuid,orchestrations,callback) {
      winston.info("Sending to VIMS Cold Chain with timr facilityid " + uuid + " .sending Data " + coldChain)
      var data = JSON.parse(coldChain)
      oim.getVimsFacilityId(uuid,orchestrations,(err,vimsid)=>{
        if(err) {
          winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
          return callback()
        }
        if(vimsid=="" || vimsid == null || vimsid == undefined){
          winston.error(uuid + " Is not mapped to any VIMS Facility,Stop saving Cold Chain")
          var err = true
          return callback(err)
        }
        this.getPeriod(vimsid,orchestrations,(err,period)=>{
          if(period.length > 1 ) {
            winston.error("VIMS has returned two DRAFT reports,processng cold chain stoped!!!")
            return callback()
          }
          else if(period.length == 0) {
            winston.error("Skip Processing Facility" + uuid + ", No Period Found")
            return callback()
          }
          else if(period.length == 1) {
            async.eachSeries(period,(period,nextPeriod)=>{
              var periodId = period.id
              this.getReport (periodId,orchestrations,(err,report) => {
                if(err || !report) {
                  return callback()
                }
                saveSessionsData(report,data)
                if(report.report.coldChainLineItems.length == 0) {
                  winston.error("No Cold Chain Initialized For VIMS Facility " + vimsid + " Skip sending data to VIMS for this facility")
                  return callback()
                }
                async.eachOfSeries(report.report.coldChainLineItems,(coldChainLineItem,index,nextColdChain) =>{
                  var periodDate = moment(period.periodName, 'MMM YYYY','en').format('YYYY-MM')
                  if(data.hasOwnProperty(periodDate)) {
                    report.report.coldChainLineItems[index].minTemp = data[periodDate].coldStoreMin
                    report.report.coldChainLineItems[index].maxTemp = data[periodDate].coldStoreMax
                    report.report.coldChainLineItems[index].minEpisodeTemp = data[periodDate].coldStoreLow
                    report.report.coldChainLineItems[index].maxEpisodeTemp = data[periodDate].coldStoreHigh
                    report.report.coldChainLineItems[index].operationalStatusId = data[periodDate].status
                    var coldChainUpdatedReport = {
                                                    "id":report.report.id,
                                                    "facilityId":report.report.facilityId,
                                                    "periodId":report.report.periodId,
                                                    "coldChainLineItems":[report.report.coldChainLineItems[index]]
                                                  }
                    this.saveVIMSReport (coldChainUpdatedReport,"Cold Chain",orchestrations,(err,res,body)=>{

                    })
                  }
                  else{
                    return callback()
                  }
                })
              })
            },function(){

            })
          }
        })
      })
    },

    saveStockData: function(period,timrStockData,stockCodes,vimsItemCode,orchestrations,callback) {
      /**
        push stock report to VIMS
      */
      var totalStockCodes = stockCodes.length
      if(totalStockCodes == 0) {
        return callback()
      }
      period.forEach ((period) => {
        var periodId = period.id
        this.getReport (periodId,orchestrations,(err,report) => {
          if(err || !report) {
            return callback()
          }
          var totalLogLineItems = report.report.logisticsLineItems.length;
          var found = false
          report.report.logisticsLineItems.forEach((logisticsLineItems,index) =>{
            if(logisticsLineItems.productId == vimsItemCode) {
              found = true
              totalLogLineItems--
              /*
              currently vims combines quantityExpired,quantityWastedOther,quantityFreezed and quantityVvmAlerted
              into quantityDiscardedUnopened,so we are also combining them until when vims accepts them separately
              */
              var discarded = 0
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"ON_HAND" }) != undefined) {
                report.report.logisticsLineItems[index].closingBalance = timrStockData[(vimsItemCode+"ON_HAND")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"EXPIRED" }) != undefined) {
                //report.report.logisticsLineItems[index].quantityExpired = timrStockData[(vimsItemCode+"EXPIRED")].quantity
                discarded = Number(discarded) + Number(timrStockData[(vimsItemCode+"EXPIRED")].quantity)
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"DAMAGED" }) != undefined) {
                //report.report.logisticsLineItems[index].quantityDiscardedUnopened = timrStockData[(vimsItemCode+"DAMAGED")].quantity
                discarded = Number(discarded) + Number(timrStockData[(vimsItemCode+"DAMAGED")].quantity)
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"WASTED" }) != undefined) {
                //report.report.logisticsLineItems[index].quantityWastedOther = timrStockData[(vimsItemCode+"WASTED")].quantity
                discarded = Number(discarded) + Number(timrStockData[(vimsItemCode+"WASTED")].quantity)
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"REASON-VVM" }) != undefined) {
                //report.report.logisticsLineItems[index].quantityVvmAlerted = timrStockData[(vimsItemCode+"REASON-VVM")].quantity
                discarded = Number(discarded) + Number(timrStockData[(vimsItemCode+"REASON-VVM")].quantity)
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"REASON-FROZEN" }) != undefined) {
                //report.report.logisticsLineItems[index].quantityFreezed = timrStockData[(vimsItemCode+"REASON-FROZEN")].quantity
                discarded = Number(discarded) + Number(timrStockData[(vimsItemCode+"REASON-FROZEN")].quantity)
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"REASON-OPENWASTE" }) != undefined) {
                report.report.logisticsLineItems[index].quantityDiscardedOpened = timrStockData[(vimsItemCode+"REASON-OPENWASTE")].quantity
              }
              report.report.logisticsLineItems[index].quantityDiscardedUnopened = discarded
              var updatedReport = {
                                    "id":report.report.id,
                                    "facilityId":report.report.facilityId,
                                    "periodId":report.report.periodId,
                                    "logisticsLineItems":[report.report.logisticsLineItems[index]]
                                  }
              this.saveVIMSReport (updatedReport,"Stock",orchestrations,(err,res,body)=>{
                if (err) {
                  return callback(err)
                }
                else
                return callback(err)
              })
            }
            else {
              totalLogLineItems--
            }
            if(totalLogLineItems == 0 && found == false) {
              callback('')
            }
          })

        })
      })
    },

    convertDistributionToGS1: function(distribution,orchestrations,callback) {
      distribution = JSON.parse(distribution)
      var me = this
      if(distribution !== null && distribution !== undefined) {
        fs.readFile( './despatchAdviceBaseMessage.xml', 'utf8', function(err, data) {
          var timrToFacilityId = null
          var timrFromFacilityId = null
          var fromFacilityName = null
          var distributionDate = distribution.distributionDate
          var creationDate = moment().format()
          var distributionId = distribution.id
          oim.getFacilityUUIDFromVimsId(distribution.toFacilityId,orchestrations,(err,facId,facName)=>{
            if(err) {
              winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
              return callback(err,"")
            }
            if(facId == false) {
              err = true
              winston.error("VIMS Facility with ID " + distribution.toFacilityId + " Was not found on the system,stop processing")
              return callback(err)
            }
            var toFacilityName = facName
            var timrToFacilityId = facId
            oim.getFacilityUUIDFromVimsId(distribution.fromFacilityId,orchestrations,(err,facId1,facName1)=>{
              if(err) {
                winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
                return callback(err,"")
              }
              if(facId1 == false || facId1 == null || facId1 == undefined) {
                err = true
                winston.error("VIMS Facility with ID " + distribution.fromFacilityId + " Was not found on the system,stop processing")
                return callback(err)
              }
              fromFacilityName = facName1
              timrFromFacilityId = facId1
              var despatchAdviceBaseMessage = util.format(data,timrToFacilityId,timrFromFacilityId,fromFacilityName,distributionDate,distributionId,timrToFacilityId,timrFromFacilityId,timrToFacilityId,distributionDate,creationDate)
              async.eachSeries(distribution.lineItems,function(lineItems,nextlineItems) {
                async.eachSeries(lineItems.lots,function(lot,nextLot) {
                  fs.readFile( './despatchAdviceLineItem.xml', 'utf8', function(err, data) {
                    var lotQuantity = lot.quantity
                    var lotId = lot.lotId
                    var gtin = lineItems.product.gtin
                    var vims_item_id = lineItems.product.id
                    var item_name = lineItems.product.fullName
                    if(item_name == null)
                    var item_name = lineItems.product.primaryName
                    var timr_item_id = 0
                    me.getTimrItemCode(vims_item_id,id=>{
                      timr_item_id = id
                    })
                    var lotCode = lot.lot.lotCode
                    var expirationDate = lot.lot.expirationDate
                    var dosesPerDispensingUnit = lineItems.product.dosesPerDispensingUnit
                    if(isNaN(timr_item_id)) {
                      var codeListVersion = "OpenIZ-MaterialType"
                    }
                    else {
                      var codeListVersion = "CVX"
                    }
                    var despatchAdviceLineItem = util.format(data,lotQuantity,lotId,gtin,vims_item_id,item_name,codeListVersion,timr_item_id,lotCode,expirationDate,dosesPerDispensingUnit)
                    despatchAdviceBaseMessage = util.format(despatchAdviceBaseMessage,despatchAdviceLineItem)
                    nextLot()
                  })
                },function(){
                  nextlineItems()
                })
              },function(){
                despatchAdviceBaseMessage = despatchAdviceBaseMessage.replace("%s","")
                winston.info(despatchAdviceBaseMessage)
                if(timrToFacilityId)
                callback(err,despatchAdviceBaseMessage)
                else {
                  err = true
                  winston.info("TImR Facility ID is Missing,skip sending Despatch Advise")
                  callback(err,"")
                }
              })
            })
          })
        })
      }
      else {
        winston.error("Invalid Distribution Passed For Conversion")
        //returning true to error
        callback(true,"")
      }
    },

    checkDistribution: function(vimsFacilityId,orchestrations,callback) {
      this.j_spring_security_check(orchestrations,(err,header)=>{
        var startDate = moment().startOf('month').format("YYYY-MM-DD")
        var endDate = moment().endOf('month').format("YYYY-MM-DD")
        var url = URI(vimsconfig.url).segment("vaccine/inventory/distribution/distribution-supervisorid/" + vimsFacilityId)
        var options = {
          url: url.toString(),
          headers: {
            Cookie:header["set-cookie"]
          }
        }
        let before = new Date()
        request.get(options, (err, res, body) => {
          if (err) {
            winston.error("An Error has occured while checking stock distribution on VIMS")
            return callback(err)
          }
          orchestrations.push(utils.buildOrchestration('Get Stock Distribution From VIMS', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
          if(isJSON(body)) {
            var distribution = JSON.parse(body).distribution
            if(distribution != null && distribution != false && distribution != undefined)
            winston.info("Found " + body)
            return callback(err,distribution)
          }
          else {
            winston.error("VIMS has returned non JSON results,skip processing")
            return callback()
          }
        })
      })
    },

    sendReceivingAdvice: function(distribution,orchestrations,callback) {
      this.j_spring_security_check(orchestrations,(err,header)=>{
        var url = URI(vimsconfig.url).segment('vaccine/inventory/distribution/save.json')
        var options = {
          url: url.toString(),
          headers: {
            'Content-Type': 'application/json',
            Cookie:header["set-cookie"]
          },
          json:distribution
        }

        let before = new Date()
        request.post(options, function (err, res, body) {
          orchestrations.push(utils.buildOrchestration('Send Receiving Advice To VIMS', before, 'POST', url.toString(), JSON.stringify(distribution), res, JSON.stringify(body)))
          if (err) {
            return callback(err)
          }
          else
          callback(body)
        })
      })
    }
  }
}
