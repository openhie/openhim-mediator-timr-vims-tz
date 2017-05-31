'use strict'
const winston = require('winston')
const request = require('request')
const URI = require('urijs')
const moment = require("moment")
const catOptOpers = require('./config/categoryOptionsOperations.json')
const timrVimsImm = require('./terminologies/timr-vims-immunization-conceptmap.json')

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
          return
        }
        var totalValues = 0
        var queryPar = []
        var values = {}
        queryPar.push({'name': 'regularMale','fhirQuery':'patient.gender=male&in-catchment=false&dose-sequence='+dose.timrid})
        queryPar.push({'name': 'regularFemale','fhirQuery':'patient.gender=female&in-catchment=false&dose-sequence='+dose.timrid})
        queryPar.push({'name': 'outreachMale','fhirQuery':'patient.gender=male&in-catchment=true&dose-sequence='+dose.timrid})
        queryPar.push({'name': 'outreachFemale','fhirQuery':'patient.gender=female&in-catchment=true&dose-sequence='+dose.timrid})
        var vaccineStartDate = moment().subtract(1,'month').startOf('month').format('YYYY-MM-DD')
        var vaccineEndDate = moment().subtract(1,'month').endOf('month').format('YYYY-MM-DD')
        queryPar.forEach ((query,index) => {
          let url = URI(timrconfig.url)
          .segment('Immunization')
          +'?' + query.fhirQuery + '&vaccine-code=' + timrVaccCode + '&date=ge' + vaccineStartDate + '&date=le' + vaccineEndDate + '&_format=json&_count=0'
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
            if(queryPar.length-1 == index) {
              return callback('',values)
            }
          })
        })
      })
    }

  }
}
