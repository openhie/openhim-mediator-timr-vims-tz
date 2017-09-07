'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require("moment")
const isJSON = require('is-json')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const timrVimsImmConceptMap = require('./terminologies/timr-vims-immunization-conceptmap.json')
const timrVimsDiseaseConceptMap = require('./terminologies/timr-vims-diseases-conceptmap.json')
const timrVimsVitaConceptMap = require('./terminologies/timr-vims-vitamin-conceptmap.json')
const fs = require('fs')
const querystring = require('querystring')
const async = require('async')
const util = require('util');
const utils = require('./utils')
const VIMS = require('./vims')

module.exports = function (timrcnf,oauthcnf,vimscnf,oimcnf) {
  const timrconfig = timrcnf
  const oauthconfig = oauthcnf
  const vimsconfig = vimscnf
  const oimconfig = oimcnf
  const vims = VIMS(vimsconfig,oimcnf)
  return {
    getAccessToken: function (scope,orchestrations,callback) {
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
        orchestrations.push(utils.buildOrchestration('Getting Access Token From TImR', before, 'POST', url.toString(), options.body, res, body))
        if(!isJSON(body)) {
          winston.error("TImR has returned non JSON results while getting Access Token For " + scope_url)
          err = true
          return callback(err)
        }
        callback(err, res, body)
      })
    },

    getTimrCode: function (vimsCode,conceptMapName,callback) {
      async.eachSeries(conceptMapName.group,(groups,nxtGrp)=>{
        async.eachSeries(groups.element,(element,nxtElmnt)=>{
          if(element.code == vimsCode) {
            element.target.forEach((target) => {
              return callback(target.code)
            })
          }
          else
            nxtElmnt()
        },function(){
            nxtGrp()
        })
      },function(){
        return callback("")
      })
    },

    getImmunizationData: function (access_token,vimsVaccCode,dose,facilityid,period,orchestrations,callback) {
      this.getTimrCode (vimsVaccCode,timrVimsImmConceptMap,(timrVaccCode)=> {
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
        var vaccineStartDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
        var vaccineEndDate = moment(period[0].periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
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
          let before = new Date()
          request.get(options, (err, res, body) => {
            orchestrations.push(utils.buildOrchestration('Fetching TImR FHIR Immunization Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
            if (err) {
              winston.error(err)
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

    getAdverseEffectData: function (access_token,vimsVaccCode,facilityid,period,orchestrations,callback) {
      if(facilityid == "" || facilityid == null || facilityid == undefined){
        winston.error("TImR facility is empty,skip processing")
        return callback()
      }
      this.getTimrCode (vimsVaccCode,timrVimsImmConceptMap,(timrVaccCode)=> {
        var values = []
        if(timrVaccCode == "") {
          return callback(false,values)
        }
        var totalValues = 0
        var queryPar = []

        var vaccineYearMonth = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM")
        var endDay = moment(period[0].periodName, "MMM YYYY").endOf('month').format('D') //getting the last day of last month

        var startDay = 1;
        var totalDays = endDay
        var days = Array.from({length: totalDays}, (v, k) => k+1)
        async.eachSeries(days,(day,nextDay)=>{
          if(day<10)
          var dateDay = '0' + day
          else
          var dateDay = day
          var vaccineDate = vaccineYearMonth + '-' + dateDay
          const url = URI(timrconfig.url)
          .segment('fhir')
          .segment('AdverseEvent')
          +'?substance.type=' + timrVaccCode + '&location.identifier=HIE_FRID|'+facilityid + '&date=ge' + vaccineDate + 'T00:00'+ '&date=le' + vaccineDate + 'T23:59' + '&_format=json&_count=0'
          .toString()

          var options = {
            url: url.toString(),
            headers: {
              Authorization: `BEARER ${access_token}`
            }
          }
          let before = new Date()
          request.get(options, (err, res, body) => {
            orchestrations.push(utils.buildOrchestration('Fetching TImR FHIR Adverse Events Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
            totalDays--
            if (err && totalDays == 0) {
              winston.error(err)
              return callback(err,values)
            }
            else if (err) {
              winston.error(err)
              return nextDay()
            }
            var value = JSON.parse(body).total
            if(value < 1)
            return nextDay()
            values.push({"date":vaccineDate,"value":value})
            if(totalDays == 0) {
              return callback(err,values)
            }
            return nextDay()
          })
        },function(){
          return callback(false,values)
        })
      })
    },

    getVitaminData: function (access_token,vimsVitCode,timrFacilityId,period,orchestrations,callback) {
      var genderTerminologies = [
                      {"fhirgender":"male","vimsgender":"maleValue"},
                      {"fhirgender":"female","vimsgender":"femaleValue"}
                   ]
      var ageGroups = [
                        {"1":9},
                        {"2":15},
                        {"3":18}
                      ]

      var vaccineYearMonth = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM")
      var endDay = moment(period[0].periodName, "MMM YYYY").endOf('month').format('D') //getting the last day of last month

      var startDay = 1;
      var values = []
      this.getTimrCode (vimsVitCode,timrVimsVitaConceptMap,(timrVitCode)=> {
        async.eachOfSeries(ageGroups,(age,ageGrpIndex,nxtAge)=>{
          var genderRef = null
          async.eachSeries(genderTerminologies,(gender,nxtGender)=>{
            var value = 0
            genderRef = gender
            var totalDays = endDay
          for(var day=startDay;day<=endDay;day++) {
            var birthDatePar = ''
            var countAges = 0
            if(day<10)
            var dateDay = '0' + day
            else
            var dateDay = day
            var vaccineDate = vaccineYearMonth + '-' + dateDay
            var birthDate = moment(vaccineDate).subtract(Object.values(age)[0],"months").format('YYYY-MM-DDTHH:mm:ss')
            let url = URI(timrconfig.url)
            .segment('fhir')
            .segment('MedicationAdministration')
            +'?medication=' + timrVitCode + '&patient.gender=' + gender.fhirgender + '&location.identifier=HIE_FRID|'+timrFacilityId + '&date=ge' + vaccineDate + 'T00:00'+ '&date=le' + vaccineDate + 'T23:59' + '&patient.birthDate=eq' + birthDate + '&_format=json&_count=0'
            .toString()
            var options = {
              url: url.toString(),
              headers: {
                Authorization: `BEARER ${access_token}`
              }
            }
            let before = new Date()
            request.get(options, (err, res, body) => {
              orchestrations.push(utils.buildOrchestration('Fetching TImR FHIR Supplements Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
              totalDays--
              if (err) {
                winston.error(err)
                return
              }
              value = value + JSON.parse(body).total
              if(totalDays == 0) {
                values.push({[Object.keys(age)[0]]:{"gender":gender.vimsgender,"value":value}})
                nxtGender()
              }
            })
          }
        },function(){
          nxtAge()
        })
        },function(){
            return callback("",values)
        })
      })
    },

    getDiseaseData: function(access_token,vimsDiseaseValSets,timrFacilityId,period,orchestrations,callback) {
      var timrDiseaseConditions = {
                      "55607006":"case",
                      "184305005":"death"
                    }

      var values = {}
      var startDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
      var endDate = moment(period[0].periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')

      var me = this
      async.eachSeries(vimsDiseaseValSets,function(vimsDiseaseValSet,processNextValSet) {
        var vimsDiseaseCode = vimsDiseaseValSet.code
        me.getTimrCode (vimsDiseaseCode,timrVimsDiseaseConceptMap,(timrDisCode)=> {
          winston.info("Fetching Data For Disease Code " + timrDisCode + " From TImR")
          async.eachOfSeries(timrDiseaseConditions,(conditionName,conditionCode,nxtCndtn)=>{
            let url = URI(timrconfig.url)
            .segment('fhir')
            .segment('Observation')
            +'?' + 'value-concept=' + timrDisCode + '&code=' + conditionCode + '&location.identifier=HIE_FRID|'+timrFacilityId + '&date=ge' + startDate + 'T00:00' + '&date=le' + endDate + 'T23:59' + '&_format=json&_count=0'
            .toString()
            var options = {
              url: url.toString(),
              headers: {
                Authorization: `BEARER ${access_token}`
              }
            }
            let before = new Date()
            request.get(options, (err, res, body) => {
              winston.error(body)
              orchestrations.push(utils.buildOrchestration('Fetching TImR FHIR Disease Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
              if (err) {
                winston.error(err)
              }
              var value = JSON.parse(body).total

              if(vimsDiseaseCode in values)
                Object.assign(values[vimsDiseaseCode],{[conditionName]:value})
              else
                values[vimsDiseaseCode] = {[conditionName]:value}
              nxtCndtn()
            })
          },function(){
              processNextValSet()
          })
        })
      },function(){
          return callback('',values)
      })

    },

    processColdChain: function (access_token,nexturl,orchestrations,callback) {
      if(!nexturl)
      nexturl = URI(timrconfig.url)
                    .segment('fhir')
                    .segment('Location')
                    +'?_count=500&_format=json&'
      var options = {
        url: nexturl.toString(),
        headers: {
          Authorization: `BEARER ${access_token}`
        }
      }
      let before = new Date()
      request.get(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Getting Cold Chain Data', before, 'GET', nexturl.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          winston.error()
          return callback(err)
        }
        if(!isJSON(body)) {
          winston.error("TImR has returned non JSON data,stop processing")
          return
        }
        body = JSON.parse(body)
        var entries = body.entry
        var me = this
        async.eachSeries(entries,function(entry,nextEntry){
          if(entry.resource.hasOwnProperty("extension")) {
            var extensions = entry.resource.extension
            async.eachSeries(extensions,function(extension,nextExtension){
              if(extension.hasOwnProperty("url") && extension.url == "http://openiz.org/extensions/contrib/bid/ivdExtendedData") {
                var data = new Buffer(extension.valueBase64Binary, 'base64').toString("ascii")
                winston.error(data)
                if(entry.resource.hasOwnProperty("identifier")) {
                  var identifiers = entry.resource.identifier
                  for(var idCnt=0,totalId=identifiers.length;idCnt<totalId;idCnt++) {
                    if(identifiers[idCnt].system == "http://hfrportal.ehealth.go.tz/") {
                      var uuid = identifiers[idCnt].value
                      vims.saveColdChain(data,uuid,orchestrations,(err,res)=>{
                        return nextExtension()
                      })
                    }
                  }
                }
                else
                nextExtension()
              }
              else
              nextExtension()
            },function(){
              nextEntry()
            })
          }
        },function(){
            nexturl = false
            for(var len=0,totalLinks=body.link.length;len<totalLinks;len++) {
              if(body.link[len].hasOwnProperty("relation") && body.link[len].relation=="next")
                nexturl = body.link[len].url
            }
            winston.error(nexturl)
            if(nexturl)
            me.processColdChain(access_token,nexturl,orchestrations,(err)=>{
              callback(err)
            })
            if(!nexturl)
            callback(err)
          })
        })
    },

    getStockData: function (access_token,facilityUUID,period,orchestrations,callback) {
      fs.readFile( './gs1RequestMessage.xml', 'utf8', function(err, data) {
        var startDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
        var endDate = moment(period[0].periodName,"MMM YYYY").endOf('month').format('YYYY-MM-DD')
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
        let before = new Date()
        request.post(options, function (err, res, body) {
          orchestrations.push(utils.buildOrchestration('Fetching TImR GS1 Stock Data', before, 'POST', url.toString(), options.body, res, body))
          if (err) {
            return callback(err)
          }
          callback(body)
        })
      })
    },

    extractStockData: function (data,facilityUUID,callback) {
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
          if(ensureProcessed ==0) {
            winston.error(stockCodes)
          callback(items,stockCodes)
          }
        }
      }
    },

    saveDistribution: function(despatchAdviceBaseMessage,access_token,orchestrations,callback) {
      let url = URI(timrconfig.url)
      .segment('gs1')
      .segment('despatchAdvice')
      .toString()
      var options = {
        url: url.toString(),
        headers: {
          'Content-Type': 'application/xml',
          Authorization: `BEARER ${access_token}`
        },
        body: despatchAdviceBaseMessage
      }
      let before = new Date()
      request.post(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Sending Despatch Advice To TImR', before, 'POST', url.toString(), options.body, res, body))
        if (err) {
          return callback(err)
        }
        callback(body)
      })
    }

  }
}
