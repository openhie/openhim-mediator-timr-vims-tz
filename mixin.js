const JsonStreamStringify = require('json-stream-stringify')
const winston = require('winston')
const async = require('async')
const moment = require('moment');
const fs = require('fs')
const FHIR = require('./fhir');
const VIMS = require('./vims');
const middleware = require('./middleware');
let facilitiesData = require('./vimsCache/facilitiesData.json')
module.exports = {
  cacheFacilitiesData: (config, orchestrations, callback) => {
    const fhir = FHIR(config.fhir)
    const vims = VIMS(config.vims, '', config.timr, config.timrOauth2);
    let cache = {
      lastCached: moment().format()
    }
    winston.info('Getting facilities from FHIR Server');
    fhir.getVimsFacilities(orchestrations, (err, facilities) => {
      winston.info('Getting latest period')
      vims.getFacilityWithLatestPeriod(facilities, periods => {
        cache.periods = periods
        cache.facilities = []
        winston.info('Populating facilities with reports')
        async.each(facilities, (facility, nxt) => {
          if(!facility.periodId) {
            return nxt()
          }
          vims.getReport(facility.periodId, orchestrations, (err, report) => {
            winston.info(facility.facilityName)
            if(!report || !report.report) {
              return nxt()
            }
            facility.report = report
            const writeStream = fs.createWriteStream('vimsCache/'+facility.timrFacilityId + '.json', { flags: 'w' })
            const jsonStream = new JsonStreamStringify(Promise.resolve(Promise.resolve(facility)))
            jsonStream.pipe(writeStream)
            jsonStream.on('end', () => {
              cache.facilities.push(facility.timrFacilityId + '.json')
              return nxt()
            })
            jsonStream.on('error', () => {
              winston.error('Error at path', jsonStream.stack.join('.'))
              return nxt()
            })
          })
        }, () => {
          if(!cache || !cache.facilities || cache.facilities.length === 0) {
            return callback(true)
          }
          facilitiesData = cache
          const writeStream = fs.createWriteStream('vimsCache/facilitiesData.json', { flags: 'w' })
          const jsonStream = new JsonStreamStringify(Promise.resolve(Promise.resolve(cache)))
          jsonStream.pipe(writeStream)
          jsonStream.on('end', () => {
            winston.info('Done')
            return callback(false)
          })
          jsonStream.on('error', () => {
            winston.error('Error at path', jsonStream.stack.join('.'))
            return callback(true)
          })
        })
      })
    })
  },
  prepareDataSync: ({
    config,
    orchestrations,
    middlewareCallFunction
  }, callback) => {
    winston.info('Getting latest period')
    let periods = facilitiesData.periods
    winston.info('Getting data from timr for periods ' + JSON.stringify(periods))
    middleware[middlewareCallFunction](periods, rows => {
      async.each(rows, (row, nxtRow) => {
        if (row.data.length === 0) {
          winston.warn("Middleware call for " + middlewareCallFunction + " returned no data for period " + row.periodName)
        }
        return nxtRow()
      }, () => {
        return callback(facilitiesData.facilities, rows)
      })
    })
  },
  prepareDataSyncWithAgeGrp: ({
    config,
    orchestrations,
    lineItem,
  }, callback) => {
    const vims = VIMS(config.vims, '', config.timr, config.timrOauth2);
    let periods = facilitiesData.periods
    if (periods.length === 0) {
      winston.warn('No facility with DRAFT report, stoping data sync');
      return callback([], [])
    }
    winston.info('Getting vims report for period ID ' + periods[0].periodId)
    vims.getReport(periods[0].periodId, orchestrations, (err, report) => {
      winston.info('Extracting age groups')
      vims.extractAgeGroups(report.report[lineItem]).then(ageGroups => {
        if (ageGroups.length == 0) {
          winston.warn('No age group found, stop data sync');
          return callback([], [])
        }
        winston.info('returning age groups and periods')
        return callback(facilitiesData.facilities, ageGroups, periods)
      })
    })
  },
  extractFacilityData: (facilityId, data, callback) => {
    let facData = data.filter((dt) => {
      return dt.facility_id === facilityId
    })
    return callback(facData)
  },
  translateAgeGroup: (ageGroup, callback) => {
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
        // if the operator was >= or <= then get the = sign
        if (ageGroup.charAt(1) === '=') {
          operator += '='
        }
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
          dimension = 'DAY'
        else if (dim.includes('month'))
          dimension = 'MONTH'
        else if (dim.includes('year'))
          dimension = 'YEAR'
        else
          return callback('', 'Age group must contain either of the string Years or Months or Weeks')

        // convert weeks to days
        if (dim.includes('week')) {
          age = age * 7
        }
        // for month, catch +30 days i.e if 3 months then get 3 and 1 day, 3 and 2 days etc
        if (dimension == 'MONTH') {
          ageOper.push({
            operator: '>=',
            age: age + ' ' + dimension
          })
          ageOper.push({
            operator: '<=',
            age: age + '.9 ' + dimension
          })
        } else {
          ageOper.push({
            operator: operator,
            age: age + ' ' + dimension
          })
        }
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
            dimension = 'DAY'
          else if (dim.includes('month'))
            dimension = 'MONTH'
          else if (dim.includes('year'))
            dimension = 'YEAR'
          else
            return callback('', 'Age group must contain either of the string Years or Months or Weeks ')
          // convert weeks to days
          if (dim.includes('week')) {
            age1 = age1 * 7
            age2 = age2 * 7
          }
          if (age1 < age2) {
            ageOper.push({
              operator: '>=',
              age: age1 + ' ' + dimension
            })
            ageOper.push({
              operator: '<=',
              age: age2 + ' ' + dimension
            })
          } else {
            ageOper.push({
              operator: '<=',
              age: age1 + ' ' + dimension
            })
            ageOper.push({
              operator: '>=',
              age: age2 + ' ' + dimension
            })
          }
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
            dimension = 'DAY'
            var position = dim.indexOf("week")
          } else if (dim.includes('month')) {
            dimension = 'MONTH'
            var position = dim.indexOf("month")
          } else if (dim.includes('year')) {
            dimension = 'YEAR'
            var position = dim.indexOf("year")
          } else {
            return callback('', 'Age group must contain either of the string Years or Months or Weeks ')
          }

          // convert weeks to days
          if (dim.includes('week')) {
            age = age * 7
          }
          //make sure the position of dimension is at 0
          if (position != 0) {
            return callback('', 'Invalid Age Group Definition ')
          }

          // for month, catch +30 days i.e if 3 months then get 3 and 1 day, 3 and 2 days etc
          if (dimension == 'MONTH') {
            ageOper.push({
              operator: '>=',
              age: age + ' ' + dimension
            })
            ageOper.push({
              operator: '<=',
              age: age + '.9 ' + dimension
            })
          } else {
            ageOper.push({
              operator: '=',
              age: age + ' ' + dimension
            })
          }
        } else {

        }
      } else {
        return callback('', 'Unknown operation,expected age range e.g 10-12Years or operators < or > ')
      }
    }
    callback(ageOper, false)
  }
}