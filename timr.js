'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require("moment")
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const catOptOpers = require('./config/categoryOptionsOperations.json')
const timrVimsImm = require('./terminologies/timr-vims-immunization-conceptmap.json')
const fs = require('fs')
const parser = require('xml2json')
const parseString = require('xml2js').parseString;
const util = require('util');

module.exports = function (timrcnf,oauthcnf) {
  const timrconfig = timrcnf
  const oauthconfig = oauthcnf
  return {
    getAccessToken: function (scope,callback) {
      if(scope == 'gs1')
      var scope_url = oauthconfig.gs1Scope
      else if(scope == 'fhir')
      var scope_url = oauthconfig.fhirScope
      let url = URI(oauthconfig.url)
      let before = new Date()
      var options = {
        url: url.toString(),
        headers: {
          Authorization: `BASIC ${oauthconfig.token}`
        },
        body: `grant_type=password&username=${oauthconfig.username}&password=${oauthconfig.password}&scope=${scope_url}`
      }
      request.post(options, (err, res, body) => {
        if (err) {
          winston.error(err)
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

    getStockData: function (access_token,facilityUUID,callback) {
      /*fs.readFile('/home/ashaban/openhim-mediator-timr-vims-tz/gs1data.xml','utf8', function(err,data) {
        callback(data)
      })*/
      fs.readFile( './gs1RequestMessage.xml', 'utf8', function(err, data) {
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
            'Content-Type': 'application/xml',
            Authorization: `BEARER ${access_token}`
          },
          body: gs1RequestMessage
        }
        request.post(options, function (err, res, body) {
          if (err) {
            return callback(err)
          }
          callback(body)
        })
      })
    },

    extractStockData: function (data,callback) {
      const ast = XmlReader.parseSync(data);
      const logisticsInventoryReport = xmlQuery(ast).children().find("logisticsInventoryReport")
      const logInvRepInvLoc = logisticsInventoryReport.children().find("logisticsInventoryReportInventoryLocation").children()
      var length = logInvRepInvLoc.size()
      var items = []
      var stockCodes = []
      var ensureProcessed = length-1
      for(var counter = 0;counter<=length-1;counter++) {
        if(logInvRepInvLoc.eq(counter).has("tradeItemInventoryStatus")){
          var tradeItmClassLength = logInvRepInvLoc.eq(counter).find("tradeItemClassification").children().length
          var tradeItmClass = logInvRepInvLoc.eq(counter).find("tradeItemClassification").children()
          //just in case there are more than one tradeItemClassification,loop through all and get the one with vimsid
          var vimsid = 0
          for(var classficationCounter=0;classficationCounter<tradeItmClassLength;classficationCounter++) {
            if(tradeItmClass.eq(classficationCounter).attr("codeListVersion") == "VIMS_ITEM_ID")
            vimsid = tradeItmClass.eq(classficationCounter).text()
          }
          if(vimsid != 0) {
            //get quantity
            var quantity = logInvRepInvLoc.eq(counter).find("transactionalItemData").children().find("tradeItemQuantity").text()

            //get Code
            var code = logInvRepInvLoc.eq(counter).find("inventoryDispositionCode").text()
            var index = vimsid+code
            var stockAdded = stockCodes.find(stockCode=> {
              return stockCode.code == index
            })
            if(stockAdded == undefined)
            stockCodes.push({"code":index})

            if(items[index] == undefined) {
              items[index] = {"id":vimsid,"code":code,"quantity":quantity}
            }
            else {
              items[index].quantity = Number(items[index].quantity) + Number(quantity)
            }
          }
          ensureProcessed--
          if(ensureProcessed ==0)
          callback(items,stockCodes)
        }
      }
    }

  }
}
