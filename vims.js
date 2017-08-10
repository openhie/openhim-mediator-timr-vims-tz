'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require('moment')
const async = require('async')
const querystring = require('querystring');
const util = require('util')
const utils = require('./utils')
const OIM = require('./openinfoman')
const fs = require('fs')
const immDataElements = require('./terminologies/vims-immunization-valuesets.json')
const itemsDataElements = require('./terminologies/vims-items-valuesets.json')
const timrVimsItems = require('./terminologies/timr-vims-items-conceptmap.json')
module.exports = function (vimscnf,oimcnf) {
  const vimsconfig = vimscnf
  const oimconfig = oimcnf
  const oim = OIM(oimcnf)
  return {
    isValidJson: function(json){
      try{
        JSON.parse(json);
        return true;
      }
      catch (error){
        return false;
      }
    },
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

    getPeriod: function(vimsFacId,orchestrations,callback) {
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
        var periods = []
        if(body.indexOf('error') == -1) {
          body = JSON.parse(body)
          body.periods.forEach ((period,index)=>{
            var systemMonth = moment(period.periodName, 'MMM YYYY','en').format('MM')
            var prevMonth = moment().subtract(1,'month').format('MM')
            if(period.id > 0 && period.status == "DRAFT")
            periods.push({'id':period.id,'periodName':period.periodName})
            if(index == body.periods.length-1) {
              callback(periods)
            }
          })
        }
        else {
          callback(periods)
        }
      })
    },

    getImmunDataElmnts: function (callback) {
      var concept = immDataElements.compose.include[0].concept
      var dataElmnts = []
      concept.forEach ((code,index) => {
        dataElmnts.push({'code':code.code})
        if(concept.length-1 == index)
          callback('',dataElmnts)
      })
    },

    getItemsDataElmnts: function (callback) {
      var concept = itemsDataElements.compose.include[0].concept
      var dataElmnts = []
      concept.forEach ((code,index) => {
        dataElmnts.push({'code':code.code})
        if(concept.length-1 == index)
          callback('',dataElmnts)
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
        orchestrations.push(utils.buildOrchestration('Get VIMS Report', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          return callback(err)
        }
        return callback(JSON.parse(body))
      })
    },

    saveImmunizationData: function (periods,values,vimsVaccCode,dose,orchestrations,callback) {
      periods.forEach ((period) => {
        var periodId = period.id
        if(vimsVaccCode == '2413')
        var doseid = dose.vimsid1
        else if(vimsVaccCode == '2412') {
          var doseid = 1
        }
        else
        var doseid = dose.vimsid
        this.getReport (periodId,(report,orchestrations) => {
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
              var updatedReport = report.report
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
                orchestrations.push(utils.buildOrchestration('Updating Immunization VIMS Coverage', before, 'PUT', url.toString(), updatedReport, res, body))
                if (err) {
                  winston.error(err)
                  return callback(err)
                }
                callback(err)
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

    saveStockData: function(periods,timrStockData,stockCodes,vimsItemCode,orchestrations,callback) {
      /**
        push stock report to VIMS
      */
      var totalStockCodes = stockCodes.length
      periods.forEach ((period) => {
        var periodId = period.id
        this.getReport (periodId,(report,orchestrations) => {
          var totalLogLineItems = report.report.logisticsLineItems.length;
          var found = false
          report.report.logisticsLineItems.forEach((logisticsLineItems,index) =>{
            if(logisticsLineItems.productId == vimsItemCode) {
              found = true
              totalLogLineItems--
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"ON_HAND" }) != undefined) {
                report.report.logisticsLineItems[index].closingBalance = timrStockData[(vimsItemCode+"ON_HAND")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"EXPIRED" }) != undefined) {
                report.report.logisticsLineItems[index].quantityExpired = timrStockData[(vimsItemCode+"EXPIRED")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"DAMAGED" }) != undefined) {
                report.report.logisticsLineItems[index].quantityDiscardedUnopened = timrStockData[(vimsItemCode+"DAMAGED")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"WASTED" }) != undefined) {
                report.report.logisticsLineItems[index].quantityWastedOther = timrStockData[(vimsItemCode+"WASTED")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"REASON-VVM" }) != undefined) {
                report.report.logisticsLineItems[index].quantityVvmAlerted = timrStockData[(vimsItemCode+"REASON-VVM")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"REASON-FROZEN" }) != undefined) {
                report.report.logisticsLineItems[index].quantityFreezed = timrStockData[(vimsItemCode+"REASON-FROZEN")].quantity
              }
              if (stockCodes.find(stockCode=>{ return stockCode.code == vimsItemCode+"REASON-OPENWASTE" }) != undefined) {
                report.report.logisticsLineItems[index].quantityDiscardedOpened = timrStockData[(vimsItemCode+"REASON-OPENWASTE")].quantity
              }
              var updatedReport = report.report
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
                orchestrations.push(utils.buildOrchestration('Updating Stock In VIMS', before, 'PUT', url.toString(), updatedReport, res, body))
                if (err) {
                  return callback(err)
                }

                callback(err)
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
          orchestrations.push(utils.buildOrchestration('Get Stock Distribution From VIMS', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
          var distribution = JSON.parse(body).distribution
          winston.info(JSON.stringify(distribution))
          //this will help to access getTimrItemCode function inside async
          var me = this;

            //check to ensure that despatch is available
            if(distribution !== null && distribution !== undefined) {
              fs.readFile( './despatchAdviceBaseMessage.xml', 'utf8', function(err, data) {
                var timrToFacilityId = null
                var timrFromFacilityId = null
                var fromFacilityName = null
                var distributionDate = distribution.distributionDate
                var creationDate = moment().format()
                var distributionId = distribution.id
                oim.getFacilityUUIDFromVimsId(distribution.toFacilityId,orchestrations,(facId,facName)=>{
                  var toFacilityName = facName
                  var timrToFacilityId = facId
                  oim.getFacilityUUIDFromVimsId(distribution.fromFacilityId,orchestrations,(facId1,facName1)=>{
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
                      if(timrToFacilityId)
                      callback(despatchAdviceBaseMessage,err)
                    })
                  })
                })
              })
            }
            else {
              callback("",err)
            }

      if (err) {
        return callback("",err)
      }
        })
      })
    },

    sendReceivingAdvice: function(orchestrations,distribution,callback) {
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
          orchestrations.push(utils.buildOrchestration('Send Receiving Advice To VIMS', before, 'POST', url.toString(), distribution, res, body))
          if (err) {
            return callback(err)
          }
          winston.error(JSON.stringify(body))
          callback(err)
        })
      })
    }
  }
}
