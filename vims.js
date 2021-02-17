'use strict'
const winston = require('winston')

const request = require('request')
const URI = require('urijs')
const moment = require('moment')
const async = require('async')
const querystring = require('querystring')
const util = require('util')
const utils = require('./utils')
const FHIR = require('./fhir');
const fs = require('fs')
const isJSON = require('is-json')
const timrVimsItems = require('./terminologies/timr-vims-items-conceptmap.json')
const timrVimsDwhImmConceptMap = require('./terminologies/timr-vims-dwh-immunization-conceptmap.json')
module.exports = function (vimscnf, fhircnf) {
  const vimsconfig = vimscnf
  const fhir = FHIR(fhircnf)

  function translateAgeGroup(ageGroup, callback) {
    var ageGroups = []
    var ageOper = []

    if (ageGroup.includes("||")) {
      ageGroups = ageGroup.split("||")
    } else if (ageGroup.includes("&&")) {
      ageGroups = ageGroup.split("&&")
    } else {
      ageGroups = [ageGroup]
    }
    for (var index in ageGroups) {
      var age = ''
      var ageGroup = ageGroups[index]
      if (ageGroup == '') {
        return callback('', 'Empty Age Group')
      }
      //convert to lower case
      ageGroup = ageGroup.toLowerCase()
      //replace all empty strings
      ageGroup = ageGroup.replace(/\s/g, '')
      var dimension = null
      var operator = ageGroup.charAt(0)
      if (operator == '<' || operator == '>') {
        if (operator == '<')
          var fhirOper = '=gt'
        else if (operator == '>')
          var fhirOper = '=lt'

        for (let char of ageGroup) {
          if (!isNaN(char)) {
            age += char
          }
        }
        if (age == '') {
          return callback('', 'No age found on the age group ')
        }

        var dim = ageGroup.replace(age, '')
        dim = dim.replace(/<|>/g, '')
        if (dim.includes('week'))
          dimension = 'weeks'
        else if (dim.includes('month'))
          dimension = 'months'
        else if (dim.includes('year'))
          dimension = 'years'
        else
          return callback('', 'Age group must contain either of the string Years or Months or Weeks')

        ageOper.push({
          "value": age,
          "dimension": dimension,
          'operation': fhirOper
        })
      } else if (!isNaN(ageGroup.charAt(0))) {
        var ages = ageGroup.split('-')
        if (ages.length == 2) {
          var age1 = ages[0]
          var age2 = ''
          for (let char of ages[1]) {
            if (!isNaN(char)) {
              age2 += char
            }
          }
          if (age1 == '' || isNaN(age1) || age2 == '' || isNaN(age2)) {
            return callback('', 'No age range found on the age group ')
          }
          var dim = ageGroup.replace(age1 + '-' + age2, '')
          if (dim.includes('week'))
            dimension = 'weeks'
          else if (dim.includes('month'))
            dimension = 'months'
          else if (dim.includes('year'))
            dimension = 'years'
          else
            return callback('', 'Age group must contain either of the string Years or Months or Weeks ')
          ageOper.push({
            "value": age1,
            "dimension": dimension,
            'operation': '=lt'
          })
          ageOper.push({
            "value": age2,
            "dimension": dimension,
            'operation': '=gt'
          })
        } else if (ages.length == 1) {
          for (let char of ages[0]) {
            if (!isNaN(char)) {
              age += char
            }
          }
          if (age == '') {
            return callback('', 'No age found on the age group ')
          }
          var dim = ageGroup.replace(age, '')
          dim = dim.trim()
          dim = dim.toLowerCase()

          if (dim.includes('week')) {
            dimension = 'weeks'
            var position = dim.indexOf("week")
          } else if (dim.includes('month')) {
            dimension = 'months'
            var position = dim.indexOf("month")
          } else if (dim.includes('year')) {
            dimension = 'years'
            var position = dim.indexOf("year")
          } else {
            return callback('', 'Age group must contain either of the string Years or Months or Weeks ')
          }

          //make sure the position of dimension is at 0
          if (position != 0) {
            return callback('', 'Invalid Age Group Definition ')
          }

          ageOper.push({
            "value": age,
            "dimension": dimension,
            'operation': '=eq'
          })
        } else {

        }
      } else {
        return callback('', 'Unknown operation,expected age range e.g 10-12Years or operators < or > ')
      }
    }
    callback(ageOper, false)
  }

  function createQueryOnAge(ages, query, period, callback) {
    var endDay = moment(period.periodName, "MMM YYYY").endOf('month').format('D') //getting the last day of last month
    var startDay = 1;
    var queries = []
    var countDay = endDay
    var days = Array.from({
      length: endDay
    }, (v, k) => k + 1)
    async.eachSeries(days, (day, nextDay) => {
      var birthDatePar = ''
      if (day < 10)
        var dateDay = '0' + day
      else
        var dateDay = day
      var vaccineDate = moment(period.periodName, "MMM YYYY").format('YYYY-MM') + '-' + dateDay
      async.eachSeries(ages, (age, nextAge) => {
        var birthDate = moment(vaccineDate).subtract(age.value, age.dimension).format('YYYY-MM-DDTHH:mm:ss')
        birthDatePar = birthDatePar + '&birthDate' + age.operation + birthDate
        nextAge()
      }, function () {
        if (query)
          var newQuery = query + '&startDate=' + vaccineDate + 'T00:00' + '&endDate=' + vaccineDate + 'T23:59' + birthDatePar
        else
          var newQuery = 'startDate=' + vaccineDate + 'T00:00' + '&endDate=' + vaccineDate + 'T23:59' + birthDatePar
        queries.push({
          'query': newQuery
        })
        return nextDay()
      })
    }, function () {
      return callback(queries)
    })
  }

  return {
    getTimrCode(vimsCode, conceptMapName, callback) {
      async.each(conceptMapName.group, (groups, nxtGrp) => {
        async.each(groups.element, (element, nxtElmnt) => {
          if (element.code == vimsCode) {
            return callback(element.target[0].code)
          } else
            nxtElmnt()
        }, function () {
          nxtGrp()
        })
      }, function () {
        return callback("")
      })
    },

    getVimsCode(timrCode, conceptMapName, callback) {
      async.each(conceptMapName.group, (groups, nxtGrp) => {
        let element = groups.element.find(element => {
          return element.target[0].code == timrCode
        })
        if (element) {
          return callback(element.code)
        } else {
          return nxtGrp()
        }
      }, function () {
        return callback("")
      })
    },

    createPartialReport(partialReport, report) {
      for(let col in report.report) {
        if(report.report[col] === null || typeof report.report[col] != 'object') {
          partialReport[col] = report.report[col]
        }
      }
    },

    j_spring_security_check: function (orchestrations, callback) {
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
        body: postData
      }
      let before = new Date()
      request.post(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Spring Authentication', before, 'POST', options.url, postData, res, JSON.stringify(res.headers)))
        callback(err, res.headers)
      })
    },

    initializeReport: function (vimsFacId, periodId, orchestrations, callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/initialize/' + vimsFacId + '/82/' + periodId)
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
        } else
          return callback(false, body)
      })
    },

    getAllPeriods: function (vimsFacId, orchestrations, callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/periods/' + vimsFacId + '/82')
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
        } else
          return callback(false, body)
      })
    },

    getPeriod: function (vimsFacId, orchestrations, callback) {
      this.getAllPeriods(vimsFacId, orchestrations, (err, body) => {
        if (err) {
          return callback(err)
        }
        var periods = []
        if (body.indexOf('error') == -1) {
          body = JSON.parse(body)
          if (body.hasOwnProperty("periods") && body.periods.length < 1)
            return callback(err, periods)
          else if (!body.hasOwnProperty("periods"))
            return callback(periods)
          body.periods.forEach((period, index) => {
            if (period.id > 0 && (period.status == "DRAFT" || period.status == "REJECTED"))
              periods.push({
                'id': period.id,
                'periodName': period.periodName
              })
            if (index == body.periods.length - 1) {
              return callback(err, periods)
            }
          })
        } else {
          return callback(err, periods)
        }
      })
    },

    countPeriods: function (vimsFacId, orchestrations, callback) {
      this.getAllPeriods(vimsFacId, orchestrations, (err, body) => {
        if (err) {
          return callback(err)
        }
        try {
          body = JSON.parse(body)
        } catch (error) {
          winston.error(error)
          return callback()
        }
        if (!body.hasOwnProperty("periods")) {
          return callback(0, 0)
        }
        if (body.hasOwnProperty("periods") && body.periods.length < 1) {
          return callback(0, 0)
        }
        let totalDraft = 0
        let periodId, periodName
        async.each(body.periods, (period, nxtPer) => {
          if (period.id > 0 && (period.status == "DRAFT" || period.status == "REJECTED")) {
            periodId = period.id
            periodName = period.periodName
            totalDraft++
          }
          return nxtPer()
        }, () => {
          return callback(body.periods.length, totalDraft, periodId, periodName)
        })
      })
    },

    getFacilityWithLatestPeriod: function (facilities, callback) {
      // return callback([{"periodId":238898,"periodName":"January 2021","total":3}])
      let periods = []
      async.each(facilities, (facility, nxtFac) => {
        this.countPeriods(facility.vimsFacilityId, [], (total, totalDraft, periodId, periodName) => {
          if(!periodId || !periodName) {
            return nxtFac()
          }
          facility.periodId = periodId
          facility.periodName = periodName
          let periodExist = periods.find((capturedPeriod) => {
            return capturedPeriod.periodName === periodName
          })
          if (periodExist) {
            return nxtFac()
          }
          if (totalDraft > 0) {
            if (periods.length < 3) {
              let period = {}
              period.periodId = periodId
              period.periodName = periodName
              period.total = total
              periods.push(period)
              return nxtFac()
            } else {
              let periodDate1 = moment(periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
              let updated = false
              for(let index in periods) {
                let period = periods[index]
                let periodDate2 = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
                if (periodDate1 > periodDate2 && !updated) {
                  let newPeriod = {}
                  newPeriod.periodId = periodId
                  newPeriod.periodName = periodName
                  newPeriod.total = total
                  periods[index] = newPeriod
                  updated = true
                }
              }
              return nxtFac()
            }
          } else {
            return nxtFac()
          }
        })
      }, () => {
        return callback(periods)
      })
    },

    extractAgeGroups: function (lineItems) {
      let ageGroups = []
      return new Promise((resolve, reject) => {
        async.eachSeries(lineItems, (lineItem, nxtLineitem) => {
          let exists = ageGroups.find((ageGroup) => {
            return ageGroup === lineItem.ageGroup
          })
          if (!exists) {
            ageGroups.push(lineItem.ageGroup)
          }
          return nxtLineitem()
        }, () => {
          return resolve(ageGroups)
        })
      })
    },

    getValueSets: function (valueSetName, callback) {
      var concept = valueSetName.compose.include[0].concept
      var valueSets = []
      async.each(concept, (code, nxtConcept) => {
        valueSets.push({
          'code': code.code
        })
        return nxtConcept()
      }, function () {
        return callback('', valueSets)
      })
    },

    getTimrItemCode: function (vimsItemCode, callback) {
      timrVimsItems.group.forEach((groups) => {
        groups.element.forEach((element) => {
          if (element.code == vimsItemCode) {
            element.target.forEach((target) => {
              callback(target.code)
            })
          }
        })
      })
    },

    getReport: function (id, orchestrations, callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/get/' + id + '.json')
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }

      run((err, report) => {
        return callback(err, report)
      })

      function run (cb) {
        let before = new Date()
        request.get(options, (err, res, body) => {
          if (!isJSON(body) || err) {
            winston.error("Invalid Report Returned By VIMS, retrying")
            run((err, body) => {
              return cb(err, body)
            })
          }else {
            orchestrations.push(utils.buildOrchestration('Get VIMS Report', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
            return cb(err, JSON.parse(body))
          }
        })
      }
    },

    saveVIMSReport: function(updatedReport, name, orchestrations, callback) {
      var url = URI(vimsconfig.url).segment('rest-api/ivd/saveArray')
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth
        },
        json: updatedReport
      }
      let before = new Date()
      request.put(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Updating VIMS ' + name, before, 'PUT', url.toString(), updatedReport, res, JSON.stringify(body)))
        if (err) {
          winston.error(err)
          return callback(err, res, body)
        } else
          return callback(err, res, body)
      })
    },

    populateImmLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let covLineItemIndex in report.report.coverageLineItems) {
        let covLineItem = report.report.coverageLineItems[covLineItemIndex]
        let vimsProductId = covLineItem.productId
        let timrProductId
        this.getTimrCode(vimsProductId, timrVimsDwhImmConceptMap, code => {
          timrProductId = code
        })

        let vimsDoseId = covLineItem.doseId
        let timrDoseId
        if (vimsProductId == '2413' || vimsProductId == '2412') {
          timrDoseId = vimsDoseId - 1
        } else {
          timrDoseId = vimsDoseId
        }

        let updated = false
        /** Treat TT data differently because of the disaggregation by PregnantWomen,Newborns,InjuredPersons
         * Stop summing once VIMS has added this disaggregation
         * Below are timr disaggregation
         * "Concept (K:07898ff6-64f3-11e9-a923-1681be663d3e, V:c6a115ec-b2be-4ec1-b8e1-fd1120a911ad) [M: PopulationType-Newborns]"
         * "Concept (K:078992da-64f3-11e9-a923-1681be663d3e, V:a2608645-2648-4524-83fd-3fce315d6a6a) [M: PopulationType-InjuredPersons]"
         * "Concept (K:0789944c-64f3-11e9-a923-1681be663d3e, V:e6b6dcad-8cda-477b-be70-5fbf5f05464f) [M: PopulationType-PregnantWomen]"
         */
        if (vimsProductId == '2418') {
          let maleValueData = facData.filter((data) => {
            return data.gender_mnemonic == 'Male' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
          })
          let femaleValueData = facData.filter((data) => {
            return data.gender_mnemonic == 'Female' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
          })
          if (maleValueData.length > 0) {
            updated = true
            let totalregular = 0
            let totalCampaign = 0
            let totalOutreach = 0
            maleValueData.forEach((data) => {
              if (data.typ_mnemonic === 'ActType-TimrFixedSession') {
                totalregular += parseInt(data.in_service_area)
              } else if (data.typ_mnemonic === 'ActType-TimrOutreachSession') {
                totalCampaign += parseInt(data.in_service_area)
              }
              totalOutreach = parseInt(data.in_catchment)
            })
            report.report.coverageLineItems[covLineItemIndex].regularMale = totalregular
            report.report.coverageLineItems[covLineItemIndex].campaignMale = totalCampaign
            report.report.coverageLineItems[covLineItemIndex].outreachMale = totalOutreach
          }
          if (femaleValueData.length > 0) {
            updated = true
            let totalregular = 0
            let totalCampaign = 0
            let totalOutreach = 0
            femaleValueData.forEach((data) => {
              if (data.typ_mnemonic === 'ActType-TimrFixedSession') {
                totalregular += parseInt(data.in_service_area)
              } else if (data.typ_mnemonic === 'ActType-TimrOutreachSession') {
                totalCampaign += parseInt(data.in_service_area)
              }
              totalOutreach = parseInt(data.in_catchment)
            })
            report.report.coverageLineItems[covLineItemIndex].regularFemale = totalregular
            report.report.coverageLineItems[covLineItemIndex].campaignFemale = totalCampaign
            report.report.coverageLineItems[covLineItemIndex].outreachFemale = totalOutreach
          }
        } else {
          let maleValueData = facData.filter((data) => {
            return data.gender_mnemonic == 'Male' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
          })
          let femaleValueData = facData.filter((data) => {
            return data.gender_mnemonic == 'Female' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
          })
          if (maleValueData) {
            updated = true
            let regular = 0
            let campaign = 0
            let outreach = 0
            for(let mValue of maleValueData) {
              outreach += parseInt(mValue.in_catchment)
              if(mValue.typ_mnemonic === 'ActType-TimrFixedSession') {
                regular += parseInt(mValue.in_service_area)
              }
              if(mValue.typ_mnemonic === 'ActType-TimrOutreachSession') {
                campaign += parseInt(mValue.in_service_area)
              }
            }
            report.report.coverageLineItems[covLineItemIndex].regularMale = regular
            report.report.coverageLineItems[covLineItemIndex].regularOutReachMale = campaign
            report.report.coverageLineItems[covLineItemIndex].outreachMale = outreach
          }
          if (femaleValueData) {
            updated = true
            let regular = 0
            let campaign = 0
            let outreach = 0
            for(let fValue of femaleValueData) {
              outreach += parseInt(fValue.in_catchment)
              if(fValue.typ_mnemonic === 'ActType-TimrFixedSession') {
                regular += parseInt(fValue.in_service_area)
              }
              if(fValue.typ_mnemonic === 'ActType-TimrOutreachSession') {
                campaign += parseInt(fValue.in_service_area)
              }
            }
            report.report.coverageLineItems[covLineItemIndex].regularFemale = regular
            report.report.coverageLineItems[covLineItemIndex].regularOutReachFeMale = campaign
            report.report.coverageLineItems[covLineItemIndex].outreachFemale = outreach
          }
        }
        if (!updated) {
          continue
        }
        winston.info("Generated Immunization Coverage For Product " + covLineItem.product.primaryName + " Dose " + vimsDoseId + " " +
          JSON.stringify({
            regularMale: report.report.coverageLineItems[covLineItemIndex].regularMale,
            regularFemale: report.report.coverageLineItems[covLineItemIndex].regularFemale,
            regularOutReachMale: report.report.coverageLineItems[covLineItemIndex].regularOutReachMale,
            regularOutReachFeMale: report.report.coverageLineItems[covLineItemIndex].regularOutReachFeMale,
            outreachMale: report.report.coverageLineItems[covLineItemIndex].outreachMale,
            outreachFemale: report.report.coverageLineItems[covLineItemIndex].outreachFemale
          }))
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "coverageLineItems": report.report.coverageLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateImmCoverAgeGrpLineItem: function (facData, facility, vimsAgeGroup, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let lineItemIndex in report.report.coverageAgeGroupLineItems) {
        let lineItem = report.report.coverageAgeGroupLineItems[lineItemIndex]
        if (lineItem.ageGroup === vimsAgeGroup) {
          let vimsProductId = lineItem.productId
          let timrProductId
          this.getTimrCode(vimsProductId, timrVimsDwhImmConceptMap, code => {
            timrProductId = code
          })

          let vimsDoseId = lineItem.doseId
          let timrDoseId
          if (vimsProductId == '2413' || vimsProductId == '2412') {
            timrDoseId = vimsDoseId - 1
          } else {
            timrDoseId = vimsDoseId
          }

          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
          })

          if (maleValueData) {
            let regular = maleValueData.in_service_area
            let outreach = maleValueData.in_catchment
            report.report.coverageAgeGroupLineItems[lineItemIndex].regularMale = regular
            report.report.coverageAgeGroupLineItems[lineItemIndex].outreachMale = outreach
          }
          if (femaleValueData) {
            let regular = femaleValueData.in_service_area
            let outreach = femaleValueData.in_catchment
            report.report.coverageAgeGroupLineItems[lineItemIndex].regularFemale = regular
            report.report.coverageAgeGroupLineItems[lineItemIndex].outreachFemale = outreach
          }
          if (!maleValueData && !femaleValueData) {
            continue
          }
          winston.info("Saving Immunization Coverage By Age Product " + lineItem.product.primaryName + " Dose " + vimsDoseId + " " +
            JSON.stringify({
              regularMale: lineItem.regularMale,
              regularFemale: lineItem.regularFemale,
              outreachMale: lineItem.outreachMale,
              outreachFemale: lineItem.outreachFemale
            }))
        }
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "coverageAgeGroupLineItems": report.report.coverageAgeGroupLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    extractValuesFromAgeGroup: function (values, ageGroupID, callback) {
      var mergedValues = []
      async.eachSeries(values, (value, nxtValue) => {
        if (Object.keys(value)[0] == ageGroupID) {
          if (mergedValues.length == 0)
            mergedValues.push({
              [value[ageGroupID].gender]: value[ageGroupID].value
            })
          else
            mergedValues[(mergedValues.length - 1)][value[ageGroupID].gender] = value[ageGroupID].value
          nxtValue()
        } else
          nxtValue()
      }, function () {
        return callback(mergedValues)
      })
    },

    populateSuppLineItem: function (facData, facility, vimsAgeGroup, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let supptLineItemIndex in report.report.vitaminSupplementationLineItems) {
        let suppLineItem = report.report.vitaminSupplementationLineItems[supptLineItemIndex]
        if (suppLineItem.ageGroup === vimsAgeGroup) {
          let supplementCode
          if (suppLineItem.vitaminName == "Vitamin A") {
            supplementCode = 'Supplement-VitaminA'
          } else if (suppLineItem.vitaminName == "Mebendazole") {
            supplementCode = 'Supplement-Mebendazole'
          } else {
            winston.error("Unknown code found on Vitamin line item " + JSON.stringify(suppLineItem))
            continue
          }

          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male' && data.code == supplementCode
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female' && data.code == supplementCode
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            report.report.vitaminSupplementationLineItems[supptLineItemIndex].maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            report.report.vitaminSupplementationLineItems[supptLineItemIndex].femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            continue
          }
          winston.info("Saving Supplements " + facility.facilityName + " " + JSON.stringify({
            maleValue: report.report.vitaminSupplementationLineItems[supptLineItemIndex].maleValue,
            femaleValue: report.report.vitaminSupplementationLineItems[supptLineItemIndex].femaleValue,
            ageGroup: report.report.vitaminSupplementationLineItems[supptLineItemIndex].ageGroup
          }))
        }
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "vitaminSupplementationLineItems": report.report.vitaminSupplementationLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateAdverseEffectLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      async.eachSeries(facData, (data, nxtData) => {
        data.start_date = moment(data.start_date).format("YYYY-MM-DD")
        let vimsVaccCode
        this.getVimsCode(data.type_mnemonic, timrVimsDwhImmConceptMap, code => {
          vimsVaccCode = code
        })
        let AEFILineItemIndex = report.report.adverseEffectLineItems.findIndex((AEFILineItem) => {
          return AEFILineItem.productId == vimsVaccCode && AEFILineItem.date == data.start_date
        })
        let AEFILineItem
        if(AEFILineItemIndex != -1) {
          AEFILineItem = report.report.adverseEffectLineItems[AEFILineItemIndex]
        }
        if (AEFILineItem) {
          report.report.adverseEffectLineItems[AEFILineItemIndex].cases = data.total
          winston.info("Updating AEFI " + JSON.stringify({
            product: data.type_mnemonic,
            cases: report.report.adverseEffectLineItems[AEFILineItemIndex].cases,
            date: data.start_date
          }))
          return nxtData()
        } else {
          report.report.adverseEffectLineItems.push({
            "productId": vimsVaccCode,
            "date": data.start_date,
            "cases": data.total,
            "batch": "",
            "isInvestigated": true
          })
          winston.info("Saving New AEFI With " + JSON.stringify({
            product: data.type_mnemonic,
            cases: data.total,
            date: data.start_date
          }))
          return nxtData()
        }
      }, () => {
        let partialReport = {
          "id": report.report.id,
          "facilityId": report.report.facilityId,
          "periodId": report.report.periodId,
          "adverseEffectLineItems": report.report.adverseEffectLineItems
        }
        this.createPartialReport(partialReport, report)
        updatedLineItems.push(partialReport)
        return callback()
      })
    },

    populateDiseaseLineItems: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let lineItemIndex in report.report.diseaseLineItems) {
        let lineItem = report.report.diseaseLineItems[lineItemIndex]
        let diseaseCode
        if (lineItem.diseaseId == 1) {
          diseaseCode = 'DiagnosisCode-UnspecifiedFever'
        } else if (lineItem.diseaseId == 2) {
          diseaseCode = 'DiagnosisCode-FlaccidParaplegia'
        } else if (lineItem.diseaseId == 3) {
          diseaseCode = 'DiagnosisCode-NoenatalTetanus'
        }
        let caseValueData = facData.find((data) => {
          return data.typ_mnemonic == 'ObservationType-Problem' && data.prob_mnemonic == diseaseCode
        })
        let deathValueData = facData.find((data) => {
          return data.typ_mnemonic == 'ObservationType-CauseOfDeath' && data.prob_mnemonic == diseaseCode
        })
        if (caseValueData) {
          report.report.diseaseLineItems[lineItemIndex].cases = caseValueData.total
        }
        if (deathValueData) {
          report.report.diseaseLineItems[lineItemIndex].death = deathValueData.total
        }
        if (!caseValueData && !deathValueData) {
          continue
        }
        winston.info("Saving Disease " + lineItem.diseaseName + " " + JSON.stringify({
          case: lineItem.cases,
          death: lineItem.death
        }))
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "diseaseLineItems": report.report.diseaseLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateCTCReferalLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let lineItemIndex in report.report.ctcLineItems) {
        let lineItem = report.report.ctcLineItems[lineItemIndex]
        let maleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Male'
        })
        let femaleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Female'
        })
        if (maleValueData) {
          let maleValue = maleValueData.total
          report.report.ctcLineItems[lineItemIndex].maleValue = maleValue
        }
        if (femaleValueData) {
          let femaleValue = femaleValueData.total
          report.report.ctcLineItems[lineItemIndex].femaleValue = femaleValue
        }
        if (!maleValueData && !femaleValueData) {
          return nxtLineitem()
        }
        winston.info("Saving CTCReferal " + JSON.stringify({
          maleValue: lineItem.maleValue,
          femaleValue: lineItem.femaleValue
        }))
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "ctcLineItems": report.report.ctcLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateBreastFeedingLineItems: function (facData, facility, vimsAgeGroup, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let bfLineItemIndex in report.report.breastFeedingLineItems) {
        let bfLineItem = report.report.breastFeedingLineItems[bfLineItemIndex]
        if (bfLineItem.ageGroup === vimsAgeGroup) {
          let bfCode
          if (bfLineItem.category == "EBF") {
            bfCode = 1
          } else if (bfLineItem.category == "RF") {
            bfCode = 2
          }

          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male' && data.ext_value == bfCode
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female' && data.ext_value == bfCode
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            report.report.breastFeedingLineItems[bfLineItemIndex].maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            report.report.breastFeedingLineItems[bfLineItemIndex].femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            continue
          }
          winston.info("Saving Breast Feeding " + JSON.stringify({
            maleValue: bfLineItem.maleValue,
            femaleValue: bfLineItem.femaleValue,
            ageGroup: bfLineItem.ageGroup
          }))
        }
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "breastFeedingLineItems": report.report.breastFeedingLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateChildVisitLineItem: function (facData, facility, vimsAgeGroup, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let cvLineItemIndex in report.report.childVisitLineItems) {
        let cvLineItem = report.report.childVisitLineItems[cvLineItemIndex]
        if (cvLineItem.ageGroup === vimsAgeGroup) {
          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male'
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female'
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            report.report.childVisitLineItems[cvLineItemIndex].maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            report.report.childVisitLineItems[cvLineItemIndex].femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            continue
          }
          winston.info("Saving Child Visit " + JSON.stringify({
            maleValue: cvLineItem.maleValue,
            femaleValue: cvLineItem.femaleValue,
            ageGroup: cvLineItem.ageGroup
          }))
        }
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "childVisitLineItems": report.report.childVisitLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateWeightAgeRatioLineItem: function (facData, facility, vimsAgeGroup, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let ageWeightLineItemIndex in report.report.weightAgeRatioLineItems) {
        let warLineItem = report.report.weightAgeRatioLineItems[ageWeightLineItemIndex]
        if (warLineItem.ageGroup === vimsAgeGroup) {
          let weightageratiocode
          if (warLineItem.category == "80% - 2SD") {
            weightageratiocode = 'AbnormalHigh'
          } else if (warLineItem.category == "60% - 3SD") {
            weightageratiocode = 'AbnormalLow'
          } else if (warLineItem.category == "60%-80% - 2-3SD") {
            weightageratiocode = 'Normal'
          } else {
            winston.error("Unknown code found on Age Weight Ratio line item " + JSON.stringify(warLineItem))
            continue
          }

          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male' && data.code == weightageratiocode
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female' && data.code == weightageratiocode
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            report.report.weightAgeRatioLineItems[ageWeightLineItemIndex].maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            report.report.weightAgeRatioLineItems[ageWeightLineItemIndex].femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            continue
          }
          winston.info("Saving Weight Age Ratio " + JSON.stringify({
            maleValue: warLineItem.maleValue,
            femaleValue: warLineItem.femaleValue,
            ageGroup: warLineItem.ageGroup
          }))
        }
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "weightAgeRatioLineItems": report.report.weightAgeRatioLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateTTLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let ttLineItemIndex in report.report.ttStatusLineItems) {
        let ttLineitem = report.report.ttStatusLineItems[ttLineItemIndex]
        let ttcode
        if (ttLineitem.category == "Vaccinated") {
          ttcode = '2'
        } else if (ttLineitem.category == "Not Vaccinated") {
          ttcode = '1'
        } else if (ttLineitem.category == "Unknown") {
          ttcode = '0'
        } else {
          winston.error("Unknown code found on TT line item " + JSON.stringify(ttLineitem))
          continue
        }

        let maleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Male' && data.ext_value == ttcode
        })
        let femaleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Female' && data.ext_value == ttcode
        })
        if (maleValueData) {
          let maleValue = maleValueData.total
          report.report.ttStatusLineItems[ttLineItemIndex].maleValue = maleValue
        }
        if (femaleValueData) {
          let femaleValue = femaleValueData.total
          report.report.ttStatusLineItems[ttLineItemIndex].femaleValue = femaleValue
        }

        if (!maleValueData && !femaleValueData) {
          continue
        }

        winston.info("Saving TT " + JSON.stringify({
          maleValue: ttLineitem.maleValue,
          femaleValue: ttLineitem.femaleValue
        }))
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "ttStatusLineItems": report.report.ttStatusLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populatePMTCTLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let pmtctLineItemIndex in report.report.pmtctLineItems) {
        let pmtctLineItem = report.report.pmtctLineItems[pmtctLineItemIndex]
        let pmtctStatus
        if (pmtctLineItem.categoryId == 1) {
          pmtctStatus = 1
        } else if (pmtctLineItem.categoryId == 2) {
          pmtctStatus = 0
        }

        let maleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Male' && data.ext_value == pmtctStatus
        })
        let femaleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Female' && data.ext_value == pmtctStatus
        })
        if (maleValueData) {
          let maleValue = maleValueData.total
          report.report.pmtctLineItems[pmtctLineItemIndex].maleValue = maleValue
        }
        if (femaleValueData) {
          let femaleValue = femaleValueData.total
          report.report.pmtctLineItems[pmtctLineItemIndex].femaleValue = femaleValue
        }
        if (!maleValueData && !femaleValueData) {
          continue
        }
        winston.info("Saving PMTCT " + JSON.stringify({
          maleValue: pmtctLineItem.maleValue,
          femaleValue: pmtctLineItem.femaleValue
        }))
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "pmtctLineItems": report.report.pmtctLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateMosquitoNetLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      for(let mosquitoNetLineItemIndex in report.report.llInLineItemLists) {
        let mnLineItem = report.report.llInLineItemLists[mosquitoNetLineItemIndex]
        let maleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Male'
        })
        let femaleValueData = facData.find((data) => {
          return data.gender_mnemonic == 'Female'
        })
        if (maleValueData) {
          let maleValue = maleValueData.total
          report.report.llInLineItemLists[mosquitoNetLineItemIndex].maleValue = maleValue
        }
        if (femaleValueData) {
          let femaleValue = femaleValueData.total
          report.report.llInLineItemLists[mosquitoNetLineItemIndex].femaleValue = femaleValue
        }
        if (!maleValueData && !femaleValueData) {
          continue
        }
        winston.info("Saving Mosquito Data " + JSON.stringify({
          maleValue: mnLineItem.maleValue,
          femaleValue: mnLineItem.femaleValue
        }))
      }
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "llInLineItemLists": report.report.llInLineItemLists,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    populateColdChainLineItem: function (facData, report, callback) {
      if (facData.length > 1) {
        winston.error("Multiple cold chain data returned for stoping data sync")
        return callback()
      }
      for(let lineItemIndex in report.coldChainLineItems) {
        let lineItem = report.coldChainLineItems[lineItemIndex]
        let minTemp = facData[0].coldstoremintemp
        let maxTemp = facData[0].coldstoremaxtemp
        let lowTempAlert = facData[0].coldstorelowtempalert
        let highTempAlert = facData[0].coldstorehightempalert
        let timrStatusCode = facData[0].status
        let found = false
        if (!Number.isNaN(Number.parseFloat(minTemp))) {
          report.coldChainLineItems[lineItemIndex].minTemp = minTemp
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(maxTemp))) {
          report.coldChainLineItems[lineItemIndex].maxTemp = maxTemp
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(lowTempAlert))) {
          report.coldChainLineItems[lineItemIndex].minEpisodeTemp = lowTempAlert
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(highTempAlert))) {
          report.coldChainLineItems[lineItemIndex].maxEpisodeTemp = highTempAlert
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(timrStatusCode))) {
          let vimsStatusCode
          if (timrStatusCode == 1) {
            vimsStatusCode = 10
          } else if (timrStatusCode == 0) {
            vimsStatusCode = 12
          }
          if (vimsStatusCode) {
            report.coldChainLineItems[lineItemIndex].operationalStatusId = vimsStatusCode
            found = true
          }
        }

        if (!found) {
          continue
        }
        winston.info("Saving Cold Chain " + JSON.stringify({
          minTemp: lineItem.minTemp,
          maxTemp: lineItem.maxTemp,
          minEpisodeTemp: lineItem.minEpisodeTemp,
          maxEpisodeTemp: lineItem.maxEpisodeTemp,
          status: lineItem.operationalStatusId
        }))
      }
      return callback()
    },

    populateSessionsDataLineItem: function (facData, report, callback) {
      if (facData.length > 1) {
        winston.error("Multiple Session data returned for stoping data sync")
        return callback()
      }
      let outreachPlan = facData[0].outreachplanned
      let outreach = facData[0].outreachperformed
      let outreachCancel = facData[0].outreachcancelled
      let sessions = facData[0].sessions
      let found = false
      if (!Number.isNaN(Number.parseFloat(outreachPlan))) {
        report.plannedOutreachImmunizationSessions = outreachPlan
        found = true
      }
      if (!Number.isNaN(Number.parseFloat(outreach))) {
        report.outreachImmunizationSessions = outreach
        found = true
      }
      if (!Number.isNaN(Number.parseFloat(outreachCancel))) {
        report.outreachImmunizationSessionsCanceled = outreachCancel
        found = true
      }
      if (!Number.isNaN(Number.parseFloat(sessions))) {
        report.fixedImmunizationSessions = sessions
        found = true
      }
      if (!found) {
        return callback()
      }
      winston.info("Saving Session " + JSON.stringify({
        outreachPlanned: report.plannedOutreachImmunizationSessions,
        outreachPerformed: report.outreachImmunizationSessions,
        outreachCancelled: report.outreachImmunizationSessionsCanceled,
        sessions: report.fixedImmunizationSessions
      }))
      return callback()
    },

    populateStockONHANDLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      async.each(facData, (data, nxtData) => {
        let vimsVaccCode
        this.getVimsCode(data.type_mnemonic, timrVimsDwhImmConceptMap, code => {
          vimsVaccCode = code
        })
        let logisticsLineItemIndex = report.report.logisticsLineItems.findIndex((lineItem) => {
          return lineItem.productId == vimsVaccCode
        })
        let logisticsLineItem
        if(logisticsLineItemIndex != -1) {
          logisticsLineItem = report.report.logisticsLineItems[logisticsLineItemIndex]
        }
        if (logisticsLineItem) {
          report.report.logisticsLineItems[logisticsLineItemIndex].closingBalance = data.balance_eom
          winston.info("Updating Stock ON_HAND " + JSON.stringify({
            product: data.type_mnemonic,
            ON_HAND: logisticsLineItem.closingBalance
          }))
          return nxtData()
        } else {
          return nxtData()
        }
      }, () => {
        let partialReport = {
          "id": report.report.id,
          "facilityId": report.report.facilityId,
          "periodId": report.report.periodId,
          "logisticsLineItems": report.report.logisticsLineItems,
          "adverseEffectLineItems": report.report.adverseEffectLineItems
        }
        this.createPartialReport(partialReport, report)
        updatedLineItems.push(partialReport)
        return callback()
      })
    },

    populateStockAdjustmentsLineItem: function (facData, facility, updatedLineItems, orchestrations, callback) {
      let report = facility.report
      if (!report) {
        return callback()
      }
      async.each(facData, (data, nxtData) => {
        let vimsVaccCode
        this.getVimsCode(data.type_mnemonic, timrVimsDwhImmConceptMap, code => {
          vimsVaccCode = code
        })
        let logisticsLineItemIndex = report.report.logisticsLineItems.findIndex((lineItem) => {
          return lineItem.productId == vimsVaccCode
        })

        if (logisticsLineItemIndex != -1) {
          /*
          currently vims combines quantityExpired,quantityWastedOther,quantityFreezed and quantityVvmAlerted
          into quantityDiscardedUnopened,so we are also combining them until when vims accepts them separately
          */
          let found = false
          let discardedUnopened = 0
          if (!Number.isNaN(Number.parseInt(data['REASON-Expired']))) {
            report.report.logisticsLineItems[logisticsLineItemIndex].quantityExpired = parseInt(data['REASON-Expired'])
            discardedUnopened += parseInt(data['REASON-Expired'])
            found = true
          }
          if (!Number.isNaN(Number.parseInt(data['REASON-Broken']))) {
            discardedUnopened += parseInt(data['REASON-Broken'])
            found = true
          }
          if (!Number.isNaN(Number.parseInt(data['REASON-Wasted']))) {
            report.report.logisticsLineItems[logisticsLineItemIndex].quantityWastedOther = parseInt(data['REASON-Wasted'])
            discardedUnopened += parseInt(data['REASON-Wasted'])
            found = true
          }
          if (!Number.isNaN(Number.parseInt(data['REASON-VVM']))) {
            report.report.logisticsLineItems[logisticsLineItemIndex].quantityVvmAlerted = parseInt(data['REASON-VVM'])
            discardedUnopened += parseInt(data['REASON-VVM'])
            found = true
          }
          if (!Number.isNaN(Number.parseInt(data['REASON-FROZEN']))) {
            report.report.logisticsLineItems[logisticsLineItemIndex].quantityFreezed = parseInt(data['REASON-FROZEN'])
            discardedUnopened += parseInt(data['REASON-FROZEN'])
            found = true
          }

          report.report.logisticsLineItems[logisticsLineItemIndex].quantityDiscardedUnopened = discardedUnopened
          if (!Number.isNaN(Number.parseInt(data['REASON-OPENWASTE']))) {
            report.report.logisticsLineItems[logisticsLineItemIndex].quantityDiscardedOpened = data['REASON-OPENWASTE']
            found = true
          }
          winston.info("Updating Stock Adjustments " + JSON.stringify({
            product: data.type_mnemonic,
            'Discarded Opened': report.report.logisticsLineItems[logisticsLineItemIndex].quantityDiscardedOpened,
            'Discarded UnOpened': report.report.logisticsLineItems[logisticsLineItemIndex].quantityDiscardedUnopened
          }))
          return nxtData()
        } else {
          return nxtData()
        }
      }, () => {
        let partialReport = {
          "id": report.report.id,
          "facilityId": report.report.facilityId,
          "periodId": report.report.periodId,
          "logisticsLineItems": report.report.logisticsLineItems,
          "adverseEffectLineItems": report.report.adverseEffectLineItems
        }
        this.createPartialReport(partialReport, report)
        updatedLineItems.push(partialReport)
        return callback()
      })
    },

    saveStockData: function (period, timrStockData, stockCodes, vimsItemCode, updatedLineItems, orchestrations, callback) {
      /**
        push stock report to VIMS
      */
      if (stockCodes.length == 0) {
        return callback()
      }
      period.forEach((period) => {
        let report = facility.report
        if (!report) {
          return callback()
        }
        var found = false
        report.report.logisticsLineItems.forEach((logisticsLineItems, index) => {
          if (logisticsLineItems.productId == vimsItemCode) {
            found = true
            /*
            currently vims combines quantityExpired,quantityWastedOther,quantityFreezed and quantityVvmAlerted
            into quantityDiscardedUnopened,so we are also combining them until when vims accepts them separately
            */
            var discarded = 0
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "ON_HAND"
              }) != undefined) {
              report.report.logisticsLineItems[index].closingBalance = timrStockData[(vimsItemCode + "ON_HAND")].quantity
            }
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "EXPIRED"
              }) != undefined) {
              //report.report.logisticsLineItems[index].quantityExpired = timrStockData[(vimsItemCode+"EXPIRED")].quantity
              discarded = Number(discarded) + Number(timrStockData[(vimsItemCode + "EXPIRED")].quantity)
            }
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "DAMAGED"
              }) != undefined) {
              //report.report.logisticsLineItems[index].quantityDiscardedUnopened = timrStockData[(vimsItemCode+"DAMAGED")].quantity
              discarded = Number(discarded) + Number(timrStockData[(vimsItemCode + "DAMAGED")].quantity)
            }
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "WASTED"
              }) != undefined) {
              //report.report.logisticsLineItems[index].quantityWastedOther = timrStockData[(vimsItemCode+"WASTED")].quantity
              discarded = Number(discarded) + Number(timrStockData[(vimsItemCode + "WASTED")].quantity)
            }
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "REASON-VVM"
              }) != undefined) {
              //report.report.logisticsLineItems[index].quantityVvmAlerted = timrStockData[(vimsItemCode+"REASON-VVM")].quantity
              discarded = Number(discarded) + Number(timrStockData[(vimsItemCode + "REASON-VVM")].quantity)
            }
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "REASON-FROZEN"
              }) != undefined) {
              //report.report.logisticsLineItems[index].quantityFreezed = timrStockData[(vimsItemCode+"REASON-FROZEN")].quantity
              discarded = Number(discarded) + Number(timrStockData[(vimsItemCode + "REASON-FROZEN")].quantity)
            }
            if (stockCodes.find(stockCode => {
                return stockCode.code == vimsItemCode + "REASON-OPENWASTE"
              }) != undefined) {
              report.report.logisticsLineItems[index].quantityDiscardedOpened = timrStockData[(vimsItemCode + "REASON-OPENWASTE")].quantity
            }
            report.report.logisticsLineItems[index].quantityDiscardedUnopened = discarded
          }
        })
      })
      let partialReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "logisticsLineItems": report.report.logisticsLineItems,
        "adverseEffectLineItems": report.report.adverseEffectLineItems
      }
      this.createPartialReport(partialReport, report)
      updatedLineItems.push(partialReport)
      return callback()
    },

    convertDistributionToGS1: function (distribution, orchestrations, callback) {
      distribution = JSON.parse(distribution)
      var me = this
      if (distribution !== null && distribution !== undefined) {
        fs.readFile('./despatchAdviceBaseMessage.xml', 'utf8', function (err, data) {
          var timrToFacilityId = null
          var timrFromFacilityId = null
          var fromFacilityName = null
          var distributionDate = distribution.distributionDate
          var creationDate = moment().format()
          var distributionId = distribution.id
          fhir.getFacilityUUIDFromVimsId(distribution.toFacilityId, orchestrations, (err, facId, facName) => {
            if (err) {
              winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
              return callback(err, "")
            }
            if (facId == false) {
              err = true
              winston.error("VIMS Facility with ID " + distribution.toFacilityId + " Was not found on the system,stop processing")
              return callback(err)
            }
            var toFacilityName = facName
            var timrToFacilityId = facId
            fhir.getFacilityUUIDFromVimsId(distribution.fromFacilityId, orchestrations, (err, facId1, facName1) => {
              if (err) {
                winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
                return callback(err, "")
              }
              if (facId1 == false || facId1 == null || facId1 == undefined) {
                err = true
                winston.error("VIMS Facility with ID " + distribution.fromFacilityId + " Was not found on the system,stop processing")
                return callback(err)
              }
              winston.info(`Sending Distribution From ${facName1} To ${facName}`)
              fromFacilityName = facName1
              timrFromFacilityId = facId1
              var despatchAdviceBaseMessage = util.format(data, timrToFacilityId, timrFromFacilityId, fromFacilityName, distributionDate, distributionId, timrToFacilityId, timrFromFacilityId, timrToFacilityId, distributionDate, creationDate)
              async.eachSeries(distribution.lineItems, function (lineItems, nextlineItems) {
                // if this is not safety box and lot is empty then ignore
                if (lineItems.product.id !== 2426 && lineItems.lots.length === 0) {
                  return nextlineItems()
                }
                if (lineItems.lots.length > 0) {
                  async.eachSeries(lineItems.lots, function (lot, nextLot) {
                    fs.readFile('./despatchAdviceLineItem.xml', 'utf8', function (err, data) {
                      var lotQuantity = lot.quantity
                      var lotId = lot.lotId
                      var gtin = lineItems.product.gtin
                      var vims_item_id = lineItems.product.id
                      var item_name = lineItems.product.fullName
                      if (item_name == null)
                        var item_name = lineItems.product.primaryName
                      var timr_item_id = 0
                      me.getTimrItemCode(vims_item_id, id => {
                        timr_item_id = id
                      })
                      var lotCode = lot.lot.lotCode
                      var expirationDate = lot.lot.expirationDate
                      var dosesPerDispensingUnit = lineItems.product.dosesPerDispensingUnit
                      if (isNaN(timr_item_id)) {
                        var codeListVersion = "OpenIZ-MaterialType"
                      } else {
                        var codeListVersion = "CVX"
                      }
                      var despatchAdviceLineItem = util.format(data, lotQuantity, lotId, gtin, vims_item_id, item_name, codeListVersion, timr_item_id, lotCode, expirationDate, dosesPerDispensingUnit)
                      despatchAdviceBaseMessage = util.format(despatchAdviceBaseMessage, despatchAdviceLineItem)
                      nextLot()
                    })
                  }, function () {
                    return nextlineItems()
                  })
                } else {
                  fs.readFile('./despatchAdviceLineItem.xml', 'utf8', function (err, data) {
                    var lotQuantity = lineItems.quantity
                    var lotId = "UNKNOWN"
                    if (lineItems.product.hasOwnProperty("gtin"))
                      var gtin = lineItems.product.gtin
                    else
                      var gtin = "UNKNOWN"
                    var vims_item_id = lineItems.product.id
                    if (lineItems.product.hasOwnProperty("fullName"))
                      var item_name = lineItems.product.fullName
                    else if (lineItems.product.hasOwnProperty("primaryName"))
                      var item_name = lineItems.product.primaryName
                    else
                      var item_name = ""
                    var timr_item_id = 0
                    me.getTimrItemCode(vims_item_id, (id) => {
                      timr_item_id = id
                    })
                    var lotCode = "UNKNOWN"
                    //create a fake expire date
                    var expirationDate = moment().month(4).format("YYYY-MM-DD")
                    var dosesPerDispensingUnit = lineItems.product.dosesPerDispensingUnit
                    if (isNaN(timr_item_id)) {
                      var codeListVersion = "OpenIZ-MaterialType"
                    } else {
                      var codeListVersion = "CVX"
                    }
                    var despatchAdviceLineItem = util.format(data, lotQuantity, lotId, gtin, vims_item_id, item_name, codeListVersion, timr_item_id, lotCode, expirationDate, dosesPerDispensingUnit)
                    despatchAdviceBaseMessage = util.format(despatchAdviceBaseMessage, despatchAdviceLineItem)
                    return nextlineItems()
                  })
                }
              }, function () {
                despatchAdviceBaseMessage = despatchAdviceBaseMessage.replace("%s", "")
                if (timrToFacilityId)
                  callback(err, despatchAdviceBaseMessage)
                else {
                  err = true
                  winston.warn("TImR Facility ID is Missing,skip sending Despatch Advise")
                  callback(err, "")
                }
              })
            })
          })
        })
      } else {
        winston.error("Invalid Distribution Passed For Conversion")
        //returning true to error
        callback(true, "")
      }
    },

    checkDistribution: function (vimsFacilityId, orchestrations, callback) {
      this.j_spring_security_check(orchestrations, (err, header) => {
        var url = URI(vimsconfig.url).segment("vaccine/inventory/distribution/distribution-supervisorid/" + vimsFacilityId)
        var options = {
          url: url.toString(),
          headers: {
            Cookie: header["set-cookie"]
          }
        }
        let before = new Date()
        request.get(options, (err, res, body) => {
          if (err) {
            winston.error("An Error has occured while checking stock distribution on VIMS")
            return callback(err)
          }
          orchestrations.push(utils.buildOrchestration('Get Stock Distribution From VIMS', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
          if (isJSON(body)) {
            var distribution = JSON.parse(body).distribution
            return callback(err, distribution)
          } else {
            winston.error("VIMS has returned non JSON results,skip processing")
            return callback()
          }
        })
      })
    },

    sendReceivingAdvice: function (distribution, orchestrations, callback) {
      this.j_spring_security_check(orchestrations, (err, header) => {
        var url = URI(vimsconfig.url).segment('vaccine/inventory/distribution/save.json')
        var options = {
          url: url.toString(),
          headers: {
            'Content-Type': 'application/json',
            Cookie: header["set-cookie"]
          },
          json: distribution
        }

        let before = new Date()
        request.post(options, function (err, res, body) {
          orchestrations.push(utils.buildOrchestration('Send Receiving Advice To VIMS', before, 'POST', url.toString(), JSON.stringify(distribution), res, JSON.stringify(body)))
          if (err) {
            return callback(err)
          } else
            callback(body)
        })
      })
    }
  }
}