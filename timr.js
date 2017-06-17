'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require("moment")
const catOptOpers = require('./config/categoryOptionsOperations.json')
const timrVimsImm = require('./terminologies/timr-vims-immunization-conceptmap.json')
const fs = require('fs');
const parser = require('xml2json');
const util = require('util');
const xpath = require('xpath')
const Dom = require('xmldom').DOMParser

module.exports = function (timrcnf,oauthcnf) {
  const timrconfig = timrcnf
  const timroauthconfig = oauthcnf
  return {
    getAccessToken: function (callback) {
      let url = URI(timroauthconfig.url)
      let before = new Date()
      var options = {
        url: url.toString(),
        headers: {
          Authorization: `BASIC ${timroauthconfig.token}`
        },
        body: `grant_type=password&username=${timroauthconfig.username}&password=${timroauthconfig.password}&scope=${timroauthconfig.scope}`
      }
      request.post(options, (err, res, body) => {
        if (err) {
          return callback(err)
        }
        callback(err, res, body)
      })
    },

    getVaccineCode: function (vimsVaccCode,callback) {
      timrVimsImm.group.forEach((groups) => {
        groups.element.forEach((element)=>{
          if(element.code == vimsVaccCode) {
            element.target.forEach((target) => {
              callback(target.code)
            })
          }
        })
      })
    },

    getImmunizationData: function (access_token,vimsVaccCode,dose,facilityid,callback) {
      this.getVaccineCode(vimsVaccCode,(timrVaccCode)=> {
        if(timrVaccCode == "") {
          callback()
          return
        }
        if(vimsVaccCode == '2412')
        dose.timrid = 0

        var totalValues = 0
        var queryPar = []
        var values = {}
        queryPar.push({'name': 'regularMale','fhirQuery':'patient.gender=male&in-catchment=True&dose-sequence='+dose.timrid})
        queryPar.push({'name': 'regularFemale','fhirQuery':'patient.gender=female&in-catchment=True&dose-sequence='+dose.timrid})
        queryPar.push({'name': 'outreachMale','fhirQuery':'patient.gender=male&in-catchment=False&dose-sequence='+dose.timrid})
        queryPar.push({'name': 'outreachFemale','fhirQuery':'patient.gender=female&in-catchment=False&dose-sequence='+dose.timrid})
        //make start date and end date dynamic
        var vaccineStartDate = moment().subtract(1,'month').startOf('month').format('YYYY-MM-DD')
        var vaccineEndDate = moment().subtract(1,'month').endOf('month').format('YYYY-MM-DD')
        var totalLoop = queryPar.length
        queryPar.forEach ((query,index) => {
          let url = URI(timrconfig.url)
          .segment('fhir')
          .segment('Immunization')
          +'?' + query.fhirQuery + '&vaccine-code=' + timrVaccCode + '&location.identifier=HIE_FRID|'+facilityid + '&date=ge' + vaccineStartDate + 'T00:00' + '&date=le' + vaccineEndDate + 'T23:59' + '&_format=json&_count=0'
          .toString()
          if(vimsVaccCode == '2421' && dose.timrid==1) {
              winston.error(url)
          }
          var options = {
            url: url.toString(),
            headers: {
              Authorization: `BEARER ${access_token}`
            }
          }
          request.get(options, (err, res, body) => {
            if (err) {
              return callback(err)
            }
            var value = JSON.parse(body).total
            var queryName = query.name
            values[queryName] = value
            totalLoop--
            if(totalLoop === 0) {
              return callback('',values)
            }
          })
        })
      })
    },

    getStockData: function (facilityUUID,callback) {
      fs.readFile('/home/ashaban/Desktop/gs1data.xml','utf8', function(err,data) {
        callback(data)
      })

      /*fs.readFile( './gs1RequestMessage.xml', 'utf8', function(err, data) {
        var startDate = moment().subtract(1,'month').startOf('month').format('YYYY-MM-DD')
        var endDate = moment().subtract(1,'month').endOf('month').format('YYYY-MM-DD')
        var gs1RequestMessage = util.format(data,startDate,endDate,facilityUUID)
        let url = URI(timrconfig.url)
        .segment('gs1')
        .segment('inventoryReport')
        .toString()
        var options = {
          url: url.toString(),
          headers: {
            'Content-Type': 'application/xml'
          },
          body: gs1RequestMessage
        }
        request.post(options, function (err, res, body) {
          if (err) {
            return callback(err)
          }
          winston.error(body)
          callback(err)
        })
      })*/
    },

    extractStockData: function (data,callback) {
      var timrStock = []

      var json = parser.toJson(data);
      json = JSON.parse(json)
      var logInvRepInvLoc = json.logisticsInventoryReportMessage.logisticsInventoryReport.logisticsInventoryReportInventoryLocation

      if(Array.isArray(logInvRepInvLoc.tradeItemInventoryStatus))
      logInvRepInvLoc.tradeItemInventoryStatus.forEach((tradeItInvStatus,tradeItInvStatusIndex) =>{
        if(tradeItInvStatus.gtin == undefined && Array.isArray(tradeItInvStatus.additionalTradeItemIdentification)) {
          var gtin = ''
          var lot = ''
          tradeItInvStatus.additionalTradeItemIdentification.forEach((addTradeItId) =>{
            if(addTradeItId.additionalTradeItemIdentificationTypeCode == 'GTIN')
            gtin = addTradeItId.$t
            else if(addTradeItId.additionalTradeItemIdentificationTypeCode == 'GIIS_ITEM_LOT')
            lot = addTradeItId.$t
          })
          if(gtin || lot)
          timrStock.push({
                          'gtin': gtin,
                          'GIIS_ITEM_LOT': lot,
                          'code': tradeItInvStatus.inventoryDispositionCode,
                          'quantity': tradeItInvStatus.transactionalItemData.tradeItemQuantity
                        })
        }
        else if(tradeItInvStatus.gtin == undefined && !Array.isArray(tradeItInvStatus.additionalTradeItemIdentification)) {
          timrStock.push({
                          'gtin': tradeItInvStatus.additionalTradeItemIdentification.$t,
                          'code': tradeItInvStatus.inventoryDispositionCode,
                          'quantity': tradeItInvStatus.transactionalItemData.tradeItemQuantity
                        })
        }
        else if(tradeItInvStatus.gtin != undefined) {
          timrStock.push({
                          'gtin': tradeItInvStatus.gtin,
                          'code': tradeItInvStatus.inventoryDispositionCode,
                          'quantity': tradeItInvStatus.transactionalItemData.tradeItemQuantity
                        })
        }

        if(tradeItInvStatusIndex == logInvRepInvLoc.tradeItemInventoryStatus.length-1) {
          callback(timrStock)
        }
      })

      else if(logInvRepInvLocIndex == json.logisticsInventoryReportMessage.logisticsInventoryReport.logisticsInventoryReportInventoryLocation.length-1){
        callback(timrStock)
      }
    }
  }
}
