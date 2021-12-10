'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require("moment")
const isJSON = require('is-json')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const timrVimsDwhImmConceptMap = require('./terminologies/timr-vims-dwh-immunization-conceptmap.json')
const timrVimsDiseaseConceptMap = require('./terminologies/timr-vims-diseases-conceptmap.json')
const timrVimsVitaConceptMap = require('./terminologies/timr-vims-vitamin-conceptmap.json')
const timrVimsDwhVitaConceptMap = require('./terminologies/timr-vims-dwh-vitamin-conceptmap.json')
const fs = require('fs')
const querystring = require('querystring')
const async = require('async')
const util = require('util');
const utils = require('./utils')
const VIMS = require('./vims')
var Spinner = require('cli-spinner').Spinner

module.exports = function (timrcnf, oauthcnf, vimscnf, oimcnf, eventEmitter) {
  const timrconfig = timrcnf
  const oauthconfig = oauthcnf
  const vimsconfig = vimscnf
  const oimconfig = oimcnf
  const vims = VIMS(vimsconfig, oimcnf)
  return {
    getAccessToken: function (scope, orchestrations, callback) {
      if (scope == 'gs1')
        var scope_url = oauthconfig.gs1Scope
      else if (scope == 'fhir')
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
        if (!isJSON(body)) {
          winston.error("TImR has returned non JSON results while getting Access Token For " + scope_url)
          err = true
          return callback(err)
        }
        callback(err, res, body)
      })
    },

    getTimrCode: function (vimsCode, conceptMapName, callback) {
      async.eachSeries(conceptMapName.group, (groups, nxtGrp) => {
        async.eachSeries(groups.element, (element, nxtElmnt) => {
          if (element.code == vimsCode) {
            element.target.forEach((target) => {
              return callback(target.code)
            })
          } else
            nxtElmnt()
        }, function () {
          nxtGrp()
        })
      }, function () {
        return callback("")
      })
    },

    getImmunizationData: function (vimsVaccCode, dose, facilityid, fac_name, period, orchestrations, callback) {
      this.getTimrCode(vimsVaccCode, timrVimsDwhImmConceptMap, (timrVaccCode) => {
        if (timrVaccCode == "") {
          return callback()
        }
        if (vimsVaccCode == '2412')
          dose.timrid = 0

        var queryPar = []
        var values = {}

        //TT does not have catchment data,lets treat it differently
        if (timrVaccCode == 'VaccineType-tetanustoxoid') {
          queryPar.push({
            'name': 'regularMale',
            'fhirQuery': 'gender=Male&doseSequence=' + dose.timrid
          })
          queryPar.push({
            'name': 'regularFemale',
            'fhirQuery': 'gender=Female&doseSequence=' + dose.timrid
          })
          values["outreachMale"] = 0
          values["outreachFemale"] = 0
        } else {
          queryPar.push({
            'name': 'regularMale',
            'fhirQuery': 'gender=Male&inCatchment=True&doseSequence=' + dose.timrid
          })
          queryPar.push({
            'name': 'regularFemale',
            'fhirQuery': 'gender=Female&inCatchment=True&doseSequence=' + dose.timrid
          })
          queryPar.push({
            'name': 'outreachMale',
            'fhirQuery': 'gender=Male&inCatchment=False&doseSequence=' + dose.timrid
          })
          queryPar.push({
            'name': 'outreachFemale',
            'fhirQuery': 'gender=Female&inCatchment=False&doseSequence=' + dose.timrid
          })
        }
        var vaccineStartDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
        var vaccineEndDate = moment(period[0].periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
        async.each(queryPar, (query, nxtQuery) => {
          let url = 'http://localhost:3000/immunization?' +
            query.fhirQuery + '&vaccineCode=' + timrVaccCode + '&fac_id=' + facilityid + '&fac_name=' + fac_name + '&vaccineStartDate=' + vaccineStartDate + 'T00:00' + '&vaccineEndDate=' + vaccineEndDate + 'T23:59'
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
              return nxtQuery()
            }
            if (!isJSON(body)) {
              winston.error("TImR has returned non JSON data which is " + body + ",stop processing")
              return nxtQuery()
            }
            var value = JSON.parse(body).count
            var queryName = query.name
            values[queryName] = value
            return nxtQuery()
          })
        }, () => {
          return callback('', values)
        })
      })
    },

    getAdverseEffectData: function (vimsVaccCode, facilityid, facilityName, period, orchestrations, callback) {
      if (facilityid == "" || facilityid == null || facilityid == undefined) {
        winston.error("TImR facility is empty,skip processing")
        return callback()
      }
      this.getTimrCode(vimsVaccCode, timrVimsDwhImmConceptMap, (timrVaccCode) => {
        var values = []
        if (timrVaccCode == "") {
          return callback(false, values)
        }
        var totalValues = 0
        var queryPar = []

        var vaccineYearMonth = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM")
        var endDay = moment(period[0].periodName, "MMM YYYY").endOf('month').format('D') //getting the last day of last month

        var days = Array.from({
          length: endDay
        }, (v, k) => k + 1)
        async.eachSeries(days, (day, nextDay) => {
          if (day < 10)
            var dateDay = '0' + day
          else
            var dateDay = day
          var vaccineDate = vaccineYearMonth + '-' + dateDay
          const url = 'http://localhost:3000/aefi' +
            '?vaccCode=' + timrVaccCode + '&fac_id=' + facilityid + '&fac_name=' + facilityName + '&startDate' + vaccineDate + 'T00:00' + '&endDate' + vaccineDate + 'T23:59'
          var options = {
            url: url.toString(),
            headers: {
              Authorization: `BEARER ${access_token}`
            }
          }
          let before = new Date()
          request.get(options, (err, res, body) => {
            orchestrations.push(utils.buildOrchestration('Fetching TImR FHIR Adverse Events Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
            if (err) {
              winston.error(err)
              return nextDay()
            }
            if (!isJSON(body)) {
              winston.error("TImR has returned non JSON data which is " + body + ",stop processing")
              return nextDay()
            }
            var value = JSON.parse(body).total
            if (!Number.isInteger(value)) {
              winston.error("Adverse Event Sync " + body)
            }

            if (value < 1 || value == null || value == undefined) {
              return nextDay()
            }

            values.push({
              "date": vaccineDate,
              "value": value
            })
            return nextDay()
          })
        }, function () {
          return callback(false, values)
        })
      })
    },

    getSupplementsDataDWH: function (vimsVitCode, timrFacilityId, facilityName, period, orchestrations, callback) {
      var genderTerminologies = [{
          "timrgender": "Male",
          "vimsgender": "maleValue"
        },
        {
          "timrgender": "Female",
          "vimsgender": "femaleValue"
        }
      ]
      var ageGroups = [{
          "1": 9
        },
        {
          "2": 15
        },
        {
          "3": 18
        },
        {
          "4": 6
        }
      ]
      //commenting below line so that we take vaccination by date range instead of individual vacc date
      var vaccineDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM")
      var vaccinationStartDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
      var vaccinationEndDate = moment(period[0].periodName, "MMM YYYY").endOf('month').format("YYYY-MM-DD")
      //var endDay = moment(period[0].periodName, "MMM YYYY").endOf('month').format('D') //getting the last day of last month

      var startDay = 1;
      var values = []
      this.getTimrCode(vimsVitCode, timrVimsDwhVitaConceptMap, (timrVitCode) => {
        const promises = []
        for (var ageIndex in ageGroups) {
          promises.push(new Promise((resolve, reject) => {
            var age = ageGroups[ageIndex]
            var genderRef = null
            async.eachSeries(genderTerminologies, (gender, nxtGender) => {
              var value = 0
              genderRef = gender
              //var birthDate = moment(vaccineDate).subtract(Object.values(age)[0],"months").format('YYYY-MM-DDTHH:mm:ss')
              var startBirthDate = moment(vaccineDate).subtract(Object.values(age)[0], "months").startOf('month').format('YYYY-MM-DD') + 'T00:00'
              var endBirthDate = moment(vaccineDate).subtract(Object.values(age)[0], "months").endOf('month').format('YYYY-MM-DD') + 'T23:59'
              let url = 'http://localhost:3000/supplements?' +
                'suppCode=' + timrVitCode + '&gender=' + gender.timrgender + '&fac_id=' + timrFacilityId + '&fac_name=' + facilityName + '&suppStartDate=' + vaccinationStartDate + 'T00:00' + '&suppEndDate=' + vaccinationEndDate + 'T23:59' + '&startBirthDate=' + startBirthDate + '&endBirthDate=' + endBirthDate
                .toString()
              var options = {
                url: url.toString()
              }
              let before = new Date()
              request.get(options, (err, res, body) => {
                orchestrations.push(utils.buildOrchestration('Fetching TImR FHIR Supplements Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
                if (err) {
                  winston.error(err)
                  return nxtGender()
                }
                if (!isJSON(body)) {
                  winston.error("TImR has returned non JSON data which is " + body + ",stop processing")
                  return nxtGender()
                }
                value = value + parseInt(JSON.parse(body).count)
                values.push({
                  [Object.keys(age)[0]]: {
                    "gender": gender.vimsgender,
                    "value": value
                  }
                })
                return nxtGender()
              })
            }, function () {
              resolve()
            })
          }))
        }

        Promise.all(promises).then(() => {
          return callback("", values)
        })

      })
    },
    getDiseaseData: function (vimsDiseaseValSets, timrFacilityId, timrFacilityName, period, orchestrations, callback) {
      var timrDiseaseConditions = {
        "ObservationType-Problem": "case",
        "ObservationType-CauseOfDeath": "death"
      }
      var values = {}
      var startDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
      var endDate = moment(period[0].periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
      var me = this
      async.eachSeries(vimsDiseaseValSets, function (vimsDiseaseValSet, processNextValSet) {
        var vimsDiseaseCode = vimsDiseaseValSet.code
        me.getTimrCode(vimsDiseaseCode, timrVimsDiseaseConceptMap, (timrDisCode) => {
          winston.info("Fetching Data For Disease Code " + timrDisCode + " From TImR")
          async.eachOfSeries(timrDiseaseConditions, (conditionName, conditionCode, nxtCndtn) => {
            let url = `http://localhost:3000/disease?diseaseCode=${timrDisCode}&diseaseCond=${conditionCode}&`+
                      `fac_id=${timrFacilityId}&fac_name=${timrFacilityName}&startDate=${startDate}&endDate=${endDate}`
            var options = {
              url: url.toString()
            }
            let before = new Date()
            request.get(options, (err, res, body) => {
              orchestrations.push(utils.buildOrchestration('Fetching TImR Disease Data', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
              if (err) {
                winston.error(err)
              }
              if (!isJSON(body)) {
                winston.error("TImR has returned non JSON data which is " + body + ",stop processing")
                return nxtCndtn()
              }
              var value = JSON.parse(body).count
              value = parseInt(value)
              if (!Number.isInteger(value)) {
                winston.error("Diseases Sync " + body)
                return nxtCndtn()
              }
              if (vimsDiseaseCode in values)
                Object.assign(values[vimsDiseaseCode], {
                  [conditionName]: value
                })
              else
                values[vimsDiseaseCode] = {
                  [conditionName]: value
                }
              nxtCndtn()
            })
          }, function () {
            processNextValSet()
          })
        })
      }, function () {
        return callback('', values)
      })
    },

    processColdChain: function (access_token, nexturl, orchestrations, callback) {
      if (!nexturl)
        nexturl = URI(timrconfig.url)
        .segment('fhir')
        .segment('Location') +
        '?_count=500&_format=json'
      var options = {
        url: nexturl.toString(),
        headers: {
          Authorization: `BEARER ${access_token}`
        }
      }
      let before = new Date()
      request.get(options, (err, res, body) => {
        winston.info("Received data For " + nexturl)
        orchestrations.push(utils.buildOrchestration('Getting Cold Chain Data', before, 'GET', nexturl.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          winston.error(err)
          return callback(err)
        }
        if (!isJSON(body)) {
          winston.error("TImR has returned non JSON data which is " + body + ",stop processing")
          return callback(err)
        }
        body = JSON.parse(body)
        var entries = body.entry
        var me = this
        async.eachSeries(entries, function (entry, nextEntry) {
          if (entry.resource.hasOwnProperty("extension")) {
            var extensions = entry.resource.extension
            async.eachSeries(extensions, function (extension, nextExtension) {
              if (extension.hasOwnProperty("url") && extension.url == "http://openiz.org/extensions/contrib/bid/ivdExtendedData") {
                var data = new Buffer(extension.valueBase64Binary, 'base64').toString("ascii")
                if (entry.resource.hasOwnProperty("identifier")) {
                  var identifiers = entry.resource.identifier
                  async.eachSeries(identifiers, (identifier, nxtIdentifier) => {
                    if (identifier.system == "http://hfrportal.ehealth.go.tz/") {
                      var uuid = identifier.value
                      vims.saveColdChain(data, uuid, orchestrations, (err, res) => {
                        if (err) {
                          return nxtIdentifier()
                        }
                        return nextExtension()
                      })
                    } else
                      return nxtIdentifier()
                  }, function () {
                    return nextExtension()
                  })
                } else
                  return nextExtension()
              } else
                return nextExtension()
            }, function () {
              nextEntry()
            })
          } else {
            return nextEntry()
          }
        }, function () {
          nexturl = false
          if (!body.hasOwnProperty("link")) {
            winston.error("Un expected results returned from TImR")
            return callback(err)
          }
          for (var len = 0, totalLinks = body.link.length; len < totalLinks; len++) {
            if (body.link[len].hasOwnProperty("relation") && body.link[len].relation == "next")
              nexturl = body.link[len].url
          }
          if (nexturl)
            me.processColdChain(access_token, nexturl, orchestrations, (err) => {
              callback(err)
            })
          if (!nexturl)
            callback(err)
        })
      })
    },

    getStockData: function (access_token, facilityUUID, period, orchestrations, callback) {
      fs.readFile('./gs1RequestMessage.xml', 'utf8', function (err, data) {
        var startDate = moment(period[0].periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
        var endDate = moment(period[0].periodName, "MMM YYYY").endOf('month').format('YYYY-MM-DD')
        var gs1RequestMessage = util.format(data, startDate, endDate, facilityUUID)
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
          eventEmitter.emit('received_timr_stock');
          orchestrations.push(utils.buildOrchestration('Fetching TImR GS1 Stock Data', before, 'POST', url.toString(), options.body, res, JSON.stringify(body)))
          if (err) {
            return callback(err)
          } else
            callback(body)
        })
      })
    },

    extractStockData: function (data, facilityUUID, callback) {
      const ast = XmlReader.parseSync(data);
      const logisticsInventoryReport = xmlQuery(ast).children().find("logisticsInventoryReport")
      const logInvRepInvLoc = logisticsInventoryReport.children().find("logisticsInventoryReportInventoryLocation").children()
      var items = {}
      var stockCodes = []
      if (logInvRepInvLoc.size() == 0) {
        return callback(items, stockCodes)
      }
      var total = Array.from({
        length: logInvRepInvLoc.size()
      }, (v, k) => k)
      async.eachSeries(total, (counter, next) => {
        if (logInvRepInvLoc.eq(counter).has("tradeItemInventoryStatus")) {
          var tradeItmClassLength = logInvRepInvLoc.eq(counter).find("tradeItemClassification").children().length
          var tradeItmClass = logInvRepInvLoc.eq(counter).find("tradeItemClassification").children()
          //just in case there are more than one tradeItemClassification,loop through all and get the one with vimsid
          var vimsid = 0
          for (var classficationCounter = 0; classficationCounter < tradeItmClassLength; classficationCounter++) {
            if (tradeItmClass.eq(classficationCounter).attr("codeListVersion") == "VIMS_ITEM_ID")
              vimsid = tradeItmClass.eq(classficationCounter).text()
          }
          if (vimsid != 0) {
            //get quantity
            var quantity = logInvRepInvLoc.eq(counter).find("transactionalItemData").children().find("tradeItemQuantity").text()
            //get Code
            var code = logInvRepInvLoc.eq(counter).find("inventoryDispositionCode").text()
            var index = vimsid + code

            var stockAdded = stockCodes.find(stockCode => {
              return stockCode.code == index
            })
            if (stockAdded == undefined)
              stockCodes.push({
                "code": index
              })
            if (items[index] == undefined) {
              items[index] = {
                "id": vimsid,
                "code": code,
                "quantity": quantity
              }
              return next()
            } else {
              items[index].quantity = Number(items[index].quantity) + Number(quantity)
              return next()
            }
          } else
            return next()
        } else {
          return next()
        }
      }, function () {
        return callback(items, stockCodes)
      })
    },

    saveDistribution: function (despatchAdviceBaseMessage, access_token, orchestrations, callback) {
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
        } else
          callback(err, res, body)
      })
    },

    getDefaulters: function (access_token, orchestrations, callback) {
      var defDate = moment().subtract(8, 'days').format('YYYY-MM-DD')
      let url = URI(timrconfig.url)
        .segment('risi')
        .segment('datamart')
        .segment('9896a202-ddd0-45c8-8820-04fa30c3bc9e')
        .segment('query')
        .segment('defaulters') +
        "?act_date=" + defDate
        .toString()
      var options = {
        url: url.toString(),
        headers: {
          Authorization: `BEARER ${access_token}`,
          Accept: "application/json"
        }
      }
      let before = new Date()
      winston.info("Getting Defaulters List")
      var spinner = new Spinner("Waiting for defaulters List")
      spinner.setSpinnerString(8);
      spinner.start()
      request.get(options, function (err, res, body) {
        spinner.stop()
        orchestrations.push(utils.buildOrchestration('Getting Defaulters', before, 'GET', url.toString(), options.body, res, body))
        if (err) {
          return callback("", err)
        } else
          return callback(body, err)
      })
    }

  }
}