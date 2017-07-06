'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require('moment')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const immDataElements = require('./terminologies/vims-immunization-valuesets.json')
const itemsDataElements = require('./terminologies/vims-items-valuesets.json')

module.exports = function (cnf) {
  const config = cnf
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

    getPeriod: function(vimsFacId,callback) {
      var url = URI(config.url).segment('rest-api/ivd/periods/'+vimsFacId+'/82')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }

      request.get(options, (err, res, body) => {
        if (err) {
          return callback(err)
        }
        var periods = []
        if(body.indexOf('error') == -1) {
          body = JSON.parse(body)
          body.periods.forEach ((period,index)=>{
            var systemMonth = moment(period.periodName, 'MMM YYYY','en').format('MM')
            var prevMonth = moment().subtract(1,'month').format('MM')
            if(period.id > 0 && systemMonth == prevMonth)
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

    getReport: function (id,callback) {
      var url = URI(config.url).segment('rest-api/ivd/get/'+id+'.json')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }

      request.get(options, (err, res, body) => {
        if (err) {
          return callback(err)
        }
        callback(JSON.parse(body))
      })
    },

    saveImmunizationData: function (periods,values,vimsVaccCode,dose,callback) {
      periods.forEach ((period) => {
        var periodId = period.id
        if(vimsVaccCode == '2413')
        var doseid = dose.vimsid1
        else if(vimsVaccCode == '2412') {
          var doseid = 1
        }
        else
        var doseid = dose.vimsid
        this.getReport (periodId,(report) => {
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
              var url = URI(config.url).segment('rest-api/ivd/save')
              var username = config.username
              var password = config.password
              var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
              var options = {
                url: url.toString(),
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: auth
                },
                json:updatedReport
              }
              request.put(options, function (err, res, body) {
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

    saveStockData: function(periods,timrStockData,stockCodes,vimsItemCode,callback) {
      /**
        push stock report to VIMS
      */
      winston.info("Processing Stock For Item " + vimsItemCode)
      var totalStockCodes = stockCodes.length
      periods.forEach ((period) => {
        var periodId = period.id
        this.getReport (periodId,(report) => {
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
              var url = URI(config.url).segment('rest-api/ivd/save')
              var username = config.username
              var password = config.password
              var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
              var options = {
                url: url.toString(),
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: auth
                },
                json:updatedReport
              }
              request.put(options, function (err, res, body) {
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
    }
  }
}
