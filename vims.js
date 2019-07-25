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
var Spinner = require('cli-spinner').Spinner
const timrVimsItems = require('./terminologies/timr-vims-items-conceptmap.json')
const timrVimsDwhImmConceptMap = require('./terminologies/timr-vims-dwh-immunization-conceptmap.json')
module.exports = function (vimscnf, oimcnf, timrcnf) {
  const vimsconfig = vimscnf
  const oim = OIM(oimcnf)

  function getTimrCode(vimsCode, conceptMapName, callback) {
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
  }

  function getVimsCode(timrCode, conceptMapName, callback) {
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
  }

  function saveVIMSReport(updatedReport, name, orchestrations, callback) {
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
  }

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
            var systemMonth = moment(period.periodName, 'MMM YYYY', 'en').format('MM')
            var prevMonth = moment().subtract(1, 'month').format('MM')
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
      let periods = []
      async.each(facilities, (facility, nxtFac) => {
        this.countPeriods(facility.vimsFacilityId, [], (total, totalDraft, periodId, periodName) => {
          facility.periodId = periodId
          facility.periodName = periodName
          let periodExist = periods.find((capturedPeriod) => {
            return capturedPeriod.periodName === periodName
          })
          if (periodExist) {
            return nxtFac()
          }
          if (totalDraft > 0) {
            if (periods.length < 2) {
              let period = {}
              period.periodId = periodId
              period.periodName = periodName
              period.total = total
              periods.push(period)
              return nxtFac()
            } else {
              let periodDate1 = moment(periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
              let updated = false
              async.eachOfSeries(periods, (period, index, nxtPeriod) => {
                let periodDate2 = moment(period.periodName, "MMM YYYY").startOf('month').format("YYYY-MM-DD")
                if (periodDate1 > periodDate2 && !updated) {
                  let newPeriod = {}
                  newPeriod.periodId = periodId
                  newPeriod.periodName = periodName
                  newPeriod.total = total
                  periods[index] = newPeriod
                  updated = true
                  return nxtPeriod()
                } else {
                  return nxtPeriod()
                }
              }, () => {
                return nxtFac()
              })
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

      let before = new Date()
      request.get(options, (err, res, body) => {
        if (!isJSON(body)) {
          winston.error("Invalid Report Returned By VIMS,stop processing")
          return callback(true, false)
        }
        orchestrations.push(utils.buildOrchestration('Get VIMS Report', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        if (err) {
          return callback(err)
        } else
          return callback(err, JSON.parse(body))
      })
    },

    saveImmunizationData: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.coverageLineItems, (covLineItem, covLineItemIndex, nxtCovLineitem) => {
          let vimsProductId = covLineItem.productId
          let timrProductId
          getTimrCode(vimsProductId, timrVimsDwhImmConceptMap, code => {
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
              let totalOutreach = 0
              maleValueData.forEach((data) => {
                totalregular += parseInt(data.in_service_area)
                totalOutreach = parseInt(data.in_catchment)
              })
              covLineItem.regularMale = totalregular
              covLineItem.outreachMale = totalOutreach
            }
            if (femaleValueData.length > 0) {
              updated = true
              let totalregular = 0
              let totalOutreach = 0
              femaleValueData.forEach((data) => {
                totalregular += parseInt(data.in_service_area)
                totalOutreach = parseInt(data.in_catchment)
              })
              covLineItem.regularFemale = totalregular
              covLineItem.outreachFemale = totalOutreach
            }
          } else {
            let maleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Male' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
            })
            let femaleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Female' && data.seq_id == timrDoseId && data.type_mnemonic == timrProductId
            })

            if (maleValueData) {
              updated = true
              let regular = maleValueData.in_service_area
              let outreach = maleValueData.in_catchment
              covLineItem.regularMale = regular
              covLineItem.outreachMale = outreach
            }
            if (femaleValueData) {
              updated = true
              let regular = femaleValueData.in_service_area
              let outreach = femaleValueData.in_catchment
              covLineItem.regularFemale = regular
              covLineItem.outreachFemale = outreach
            }
          }
          if (!updated) {
            return nxtCovLineitem()
          }
          winston.info("Saving Immunization Coverage Product " + covLineItem.product.primaryName + " Dose " + vimsDoseId + " " +
            JSON.stringify({
              regularMale: covLineItem.regularMale,
              regularFemale: covLineItem.regularFemale,
              outreachMale: covLineItem.outreachMale,
              outreachFemale: covLineItem.outreachFemale
            }))
          var updatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "coverageLineItems": [report.report.coverageLineItems[covLineItemIndex]]
          }
          saveVIMSReport(updatedReport, "Immunization Coverage", orchestrations, (err, res, body) => {
            if (err) {
              winston.error(err)
            }
          })
          return nxtCovLineitem()
        }, () => {
          return callback()
        })
      })
    },

    saveImmCoverAgeGrp: function (facData, facility, vimsAgeGroup, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.coverageAgeGroupLineItems, (lineItem, lineItemIndex, nxtLineItem) => {
          if (lineItem.ageGroup === vimsAgeGroup) {
            let vimsProductId = lineItem.productId
            let timrProductId
            getTimrCode(vimsProductId, timrVimsDwhImmConceptMap, code => {
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
              lineItem.regularMale = regular
              lineItem.outreachMale = outreach
            }
            if (femaleValueData) {
              let regular = femaleValueData.in_service_area
              let outreach = femaleValueData.in_catchment
              lineItem.regularFemale = regular
              lineItem.outreachFemale = outreach
            }
            if (!maleValueData && !femaleValueData) {
              return nxtLineItem()
            }
            winston.info("Saving Immunization Coverage By Age Product " + lineItem.product.primaryName + " Dose " + vimsDoseId + " " +
              JSON.stringify({
                regularMale: lineItem.regularMale,
                regularFemale: lineItem.regularFemale,
                outreachMale: lineItem.outreachMale,
                outreachFemale: lineItem.outreachFemale
              }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "coverageAgeGroupLineItems": [report.report.coverageAgeGroupLineItems[lineItemIndex]]
            }
            saveVIMSReport(updatedReport, "coverageAgeGroupLineItems", orchestrations, (err, res, body) => {

            })
            return nxtLineItem()
          } else {
            return nxtLineItem()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveImmCoverAgeGrpDel: function (period, timrFacilityId, facilityName, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var cagLineItemIndex = 0
          async.eachSeries(report.report.coverageAgeGroupLineItems, (cagLineItem, nxtCagLineItem) => {
            timr.getTimrCode(cagLineItem.productId, timrVimsDwhImmConceptMap, (timrVaccCode) => {
              if (cagLineItem.displayName = "Dose 0") {
                var timrDoseId = 0
              } else if (cagLineItem.displayName = "Dose 1") {
                var timrDoseId = 1
              } else if (cagLineItem.displayName = "Dose 2") {
                var timrDoseId = 2
              } else if (cagLineItem.displayName = "Dose 3") {
                var timrDoseId = 3
              } else if (cagLineItem.displayName = "Dose 4") {
                var timrDoseId = 4
              } else if (cagLineItem.displayName = "Dose 5") {
                var timrDoseId = 5
              } else {
                winston.error("Unknown Dose Found,skip processing lineItem Category " + JSON.stringify(cagLineItem))
                  ++cagLineItemIndex
                return nxtCagLineItem()
              }
              translateAgeGroup(cagLineItem.ageGroupName, (ages, err) => {
                if (err) {
                  winston.error(err + JSON.stringify(cagLineItem.ageGroupName))
                    ++cagLineItemIndex
                  return nxtCagLineItem()
                } else {
                  createQueryOnAge(ages, false, period, (ageQueries) => {
                    var gndrCatchment = {
                      "Male": ["regular", "outreach"],
                      "Female": ["regular", "outreach"]
                    }

                    winston.info("Getting Immunization Coverage By Age Group Data - " + cagLineItem.ageGroupName)
                    var spinner = new Spinner("Receiving Immunization Coverage By Age Group Data - " + cagLineItem.ageGroupName)
                    spinner.setSpinnerString(8);
                    spinner.start()
                    async.eachOfSeries(gndrCatchment, (catchment, gender, nxtGndrCatchment) => {
                      async.eachSeries(catchment, (catchmentType, nxtCatch) => {
                        if (catchmentType == "regular") {
                          var incatchment = "True"
                        } else if (catchmentType == "outreach") {
                          var incatchment = "False"
                        } else {
                          winston.error("Unknown catchment type found in " + JSON.stringify(catchment))
                          return nxtCatch()
                        }
                        var totalValues = 0
                        async.eachSeries(ageQueries, (qry, nxtQry) => {
                          let url = URI('http://localhost:3000')
                            .segment('ImmunizationByAge') +
                            '?gender=' + gender + '&vaccineCode=' + timrVaccCode + '&doseSequence=' + timrDoseId + '&inCatchment=' + incatchment + '&' + qry.query + '&fac_id=' + timrFacilityId + '&fac_name=' + facilityName
                            .toString()
                          var options = {
                            url: url.toString()
                          }
                          let before = new Date()
                          request.get(options, (err, res, body) => {
                            if (err) {
                              return callback(err)
                            }
                            var total = parseInt(JSON.parse(body).count)
                            if (total > 0)
                              orchestrations.push(utils.buildOrchestration('Fetching Immunization Coverage By Age Group Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                            totalValues = parseInt(totalValues) + total
                            return nxtQry()
                          })
                        }, function () {
                          if (gender == "Male" && catchmentType == "regular") {
                            report.report.coverageAgeGroupLineItems[cagLineItemIndex].regularMale = totalValues
                          } else if (gender == "Male" && catchmentType == "outreach") {
                            report.report.coverageAgeGroupLineItems[cagLineItemIndex].outreachMale = totalValues
                          } else if (gender == "Female" && catchmentType == "regular") {
                            report.report.coverageAgeGroupLineItems[cagLineItemIndex].regularFemale = totalValues
                          } else if (gender == "Female" && catchmentType == "outreach") {
                            report.report.coverageAgeGroupLineItems[cagLineItemIndex].outreachFemale = totalValues
                          }

                          return nxtCatch()
                        })
                      }, function () {
                        return nxtGndrCatchment()
                      })
                    }, function () {
                      var updatedReport = {
                        "id": report.report.id,
                        "facilityId": report.report.facilityId,
                        "periodId": report.report.periodId,
                        "coverageAgeGroupLineItems": [report.report.coverageAgeGroupLineItems[cagLineItemIndex]]
                      }
                      saveVIMSReport(updatedReport, "coverageAgeGroupLineItems", orchestrations, (err, res, body) => {

                      })
                      spinner.stop()
                        ++cagLineItemIndex
                      return nxtCagLineItem()
                    })
                  })
                }
              })
            })
          }, function () {
            return callback()
          })
        })
      })
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

    saveSupplements: function (facData, facility, vimsAgeGroup, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.vitaminSupplementationLineItems, (suppLineItem, supptLineItemIndex, nxtSupplmnt) => {
          if (suppLineItem.ageGroup === vimsAgeGroup) {
            let supplementCode
            if (suppLineItem.vitaminName == "Vitamin A") {
              supplementCode = 'Supplement-VitaminA'
            } else if (suppLineItem.vitaminName == "Mebendazole") {
              supplementCode = 'Supplement-Mebendazole'
            } else {
              winston.error("Unknown code found on Vitamin line item " + JSON.stringify(suppLineItem))
              return nxtSupplmnt()
            }

            let maleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Male' && data.code == supplementCode
            })
            let femaleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Female' && data.code == supplementCode
            })
            if (maleValueData) {
              let maleValue = maleValueData.total
              suppLineItem.maleValue = maleValue
            }
            if (femaleValueData) {
              let femaleValue = femaleValueData.total
              suppLineItem.femaleValue = femaleValue
            }
            if (!maleValueData && !femaleValueData) {
              return nxtSupplmnt()
            }
            winston.info("Saving Supplements " + facility.facilityName + " " + JSON.stringify({
              maleValue: suppLineItem.maleValue,
              femaleValue: suppLineItem.femaleValue,
              ageGroup: suppLineItem.ageGroup
            }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "vitaminSupplementationLineItems": [report.report.vitaminSupplementationLineItems[supptLineItemIndex]]
            }
            saveVIMSReport(updatedReport, "Supplements", orchestrations, (err, res, body) => {
              if (err) {
                winston.error(err)
              }
            })
            return nxtSupplmnt()
          } else {
            return nxtSupplmnt()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveAdverseEffectData: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachSeries(facData, (data, nxtData) => {
          data.start_date = moment(data.start_date).format("YYYY-MM-DD")
          let vimsVaccCode
          getVimsCode(data.type_mnemonic, timrVimsDwhImmConceptMap, code => {
            vimsVaccCode = code
          })
          let AEFILineItem = report.report.adverseEffectLineItems.find((AEFILineItem) => {
            return AEFILineItem.productId == vimsVaccCode && AEFILineItem.date == data.start_date
          })
          if (AEFILineItem) {
            AEFILineItem.cases = data.total
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "adverseEffectLineItems": [AEFILineItem]
            }
            winston.info("Updating AEFI " + JSON.stringify({
              product: data.type_mnemonic,
              cases: AEFILineItem.cases,
              date: data.start_date
            }))
            saveVIMSReport(updatedReport, "Adverse Effect", orchestrations, (err, res, body) => {
              if (err) {
                winston.error(err)
              }
              return nxtData()
            })
          } else {
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "adverseEffectLineItems": [{
                "productId": vimsVaccCode,
                "date": data.start_date,
                "cases": data.total,
                "batch": "",
                "isInvestigated": true
              }]
            }
            winston.info("Saving New AEFI With " + JSON.stringify({
              product: data.type_mnemonic,
              cases: data.total,
              date: data.start_date
            }))
            saveVIMSReport(updatedReport, "Adverse Effect", orchestrations, (err, res, body) => {
              if (err) {
                winston.error(err)
              }
              return nxtData()
            })
          }
        }, () => {
          return callback()
        })
      })
    },

    saveDiseaseData: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.diseaseLineItems, (lineItem, lineItemIndex, nxtLineitem) => {
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
            lineItem.cases = caseValueData.total
          }
          if (deathValueData) {
            lineItem.death = deathValueData.total
          }
          if (!caseValueData && !deathValueData) {
            return nxtLineitem()
          }
          winston.info("Saving Disease " + lineItem.diseaseName + " " + JSON.stringify({
            case: lineItem.cases,
            death: lineItem.death
          }))
          var updatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "diseaseLineItems": [report.report.diseaseLineItems[lineItemIndex]]
          }
          saveVIMSReport(updatedReport, "diseaseLineItems", orchestrations, (err, res, body) => {
            if (err) {
              winston.error(err)
            }
          })
          return nxtLineitem()
        }, () => {
          return callback()
        })
      })
    },

    saveCTCReferalData: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.ctcLineItems, (lineItem, lineItemIndex, nxtLineitem) => {
          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male'
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female'
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            lineItem.maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            lineItem.femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            return nxtLineitem()
          }
          winston.info("Saving CTCReferal " + JSON.stringify({
            maleValue: lineItem.maleValue,
            femaleValue: lineItem.femaleValue
          }))
          var updatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "ctcLineItems": [report.report.ctcLineItems[lineItemIndex]]
          }
          saveVIMSReport(updatedReport, "ctcLineItems", orchestrations, (err, res, body) => {

          })
          return nxtLineitem()
        }, () => {
          return callback()
        })
      })
    },

    saveBreastFeeding: function (facData, facility, vimsAgeGroup, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.breastFeedingLineItems, (bfLineItem, bfLineItemIndex, nxtBfLineitem) => {
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
              bfLineItem.maleValue = maleValue
            }
            if (femaleValueData) {
              let femaleValue = femaleValueData.total
              bfLineItem.femaleValue = femaleValue
            }
            if (!maleValueData && !femaleValueData) {
              return nxtBfLineitem()
            }
            winston.info("Saving Breast Feeding " + JSON.stringify({
              maleValue: bfLineItem.maleValue,
              femaleValue: bfLineItem.femaleValue,
              ageGroup: bfLineItem.ageGroup
            }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "breastFeedingLineItems": [report.report.breastFeedingLineItems[bfLineItemIndex]]
            }
            saveVIMSReport(updatedReport, "breastFeedingLineItems", orchestrations, (err, res, body) => {

            })
            return nxtBfLineitem()
          } else {
            return nxtBfLineitem()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveChildVisit: function (facData, facility, vimsAgeGroup, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.childVisitLineItems, (cvLineItem, cvLineItemIndex, nxtCvLineitem) => {
          if (cvLineItem.ageGroup === vimsAgeGroup) {
            let maleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Male'
            })
            let femaleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Female'
            })
            if (maleValueData) {
              let maleValue = maleValueData.total
              cvLineItem.maleValue = maleValue
            }
            if (femaleValueData) {
              let femaleValue = femaleValueData.total
              cvLineItem.femaleValue = femaleValue
            }
            if (!maleValueData && !femaleValueData) {
              return nxtCvLineitem()
            }
            winston.info("Saving Child Visit " + JSON.stringify({
              maleValue: cvLineItem.maleValue,
              femaleValue: cvLineItem.femaleValue,
              ageGroup: cvLineItem.ageGroup
            }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "childVisitLineItems": [report.report.childVisitLineItems[cvLineItemIndex]]
            }
            saveVIMSReport(updatedReport, "childVisitLineItems", orchestrations, (err, res, body) => {

            })
            return nxtCvLineitem()
          } else {
            return nxtCvLineitem()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveWeightAgeRatio: function (facData, facility, vimsAgeGroup, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.weightAgeRatioLineItems, (warLineItem, ageWeightLineItemIndex, nxtAWRLineitem) => {
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
              return nxtAWRLineitem()
            }

            let maleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Male' && data.code == weightageratiocode
            })
            let femaleValueData = facData.find((data) => {
              return data.gender_mnemonic == 'Female' && data.code == weightageratiocode
            })
            if (maleValueData) {
              let maleValue = maleValueData.total
              warLineItem.maleValue = maleValue
            }
            if (femaleValueData) {
              let femaleValue = femaleValueData.total
              warLineItem.femaleValue = femaleValue
            }
            if (!maleValueData && !femaleValueData) {
              return nxtAWRLineitem()
            }
            winston.info("Saving Weight Age Ratio " + JSON.stringify({
              maleValue: warLineItem.maleValue,
              femaleValue: warLineItem.femaleValue,
              ageGroup: warLineItem.ageGroup
            }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "weightAgeRatioLineItems": [report.report.weightAgeRatioLineItems[ageWeightLineItemIndex]]
            }
            saveVIMSReport(updatedReport, "weightAgeRatioLineItems", orchestrations, (err, res, body) => {

            })
            return nxtAWRLineitem()
          } else {
            return nxtAWRLineitem()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveTT: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.ttStatusLineItems, (ttLineitem, ttLineItemIndex, nxtTTLineitem) => {
          let ttcode
          if (ttLineitem.category == "Vaccinated") {
            ttcode = '2'
          } else if (ttLineitem.category == "Not Vaccinated") {
            ttcode = '1'
          } else if (ttLineitem.category == "Unknown") {
            ttcode = '0'
          } else {
            winston.error("Unknown code found on TT line item " + JSON.stringify(ttLineitem))
            return nxtTTLineitem()
          }

          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male' && data.ext_value == ttcode
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female' && data.ext_value == ttcode
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            ttLineitem.maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            ttLineitem.femaleValue = femaleValue
          }

          if (!maleValueData && !femaleValueData) {
            return nxtTTLineitem()
          }

          winston.info("Saving TT " + JSON.stringify({
            maleValue: ttLineitem.maleValue,
            femaleValue: ttLineitem.femaleValue
          }))
          var updatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "ttStatusLineItems": [report.report.ttStatusLineItems[ttLineItemIndex]]
          }
          saveVIMSReport(updatedReport, "ttStatusLineItems", orchestrations, (err, res, body) => {

          })
          return nxtTTLineitem()
        }, () => {
          return callback()
        })
      })
    },

    savePMTCT: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.pmtctLineItems, (pmtctLineItem, pmtctLineItemIndex, nxtPMTCTLineitem) => {
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
            pmtctLineItem.maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            pmtctLineItem.femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            return nxtPMTCTLineitem()
          }
          winston.info("Saving PMTCT " + JSON.stringify({
            maleValue: pmtctLineItem.maleValue,
            femaleValue: pmtctLineItem.femaleValue
          }))
          var updatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "pmtctLineItems": [report.report.pmtctLineItems[pmtctLineItemIndex]]
          }
          saveVIMSReport(updatedReport, "pmtctLineItems", orchestrations, (err, res, body) => {

          })
          return nxtPMTCTLineitem()
        }, () => {
          return callback()
        })
      })
    },

    saveMosquitoNet: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.eachOf(report.report.llInLineItemLists, (mnLineItem, mosquitoNetLineItemIndex, nxtMNLineitem) => {
          let maleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Male'
          })
          let femaleValueData = facData.find((data) => {
            return data.gender_mnemonic == 'Female'
          })
          if (maleValueData) {
            let maleValue = maleValueData.total
            mnLineItem.maleValue = maleValue
          }
          if (femaleValueData) {
            let femaleValue = femaleValueData.total
            mnLineItem.femaleValue = femaleValue
          }
          if (!maleValueData && !femaleValueData) {
            return nxtMNLineitem()
          }
          winston.info("Saving Mosquito Data " + JSON.stringify({
            maleValue: mnLineItem.maleValue,
            femaleValue: mnLineItem.femaleValue
          }))
          var updatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "llInLineItemLists": [report.report.llInLineItemLists[mosquitoNetLineItemIndex]]
          }
          saveVIMSReport(updatedReport, "llInLineItemLists", orchestrations, (err, res, body) => {

          })
          return nxtMNLineitem()
        }, () => {
          return callback()
        })
      })
    },

    saveColdChain: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        if (facData.length > 1) {
          winston.error("Multiple cold chain data returned for " + facility.facilityName + " stoping data sync")
          return
        }
        async.eachOf(report.report.coldChainLineItems, (lineItem, lineItemIndex, nxtlineitem) => {
          let minTemp = facData[0].coldstoremintemp
          let maxTemp = facData[0].coldstoremaxtemp
          let lowTempAlert = facData[0].coldstorelowtempalert
          let highTempAlert = facData[0].coldstorehightempalert
          let timrStatusCode = facData[0].status
          let found = false
          if (!Number.isNaN(Number.parseFloat(minTemp))) {
            report.report.coldChainLineItems[lineItemIndex].minTemp = minTemp
            found = true
          }
          if (!Number.isNaN(Number.parseFloat(maxTemp))) {
            report.report.coldChainLineItems[lineItemIndex].maxTemp = maxTemp
            found = true
          }
          if (!Number.isNaN(Number.parseFloat(lowTempAlert))) {
            report.report.coldChainLineItems[lineItemIndex].minEpisodeTemp = lowTempAlert
            found = true
          }
          if (!Number.isNaN(Number.parseFloat(highTempAlert))) {
            report.report.coldChainLineItems[lineItemIndex].maxEpisodeTemp = highTempAlert
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
              report.report.coldChainLineItems[lineItemIndex].operationalStatusId = vimsStatusCode
              found = true
            }
          }

          if (!found) {
            return nxtlineitem()
          }
          winston.info("Saving Cold Chain " + JSON.stringify({
            minTemp: lineItem.minTemp,
            maxTemp: lineItem.maxTemp,
            minEpisodeTemp: lineItem.minEpisodeTemp,
            maxEpisodeTemp: lineItem.maxEpisodeTemp,
            status: lineItem.operationalStatusId
          }))
          var coldChainUpdatedReport = {
            "id": report.report.id,
            "facilityId": report.report.facilityId,
            "periodId": report.report.periodId,
            "coldChainLineItems": [report.report.coldChainLineItems[lineItemIndex]]
          }
          saveVIMSReport(coldChainUpdatedReport, "Cold Chain", orchestrations, (err, res, body) => {

          })
          return nxtlineitem()
        }, () => {
          return callback()
        })
      })
    },

    saveSessionsData: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        if (facData.length > 1) {
          winston.error("Multiple Session data returned for " + facility.facilityName + " stoping data sync")
          return
        }
        var sessionsUpdatedReport = {
          "id": report.report.id,
          "facilityId": report.report.facilityId,
          "periodId": report.report.periodId,
        }
        let outreachPlan = facData[0].outreachplanned
        let outreach = facData[0].outreachperformed
        let outreachCancel = facData[0].outreachcancelled
        let sessions = facData[0].sessions
        let found = false
        if (!Number.isNaN(Number.parseFloat(outreachPlan))) {
          report.report.plannedOutreachImmunizationSessions = outreachPlan
          sessionsUpdatedReport.plannedOutreachImmunizationSessions = report.report.plannedOutreachImmunizationSessions
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(outreach))) {
          report.report.outreachImmunizationSessions = outreach
          sessionsUpdatedReport.outreachImmunizationSessions = report.report.outreachImmunizationSessions
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(outreachCancel))) {
          report.report.outreachImmunizationSessionsCanceled = outreachCancel
          sessionsUpdatedReport.outreachImmunizationSessionsCanceled = report.report.outreachImmunizationSessionsCanceled
          found = true
        }
        if (!Number.isNaN(Number.parseFloat(sessions))) {
          report.report.fixedImmunizationSessions = sessions
          sessionsUpdatedReport.fixedImmunizationSessions = report.report.fixedImmunizationSessions
          found = true
        }
        if (!found) {
          return callback()
        }
        winston.info("Saving Session " + JSON.stringify({
          outreachPlanned: report.report.plannedOutreachImmunizationSessions,
          outreachPerformed: report.report.outreachImmunizationSessions,
          outreachCancelled: report.report.outreachImmunizationSessionsCanceled,
          sessions: report.report.fixedImmunizationSessions
        }))
        saveVIMSReport(sessionsUpdatedReport, "Sending Sessions Data", orchestrations, (err, res, body) => {
          if (err) {
            winston.error(err)
          }
        })
        return callback()
      })
    },

    saveStockONHAND: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.each(facData, (data, nxtData) => {
          let vimsVaccCode
          getVimsCode(data.type_mnemonic, timrVimsDwhImmConceptMap, code => {
            vimsVaccCode = code
          })
          let logisticsLineItem = report.report.logisticsLineItems.find((lineItem) => {
            return lineItem.productId == vimsVaccCode
          })
          if (logisticsLineItem) {
            logisticsLineItem.closingBalance = data.balance_eom
            winston.info("Updating Stock ON_HAND " + JSON.stringify({
              product: data.type_mnemonic,
              ON_HAND: logisticsLineItem.closingBalance
            }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "logisticsLineItems": [logisticsLineItem]
            }
            saveVIMSReport(updatedReport, "Stock ON_HAND", orchestrations, (err, res, body) => {
              if (err) {
                return callback(err)
              }
              return nxtData()
            })
          } else {
            return nxtData()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveStockAdjustments: function (facData, facility, orchestrations, callback) {
      this.getReport(facility.periodId, orchestrations, (err, report) => {
        if (err || !report) {
          return callback()
        }
        async.each(facData, (data, nxtData) => {
          let vimsVaccCode
          getVimsCode(data.type_mnemonic, timrVimsDwhImmConceptMap, code => {
            vimsVaccCode = code
          })
          let logisticsLineItem = report.report.logisticsLineItems.find((lineItem) => {
            return lineItem.productId == vimsVaccCode
          })
          if (logisticsLineItem) {

            /*
            currently vims combines quantityExpired,quantityWastedOther,quantityFreezed and quantityVvmAlerted
            into quantityDiscardedUnopened,so we are also combining them until when vims accepts them separately
            */
            let found = false
            let discardedUnopened = 0
            if (!Number.isNaN(Number.parseInt(data['REASON-Expired']))) {
              discardedUnopened += parseInt(data['REASON-Expired'])
              found = true
            }
            if (!Number.isNaN(Number.parseInt(data['REASON-Broken']))) {
              discardedUnopened += parseInt(data['REASON-Broken'])
              found = true
            }
            if (!Number.isNaN(Number.parseInt(data['REASON-Wasted']))) {
              discardedUnopened += parseInt(data['REASON-Wasted'])
              found = true
            }
            if (!Number.isNaN(Number.parseInt(data['REASON-VVM']))) {
              discardedUnopened += parseInt(data['REASON-VVM'])
              found = true
            }
            if (!Number.isNaN(Number.parseInt(data['REASON-FROZEN']))) {
              discardedUnopened += parseInt(data['REASON-FROZEN'])
              found = true
            }

            lineItem.quantityDiscardedUnopened = discardedUnopened
            if (!Number.isNaN(Number.parseInt(data['REASON-OPENWASTE']))) {
              lineItem.quantityDiscardedOpened = data['REASON-OPENWASTE']
              found = true
            }
            winston.info("Updating Stock Adjustments " + JSON.stringify({
              product: data.type_mnemonic,
              'Discarded Opened': logisticsLineItem.quantityDiscardedOpened,
              'Discarded UnOpened': logisticsLineItem.quantityDiscardedUnopened
            }))
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "logisticsLineItems": [logisticsLineItem]
            }
            saveVIMSReport(updatedReport, "Stock Adjustments", orchestrations, (err, res, body) => {
              if (err) {
                return callback(err)
              }
              return nxtData()
            })
          } else {
            return nxtData()
          }
        }, () => {
          return callback()
        })
      })
    },

    saveStockData: function (period, timrStockData, stockCodes, vimsItemCode, orchestrations, callback) {
      /**
        push stock report to VIMS
      */
      var totalStockCodes = stockCodes.length
      if (totalStockCodes == 0) {
        return callback()
      }
      period.forEach((period) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var totalLogLineItems = report.report.logisticsLineItems.length;
          var found = false
          report.report.logisticsLineItems.forEach((logisticsLineItems, index) => {
            if (logisticsLineItems.productId == vimsItemCode) {
              found = true
              totalLogLineItems--
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
              var updatedReport = {
                "id": report.report.id,
                "facilityId": report.report.facilityId,
                "periodId": report.report.periodId,
                "logisticsLineItems": [report.report.logisticsLineItems[index]]
              }
              saveVIMSReport(updatedReport, "Stock", orchestrations, (err, res, body) => {
                if (err) {
                  return callback(err)
                } else
                  return callback(err)
              })
            } else {
              totalLogLineItems--
            }
            if (totalLogLineItems == 0 && found == false) {
              callback('')
            }
          })

        })
      })
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
          oim.getFacilityUUIDFromVimsId(distribution.toFacilityId, orchestrations, (err, facId, facName) => {
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
            oim.getFacilityUUIDFromVimsId(distribution.fromFacilityId, orchestrations, (err, facId1, facName1) => {
              if (err) {
                winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
                return callback(err, "")
              }
              if (facId1 == false || facId1 == null || facId1 == undefined) {
                err = true
                winston.error("VIMS Facility with ID " + distribution.fromFacilityId + " Was not found on the system,stop processing")
                return callback(err)
              }
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
                winston.info(despatchAdviceBaseMessage)
                if (timrToFacilityId)
                  callback(err, despatchAdviceBaseMessage)
                else {
                  err = true
                  winston.info("TImR Facility ID is Missing,skip sending Despatch Advise")
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
        var startDate = moment().startOf('month').format("YYYY-MM-DD")
        var endDate = moment().endOf('month').format("YYYY-MM-DD")
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