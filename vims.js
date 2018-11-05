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
const timrVimsImmConceptMap = require('./terminologies/timr-vims-immunization-conceptmap.json')
module.exports = function (vimscnf, oimcnf, timrcnf) {
  const vimsconfig = vimscnf
  const timrconfig = timrcnf
  const oimconfig = oimcnf
  const oim = OIM(oimcnf)

  function saveSessionsData(period, report, data, orchestrations, callback) {
    var periodDate = moment(period.periodName, 'MMM YYYY', 'en').format('YYYY-MM')
    if (data.hasOwnProperty(periodDate)) {
      report.report.plannedOutreachImmunizationSessions = data[periodDate].outreachPlan
      report.report.outreachImmunizationSessions = data[periodDate].outreach
      report.report.outreachImmunizationSessionsCanceled = data[periodDate].outreachCancel
      report.report.fixedImmunizationSessions = data[periodDate].sessions
      var sessionsUpdatedReport = {
        "id": report.report.id,
        "facilityId": report.report.facilityId,
        "periodId": report.report.periodId,
        "plannedOutreachImmunizationSessions": report.report.plannedOutreachImmunizationSessions,
        "outreachImmunizationSessions": report.report.outreachImmunizationSessions,
        "outreachImmunizationSessionsCanceled": report.report.outreachImmunizationSessionsCanceled,
        "fixedImmunizationSessions": report.report.fixedImmunizationSessions
      }
      saveVIMSReport(sessionsUpdatedReport, "Sending Sessions Data", orchestrations, (err, res, body) => {
        if (err) {
          winston.error(err)
          return callback(err)
        } else
          return callback(err, res, body)
      })
    } else
      return callback()
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

  function createFHIRQueryOnAge(ages, query, callback) {
    var endDay = moment().subtract(1, 'month').endOf('month').format('D') //getting the last day of last month
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
      var vaccineDate = moment().subtract(1, 'month').format('YYYY-MM') + '-' + dateDay
      async.eachSeries(ages, (age, nextAge) => {
        var birthDate = moment(vaccineDate).subtract(age.value, age.dimension).format('YYYY-MM-DDTHH:mm:ss')
        birthDatePar = birthDatePar + '&patient.birthDate' + age.operation + birthDate
        nextAge()
      }, function () {
        if (query)
          var newQuery = query + '&date=ge' + vaccineDate + 'T00:00' + '&date=le' + vaccineDate + 'T23:59' + birthDatePar
        else
          var newQuery = 'date=ge' + vaccineDate + 'T00:00' + '&date=le' + vaccineDate + 'T23:59' + birthDatePar
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

    getValueSets: function (valueSetName, callback) {
      var concept = valueSetName.compose.include[0].concept
      var valueSets = []
      async.eachSeries(concept, (code, nxtConcept) => {
        valueSets.push({
          'code': code.code
        })
        nxtConcept()
      }, function () {
        callback('', valueSets)
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

    saveImmunizationData: function (period, values, vimsVaccCode, dose, facilityName, orchestrations, callback) {
      if (values == "" || values == undefined || values == null) {
        winston.error("Empty data Submitted,skip processing data of value " + JSON.stringify(values))
        return callback()
      }
      if (!values.hasOwnProperty("regularMale") ||
        !values.hasOwnProperty("regularFemale") ||
        !values.hasOwnProperty("outreachMale") ||
        !values.hasOwnProperty("outreachFemale")
      ) {
        winston.error("Invalid data Submitted,ignoring processing data " + JSON.stringify(values))
        return callback()
      }
      if (values.regularMale === "" || values.regularMale === undefined || values.regularMale === null ||
        values.regularFemale === "" || values.regularFemale === undefined || values.regularFemale === null ||
        values.outreachMale === "" || values.outreachMale === undefined || values.outreachMale === null ||
        values.outreachFemale === "" || values.outreachFemale === undefined || values.outreachFemale === null
      ) {
        winston.error("One of the required data is empty,ignoring processing data " + JSON.stringify(values))
        return callback()
      }
      period.forEach((period) => {
        var periodId = period.id
        if (vimsVaccCode == '2413')
          var doseid = dose.vimsid1
        else if (vimsVaccCode == '2412') {
          //VIMS has dose 1 only for BCG
          var doseid = 1
        } else
          var doseid = dose.vimsid
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var totalCoveLine = report.report.coverageLineItems.length
          var found = false
          winston.info('Processing ' + facilityName + ' Vacc Code ' + vimsVaccCode + ' ' + dose.name + JSON.stringify(values))
          report.report.coverageLineItems.forEach((coverageLineItems, index) => {
            if (coverageLineItems.productId == vimsVaccCode && coverageLineItems.doseId == doseid) {
              found = true
              totalCoveLine--
              report.report.coverageLineItems[index].regularMale = values.regularMale
              report.report.coverageLineItems[index].regularFemale = values.regularFemale
              report.report.coverageLineItems[index].outreachMale = values.outreachMale
              report.report.coverageLineItems[index].outreachFemale = values.outreachFemale
              var updatedReport = {
                "id": report.report.id,
                "facilityId": report.report.facilityId,
                "periodId": report.report.periodId,
                "coverageLineItems": [report.report.coverageLineItems[index]]
              }
              saveVIMSReport(updatedReport, "Immunization Coverage", orchestrations, (err, res, body) => {
                if (err) {
                  winston.error(err)
                  return callback(err)
                } else
                  return callback()
              })
            } else {
              totalCoveLine--
            }
            if (totalCoveLine == 0 && found == false) {
              callback('')
            }
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

    saveVitaminData: function (period, values, vimsVitCode, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          winston.info('Processing Vitamin Code ' + vimsVitCode + JSON.stringify(values))
          async.eachOfSeries(report.report.vitaminSupplementationLineItems, (vitaminSupplementationLineItems, index, nxtSupplmnt) => {
            if (report.report.vitaminSupplementationLineItems[index].vaccineVitaminId == vimsVitCode) {
              var ageGroupID = report.report.vitaminSupplementationLineItems[index].vitaminAgeGroupId
              this.extractValuesFromAgeGroup(values, ageGroupID, (mergedValues) => {
                if (mergedValues.length == 1 && mergedValues[0].hasOwnProperty("maleValue"))
                  var maleValue = mergedValues[0].maleValue
                if (mergedValues.length == 1 && mergedValues[0].hasOwnProperty("femaleValue"))
                  var femaleValue = mergedValues[0].femaleValue
                if (maleValue)
                  report.report.vitaminSupplementationLineItems[index].maleValue = maleValue
                if (femaleValue)
                  report.report.vitaminSupplementationLineItems[index].femaleValue = femaleValue
                var updatedReport = {
                  "id": report.report.id,
                  "facilityId": report.report.facilityId,
                  "periodId": report.report.periodId,
                  "vitaminSupplementationLineItems": [report.report.vitaminSupplementationLineItems[index]]
                }
                saveVIMSReport(updatedReport, "Supplements", orchestrations, (err, res, body) => {
                  if (err) {
                    winston.error(err)
                  }
                  nxtSupplmnt()
                })
              })
            } else
              nxtSupplmnt()
          }, function () {
            nextPeriod()
          })
        })
      }, function () {
        winston.info("Done Processing " + vimsVitCode)
        return callback()
      })
    },

    saveAdverseEffectData: function (period, values, vimsVaccCode, orchestrations, callback) {
      var me = this
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          winston.info('Adding To VIMS AdverseEvent Details ' + JSON.stringify(values))
          //if no adverse effect reported
          if (!report.report.adverseEffectLineItems.hasOwnProperty(0)) {
            async.eachSeries(values, (value, nxtValue) => {
              if (!value.hasOwnProperty("value"))
                return nxtValue()

              if (value.value > 0) {
                var date = value.date
                var value = value.value
                var updatedReport = {
                  "id": report.report.id,
                  "facilityId": report.report.facilityId,
                  "periodId": report.report.periodId,
                  "adverseEffectLineItems": [{
                    "productId": vimsVaccCode,
                    "date": date,
                    "cases": value,
                    "batch": "",
                    "isInvestigated": true
                  }]
                }
                saveVIMSReport(updatedReport, "Adverse Effect", orchestrations, (err, res, body) => {
                  if (err) {
                    winston.error(err)
                    return nxtValue()
                  } else
                    nxtValue()
                })
              } else {
                nxtValue()
              }
            }, function () {
              nextPeriod()
            })
          }
          //if there is adverse effect reported
          else {
            async.eachSeries(values, (value, nxtValue) => {
              //makesure we dont update Adverse Effect associated with multiple products
              var found = false
              if (!value.hasOwnProperty("value"))
                return nxtValue()
              async.eachOfSeries(report.report.adverseEffectLineItems, (adverseEffectLineItems, index, nxtAdvEff) => {
                if (adverseEffectLineItems.productId == vimsVaccCode &&
                  adverseEffectLineItems.date == value.date &&
                  !adverseEffectLineItems.relatedLineItems.hasOwnProperty(0) &&
                  value.value > 0
                ) {
                  report.report.adverseEffectLineItems[index].cases = value.value
                  var updatedReport = {
                    "id": report.report.id,
                    "facilityId": report.report.facilityId,
                    "periodId": report.report.periodId,
                    "adverseEffectLineItems": [report.report.adverseEffectLineItems[index]]
                  }
                  saveVIMSReport(updatedReport, "Adverse Effect", orchestrations, (err, res, body) => {
                    found = true
                    if (err) {
                      winston.error(err)
                      return nxtValue()
                    } else
                      return nxtValue()
                  })
                } else
                  return nxtAdvEff()
              }, function () {
                //if nothing found then it was not added,add it from scratch
                if (found == false && value.value > 0) {
                  var updatedReport = {
                    "id": report.report.id,
                    "facilityId": report.report.facilityId,
                    "periodId": report.report.periodId,
                    "adverseEffectLineItems": [{
                      "productId": vimsVaccCode,
                      "date": value.date,
                      "cases": value.value,
                      "batch": "",
                      "isInvestigated": true
                    }]
                  }
                  saveVIMSReport(updatedReport, "Adverse Effect", orchestrations, (err, res, body) => {
                    if (err) {
                      winston.error(err)
                      return nxtValue()
                    } else
                      return nxtValue()
                  })
                } else
                  return nxtValue()
              })
            }, function () {
              return nextPeriod()
            })
          }
        })
      }, function () {
        return callback()
      })
    },

    saveDiseaseData: function (period, values, orchestrations, callback) {
      if (Object.keys(values).length == 0) {
        return callback()
      }
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          winston.info('Adding To VIMS Disease Details ' + JSON.stringify(values))
          async.eachOfSeries(report.report.diseaseLineItems, (diseaseLineItems, index, nxtDisLineItm) => {
            var diseaseID = report.report.diseaseLineItems[index].diseaseId
            var cases
            var death
            if (values[diseaseID].hasOwnProperty("case"))
              cases = values[diseaseID]["case"]
            if (values[diseaseID].hasOwnProperty("death"))
              death = values[diseaseID]["death"]

            if (cases == 0 && death == 0) {
              return nxtDisLineItm()
            }

            report.report.diseaseLineItems[index].cases = cases
            report.report.diseaseLineItems[index].death = death
            var updatedReport = {
              "id": report.report.id,
              "facilityId": report.report.facilityId,
              "periodId": report.report.periodId,
              "diseaseLineItems": [report.report.diseaseLineItems[index]]
            }
            saveVIMSReport(updatedReport, "diseaseLineItems", orchestrations, (err, res, body) => {
              if (err) {
                winston.error(err)
              } else
                nxtDisLineItm()
            })
          }, function () {
            nextPeriod()
          })
        })
      }, function () {
        return callback()
      })
    },

    saveBreastFeeding: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var bfLineItemIndex = 0
          async.eachSeries(report.report.breastFeedingLineItems, (bfLineItem, nxtBfLineitem) => {
            if (bfLineItem.category == "EBF")
              var breastfeedcode = 1
            else if (bfLineItem.category == "RF")
              var breastfeedcode = 2
            else {
              winston.error("Unknown code found on breast feed line item " + JSON.stringify(bfLineItem))
                ++bfLineItemIndex
              return nxtBfLineitem()
            }


            translateAgeGroup(bfLineItem.ageGroup, (ages, err) => {
              if (err) {
                winston.error(err + JSON.stringify(bfLineItem.ageGroup))
                  ++bfLineItemIndex
                return nxtBfLineitem()
              } else {
                createFHIRQueryOnAge(ages, false, (ageQueries) => {
                  var gndr = ["male", "female"]
                  winston.info("Getting TImR access token")
                  timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
                    if (err) {
                      winston.error("An error occured while getting access token from TImR")
                        ++bfLineItemIndex
                      return nxtBfLineitem()
                    }
                    winston.info("Done Getting Access Token")
                    var access_token = JSON.parse(body).access_token

                    winston.info("Getting Breast Feeding (" + bfLineItem.category + ") Data")
                    var spinner = new Spinner("Receiving Breast Feeding (" + bfLineItem.category + ") Data")
                    spinner.setSpinnerString(8);
                    spinner.start()
                    async.eachSeries(gndr, (gender, nxtGender) => {
                      var totalValues = 0
                      async.eachSeries(ageQueries, (qry, nxtQry) => {
                        qry.query = qry.query.replace("patient.", "")
                        //Patient resource uses registration-time for date
                        qry.query = qry.query.replace(new RegExp("&date", "g"), "&registration-time")
                        let url = URI(timrcnf.url)
                          .segment('fhir')
                          .segment('Patient') +
                          '?gender=' + gender + '&' + qry.query + '&breastfeeding=' + breastfeedcode + '&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                          .toString()
                        var options = {
                          url: url.toString(),
                          headers: {
                            Authorization: `BEARER ${access_token}`
                          }
                        }
                        let before = new Date()
                        request.get(options, (err, res, body) => {
                          if (err) {
                            return callback(err)
                          }
                          var total = parseInt(JSON.parse(body).total)
                          if (total > 0)
                            orchestrations.push(utils.buildOrchestration('Fetching Breast Feeding Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                          totalValues = parseInt(totalValues) + total
                          return nxtQry()
                        })
                      }, function () {
                        if (gender == "male")
                          report.report.breastFeedingLineItems[bfLineItemIndex].maleValue = totalValues
                        if (gender == "female")
                          report.report.breastFeedingLineItems[bfLineItemIndex].femaleValue = totalValues
                        return nxtGender()
                      })
                    }, function () {
                      var updatedReport = {
                        "id": report.report.id,
                        "facilityId": report.report.facilityId,
                        "periodId": report.report.periodId,
                        "breastFeedingLineItems": [report.report.breastFeedingLineItems[bfLineItemIndex]]
                      }
                      saveVIMSReport(updatedReport, "breastFeedingLineItems", orchestrations, (err, res, body) => {

                      })
                      spinner.stop()
                        ++bfLineItemIndex
                      return nxtBfLineitem()
                    })
                  })
                })
              }
            })
          }, function () {
            return callback()
          })
        })
      })
    },

    saveChildVisit: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var cvLineItemIndex = 0
          async.eachSeries(report.report.childVisitLineItems, (cvLineItem, nxtCvLineitem) => {
            translateAgeGroup(cvLineItem.ageGroup, (ages, err) => {
              if (err) {
                winston.error(err + JSON.stringify(cvLineItem.ageGroup))
                  ++cvLineItemIndex
                return nxtCvLineitem()
              } else {
                createFHIRQueryOnAge(ages, false, (ageQueries) => {
                  var gndr = ["male", "female"]
                  winston.info("Getting TImR access token")
                  timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
                    if (err) {
                      winston.error("An error occured while getting access token from TImR")
                        ++cvLineItemIndex
                      return nxtCvLineitem()
                    }
                    winston.info("Done Getting Access Token")
                    var access_token = JSON.parse(body).access_token

                    winston.info("Getting Child Visit Data")
                    var spinner = new Spinner("Receiving Child Visit Data")
                    spinner.setSpinnerString(8);
                    spinner.start()
                    async.eachSeries(gndr, (gender, nxtGender) => {
                      var totalValues = 0
                      async.eachSeries(ageQueries, (qry, nxtQry) => {
                        let url = URI(timrcnf.url)
                          .segment('fhir')
                          .segment('Encounter') +
                          '?gender=' + gender + '&' + qry.query + '&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                          .toString()
                        var options = {
                          url: url.toString(),
                          headers: {
                            Authorization: `BEARER ${access_token}`
                          }
                        }
                        let before = new Date()
                        request.get(options, (err, res, body) => {
                          if (err) {
                            return callback(err)
                          }
                          var total = parseInt(JSON.parse(body).total)
                          if (total > 0)
                            orchestrations.push(utils.buildOrchestration('Fetching Child Visit Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                          totalValues = parseInt(totalValues) + total
                          return nxtQry()
                        })
                      }, function () {
                        if (gender == "male")
                          report.report.childVisitLineItems[cvLineItemIndex].maleValue = totalValues
                        if (gender == "female")
                          report.report.childVisitLineItems[cvLineItemIndex].femaleValue = totalValues
                        return nxtGender()
                      })
                    }, function () {
                      var updatedReport = {
                        "id": report.report.id,
                        "facilityId": report.report.facilityId,
                        "periodId": report.report.periodId,
                        "childVisitLineItems": [report.report.childVisitLineItems[cvLineItemIndex]]
                      }
                      saveVIMSReport(updatedReport, "childVisitLineItems", orchestrations, (err, res, body) => {

                      })
                      spinner.stop()
                        ++cvLineItemIndex
                      return nxtCvLineitem()
                    })
                  })
                })
              }
            })
          }, function () {
            return callback()
          })
        })
      })
    },

    saveTT: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var ttLineItemIndex = 0
          async.eachSeries(report.report.ttStatusLineItems, (ttLineitem, nxtTTLineitem) => {
            if (ttLineitem.category == "Vaccinated")
              var ttcode = '2'
            else if (ttLineitem.category == "Not Vaccinated")
              var ttcode = '1'
            else if (ttLineitem.category == "Unknown")
              var ttcode = '0'
            else {
              winston.error("Unknown code found on TT line item " + JSON.stringify(ttLineitem))
                ++ttLineItemIndex
              return nxtTTLineitem()
            }

            var gndr = ["male", "female"]
            winston.info("Getting TImR access token")
            timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
              if (err) {
                winston.error("An error occured while getting access token from TImR")
                  ++ttLineItemIndex
                return nxtTTLineitem()
              }
              winston.info("Done Getting Access Token")
              var access_token = JSON.parse(body).access_token

              winston.info("Getting TT (" + ttLineitem.category + ") Data")
              var spinner = new Spinner("Receiving TT (" + ttLineitem.category + ") Data")
              spinner.setSpinnerString(8);
              spinner.start()
              async.eachSeries(gndr, (gender, nxtGender) => {
                var totalValues = 0
                let url = URI(timrcnf.url)
                  .segment('fhir')
                  .segment('Patient') +
                  '?gender=' + gender + '&tt-status=' + ttcode + '&status=ACTIVE&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                  .toString()
                var options = {
                  url: url.toString(),
                  headers: {
                    Authorization: `BEARER ${access_token}`
                  }
                }
                let before = new Date()
                request.get(options, (err, res, body) => {
                  if (err) {
                    return callback(err)
                  }
                  var total = parseInt(JSON.parse(body).total)
                  if (total > 0)
                    orchestrations.push(utils.buildOrchestration('Fetching TT Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                  totalValues = parseInt(totalValues) + total
                  if (gender == "male")
                    report.report.ttStatusLineItems[ttLineItemIndex].maleValue = totalValues
                  if (gender == "female")
                    report.report.ttStatusLineItems[ttLineItemIndex].femaleValue = totalValues
                  return nxtGender()
                })
              }, function () {
                var updatedReport = {
                  "id": report.report.id,
                  "facilityId": report.report.facilityId,
                  "periodId": report.report.periodId,
                  "ttStatusLineItems": [report.report.ttStatusLineItems[ttLineItemIndex]]
                }
                saveVIMSReport(updatedReport, "ttStatusLineItems", orchestrations, (err, res, body) => {

                })
                spinner.stop()
                  ++ttLineItemIndex
                return nxtTTLineitem()
              })
            })
          }, function () {
            return callback()
          })
        })
      })
    },

    saveAgeWeightRatio: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var ageWeightLineItemIndex = 0
          async.eachSeries(report.report.weightAgeRatioLineItems, (warLineItem, nxtAWRLineitem) => {
            if (warLineItem.category == "80% - 2SD")
              var weightageratiocode = 'H'
            else if (warLineItem.category == "60% - 3SD")
              var weightageratiocode = 'L'
            else if (warLineItem.category == "60%-80% - 2-3SD")
              var weightageratiocode = 'N'
            else {
              winston.error("Unknown code found on Age Weight Ratio line item " + JSON.stringify(warLineItem))
                ++ageWeightLineItemIndex
              return nxtAWRLineitem()
            }


            translateAgeGroup(warLineItem.ageGroup, (ages, err) => {
              if (err) {
                winston.error(err + JSON.stringify(warLineItem.ageGroup))
                  ++ageWeightLineItemIndex
                return nxtAWRLineitem()
              } else {
                createFHIRQueryOnAge(ages, false, (ageQueries) => {
                  var gndr = ["male", "female"]
                  winston.info("Getting TImR access token")
                  timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
                    if (err) {
                      winston.error("An error occured while getting access token from TImR")
                        ++ageWeightLineItemIndex
                      return nxtAWRLineitem()
                    }
                    winston.info("Done Getting Access Token")
                    var access_token = JSON.parse(body).access_token

                    winston.info("Getting Age Weight Ratio (" + warLineItem.category + ") Data")
                    var spinner = new Spinner("Receiving Age Weight Ratio (" + warLineItem.category + ") Data")
                    spinner.setSpinnerString(8);
                    spinner.start()
                    async.eachSeries(gndr, (gender, nxtGender) => {
                      var totalValues = 0
                      async.eachSeries(ageQueries, (qry, nxtQry) => {
                        let url = URI(timrcnf.url)
                          .segment('fhir')
                          .segment('Observation') +
                          '?gender=' + gender + '&' + qry.query + '&code=' + 'http://hl7.org/fhir/sid/loinc|3141-9' + '&interpretation=' + weightageratiocode + '&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                          .toString()
                        var options = {
                          url: url.toString(),
                          headers: {
                            Authorization: `BEARER ${access_token}`
                          }
                        }
                        let before = new Date()
                        request.get(options, (err, res, body) => {
                          if (err) {
                            return callback(err)
                          }
                          var total = parseInt(JSON.parse(body).total)
                          if (total > 0)
                            orchestrations.push(utils.buildOrchestration('Fetching Age Weight Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                          totalValues = parseInt(totalValues) + total
                          return nxtQry()
                        })
                      }, function () {
                        if (gender == "male")
                          report.report.weightAgeRatioLineItems[ageWeightLineItemIndex].maleValue = totalValues
                        if (gender == "female")
                          report.report.weightAgeRatioLineItems[ageWeightLineItemIndex].femaleValue = totalValues
                        return nxtGender()
                      })
                    }, function () {
                      var updatedReport = {
                        "id": report.report.id,
                        "facilityId": report.report.facilityId,
                        "periodId": report.report.periodId,
                        "weightAgeRatioLineItems": [report.report.weightAgeRatioLineItems[ageWeightLineItemIndex]]
                      }
                      saveVIMSReport(updatedReport, "weightAgeRatioLineItems", orchestrations, (err, res, body) => {

                      })
                      spinner.stop()
                        ++ageWeightLineItemIndex
                      return nxtAWRLineitem()
                    })
                  })
                })
              }
            })
          }, function () {
            return callback()
          })
        })
      })
    },

    savePMTCT: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var pmtctLineItemIndex = 0
          async.eachSeries(report.report.pmtctLineItems, (pmtctLineItem, nxtPMTCTLineitem) => {
            translateAgeGroup(pmtctLineItem.ageGroup, (ages, err) => {
              if (err) {
                winston.error(err + JSON.stringify(warLineItem.ageGroup))
                  ++pmtctLineItemIndex
                return nxtPMTCTLineitem()
              } else {
                createFHIRQueryOnAge(ages, false, (ageQueries) => {
                  var gndr = ["male", "female"]
                  winston.info("Getting TImR access token")
                  timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
                    if (err) {
                      winston.error("An error occured while getting access token from TImR")
                        ++pmtctLineItemIndex
                      return nxtPMTCTLineitem()
                    }
                    winston.info("Done Getting Access Token")
                    var access_token = JSON.parse(body).access_token

                    winston.info("Getting PMTCT (" + pmtctLineItem.category + ") Data")
                    var spinner = new Spinner("Receiving PMTCT (" + pmtctLineItem.category + ") Data")
                    spinner.setSpinnerString(8);
                    spinner.start()
                    async.eachSeries(gndr, (gender, nxtGender) => {
                      var totalValues = 0
                      async.eachSeries(ageQueries, (qry, nxtQry) => {
                        qry.query = qry.query.replace("patient.", "")
                        //Patient resource uses registration-time for date
                        qry.query = qry.query.replace(new RegExp("&date", "g"), "&registration-time")
                        let url = URI(timrcnf.url)
                          .segment('fhir')
                          .segment('Patient') +
                          '?gender=' + gender + '&pmtct=1&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                          .toString()
                        var options = {
                          url: url.toString(),
                          headers: {
                            Authorization: `BEARER ${access_token}`
                          }
                        }
                        let before = new Date()
                        request.get(options, (err, res, body) => {
                          if (err) {
                            return callback(err)
                          }
                          var total = parseInt(JSON.parse(body).total)
                          if (total > 0)
                            orchestrations.push(utils.buildOrchestration('Fetching PMTCT Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                          totalValues = parseInt(totalValues) + total
                          return nxtQry()
                        })
                      }, function () {
                        if (gender == "male")
                          report.report.pmtctLineItems[pmtctLineItemIndex].maleValue = totalValues
                        if (gender == "female")
                          report.report.pmtctLineItems[pmtctLineItemIndex].femaleValue = totalValues
                        return nxtGender()
                      })
                    }, function () {
                      var updatedReport = {
                        "id": report.report.id,
                        "facilityId": report.report.facilityId,
                        "periodId": report.report.periodId,
                        "pmtctLineItems": [report.report.pmtctLineItems[pmtctLineItemIndex]]
                      }
                      saveVIMSReport(updatedReport, "pmtctLineItems", orchestrations, (err, res, body) => {

                      })
                      spinner.stop()
                        ++pmtctLineItemIndex
                      return nxtPMTCTLineitem()
                    })
                  })
                })
              }
            })
          }, function () {
            return callback()
          })
        })
      })
    },

    saveMosquitoNet: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var mosquitoNetLineItemIndex = 0
          async.eachSeries(report.report.llInLineItemLists, (mnLineItem, nxtMNLineitem) => {
            var gndr = ["male", "female"]
            winston.info("Getting TImR access token")
            timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
              if (err) {
                winston.error("An error occured while getting access token from TImR")
                  ++mosquitoNetLineItemIndex
                return nxtMNLineitem()
              }
              winston.info("Done Getting Access Token")
              var access_token = JSON.parse(body).access_token

              winston.info("Getting Mosquito Net Data")
              var spinner = new Spinner("Receiving Mosquito Net Data")
              spinner.setSpinnerString(8);
              spinner.start()
              async.eachSeries(gndr, (gender, nxtGender) => {
                var totalValues = 0
                let url = URI(timrcnf.url)
                  .segment('fhir')
                  .segment('Observation') +
                  '?gender=' + gender + '&mosquito-net=True&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                  .toString()
                var options = {
                  url: url.toString(),
                  headers: {
                    Authorization: `BEARER ${access_token}`
                  }
                }
                let before = new Date()
                request.get(options, (err, res, body) => {
                  if (err) {
                    return callback(err)
                  }
                  var total = parseInt(JSON.parse(body).total)
                  if (total > 0)
                    orchestrations.push(utils.buildOrchestration('Fetching Age Weight Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                  totalValues = parseInt(totalValues) + total

                  if (gender == "male")
                    report.report.llInLineItemLists[mosquitoNetLineItemIndex].maleValue = totalValues
                  if (gender == "female")
                    report.report.llInLineItemLists[mosquitoNetLineItemIndex].femaleValue = totalValues
                  return nxtGender()
                })
              }, function () {
                var updatedReport = {
                  "id": report.report.id,
                  "facilityId": report.report.facilityId,
                  "periodId": report.report.periodId,
                  "llInLineItemLists": [report.report.llInLineItemLists[mosquitoNetLineItemIndex]]
                }
                saveVIMSReport(updatedReport, "llInLineItemLists", orchestrations, (err, res, body) => {

                })
                spinner.stop()
                  ++mosquitoNetLineItemIndex
                return nxtMNLineitem()
              })
            })
          }, function () {
            return callback()
          })
        })
      })
    },

    saveImmCoverAgeGrp: function (period, timrFacilityId, timr, orchestrations, callback) {
      async.eachSeries(period, (period, nextPeriod) => {
        var periodId = period.id
        this.getReport(periodId, orchestrations, (err, report) => {
          if (err || !report) {
            return callback()
          }
          var cagLineItemIndex = 0
          async.eachSeries(report.report.coverageAgeGroupLineItems, (cagLineItem, nxtCagLineItem) => {
            timr.getTimrCode(cagLineItem.productId, timrVimsImmConceptMap, (timrVaccCode) => {
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
                  createFHIRQueryOnAge(ages, false, (ageQueries) => {
                    var gndrCatchment = {
                      "male": ["regular", "outreach"],
                      "female": ["regular", "outreach"]
                    }
                    winston.info("Getting TImR access token")
                    timr.getAccessToken('fhir', orchestrations, (err, res, body) => {
                      if (err) {
                        winston.error("An error occured while getting access token from TImR")
                          ++cagLineItemIndex
                        return nxtCagLineItem()
                      }
                      winston.info("Done Getting Access Token")
                      var access_token = JSON.parse(body).access_token

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
                            let url = URI(timrconfig.url)
                              .segment('fhir')
                              .segment('Immunization') +
                              '?gender=' + gender + '&vaccine-code=' + timrVaccCode + '&dose-sequence=' + timrDoseId + '&in-catchment=' + incatchment + '&' + qry.query + '&location.identifier=HIE_FRID|' + timrFacilityId + '&_format=json&_count=0'
                              .toString()
                            var options = {
                              url: url.toString(),
                              headers: {
                                Authorization: `BEARER ${access_token}`
                              }
                            }
                            let before = new Date()
                            request.get(options, (err, res, body) => {
                              if (err) {
                                return callback(err)
                              }
                              var total = parseInt(JSON.parse(body).total)
                              if (total > 0)
                                orchestrations.push(utils.buildOrchestration('Fetching Immunization Coverage By Age Group Data From TImR', before, 'GET', url.toString(), JSON.stringify(options), res, JSON.stringify(body)))
                              totalValues = parseInt(totalValues) + total
                              return nxtQry()
                            })
                          }, function () {
                            if (gender == "male" && catchmentType == "regular") {
                              report.report.coverageAgeGroupLineItems[cagLineItemIndex].regularMale = totalValues
                            } else if (gender == "male" && catchmentType == "outreach") {
                              report.report.coverageAgeGroupLineItems[cagLineItemIndex].outreachMale = totalValues
                            } else if (gender == "female" && catchmentType == "regular") {
                              report.report.coverageAgeGroupLineItems[cagLineItemIndex].regularFemale = totalValues
                            } else if (gender == "female" && catchmentType == "outreach") {
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

    saveColdChain: function (coldChain, uuid, orchestrations, callback) {
      winston.info("Sending to VIMS Cold Chain with timr facilityid " + uuid + " .sending Data " + coldChain)
      var data = JSON.parse(coldChain)
      oim.getVimsFacilityId(uuid, orchestrations, (err, vimsid) => {
        if (err) {
          winston.error("An Error Occured While Trying To Access OpenInfoMan,Stop Processing")
          return callback()
        }
        if (vimsid == "" || vimsid == null || vimsid == undefined) {
          winston.warn(uuid + " Is not mapped to any VIMS Facility,Stop saving Cold Chain")
          var err = true
          return callback(err)
        }
        this.getPeriod(vimsid, orchestrations, (err, period) => {
          if (period.length > 1) {
            winston.error("VIMS has returned two DRAFT reports,processng cold chain stoped!!!")
            return callback()
          } else if (period.length == 0) {
            winston.warn("Skip Processing Facility" + uuid + ", No Period Found")
            return callback()
          } else if (period.length == 1) {
            async.eachSeries(period, (period, nextPeriod) => {
              var periodId = period.id
              this.getReport(periodId, orchestrations, (err, report) => {
                if (err || !report) {
                  return callback()
                }
                if (report.report.coldChainLineItems.length == 0) {
                  saveSessionsData(period, report, data, orchestrations, (err, res, body) => {
                    winston.warn("No Cold Chain Initialized For VIMS Facility " + vimsid + " Skip sending Cold Chain data to VIMS for this facility")
                    return callback()
                  })
                }
                async.eachOfSeries(report.report.coldChainLineItems, (coldChainLineItem, index, nextColdChain) => {
                  var periodDate = moment(period.periodName, 'MMM YYYY', 'en').format('YYYY-MM')
                  if (data.hasOwnProperty(periodDate)) {
                    report.report.coldChainLineItems[index].minTemp = data[periodDate].coldStoreMin
                    report.report.coldChainLineItems[index].maxTemp = data[periodDate].coldStoreMax
                    report.report.coldChainLineItems[index].minEpisodeTemp = data[periodDate].coldStoreLow
                    report.report.coldChainLineItems[index].maxEpisodeTemp = data[periodDate].coldStoreHigh
                    report.report.coldChainLineItems[index].operationalStatusId = data[periodDate].status
                    var coldChainUpdatedReport = {
                      "id": report.report.id,
                      "facilityId": report.report.facilityId,
                      "periodId": report.report.periodId,
                      "coldChainLineItems": [report.report.coldChainLineItems[index]]
                    }
                    saveVIMSReport(coldChainUpdatedReport, "Cold Chain", orchestrations, (err, res, body) => {
                      saveSessionsData(period, report, data, orchestrations, (err, res, body) => {
                        return callback(err, res)
                      })
                    })
                  } else {
                    return callback()
                  }
                })
              })
            }, function () {

            })
          }
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