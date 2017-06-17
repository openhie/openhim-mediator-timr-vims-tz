'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require('moment')
const immDataElements = require('./terminologies/vims-immunization-valuesets.json')

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
          var totalCoveLine = report.report.coverageLineItems.length;
          var found = false
          winston.error('Processing Vacc Code ' + vimsVaccCode + ' ' + dose.name + JSON.stringify(values))
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
            if(totalCoveLine == 0 && found == false)
            callback('')
          })

        })
      })
    },

    saveStockData: function(periods,data,code,callback) {
      var gtin = data[0].gtin
      data.forEach((dt,index) =>{
        if(dt.gtin == gtin) {
        winston.error(dt.gtin + " "+ dt.GIIS_ITEM_LOT + " "+ dt.code)
        }
        else {
          winston.error('==========')
          winston.error(dt.gtin + " "+ dt.GIIS_ITEM_LOT + " "+ dt.code)
          gtin = dt.gtin
        }
      })
      process.exit()
      periods.forEach ((period) => {
        var periodId = period.id
        if(vimsVaccCode == '2413')
        var doseid = dose.vimsid1
        else
        var doseid = dose.vimsid
        this.getReport (periodId,(report) => {
          report.report.coverageLineItems.forEach((coverageLineItems,index) =>{
            if(coverageLineItems.productId == vimsVaccCode && coverageLineItems.doseId == doseid) {
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
                  return callback(err)
                }
                callback(err)
              })
            }
          })

        })
      })
    }
  }
}
