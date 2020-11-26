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
module.exports = function (vimscnf, fhircnf) {
  const vimsconfig = vimscnf
  const fhir = FHIR(fhircnf)

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
              fromFacilityName = facName1
              timrFromFacilityId = facId1
              let despatchAdviceLineItem
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
                      despatchAdviceLineItem = util.format(data, lotQuantity, lotId, gtin, vims_item_id, item_name, codeListVersion, timr_item_id, lotCode, expirationDate, dosesPerDispensingUnit)
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
                    despatchAdviceLineItem = util.format(data, lotQuantity, lotId, gtin, vims_item_id, item_name, codeListVersion, timr_item_id, lotCode, expirationDate, dosesPerDispensingUnit)
                    despatchAdviceBaseMessage = util.format(despatchAdviceBaseMessage, despatchAdviceLineItem)
                    return nextlineItems()
                  })
                }
              }, function () {
                despatchAdviceBaseMessage = despatchAdviceBaseMessage.replace("%s", "")
                if (!timrToFacilityId) {
                  err = true
                  winston.info("TImR Facility ID is Missing,skip sending Despatch Advise")
                  return callback(err, "", false)
                }
                if (despatchAdviceLineItem === undefined) {
                  err = true
                  winston.error("Empty despatch advice line item,skip sending Despatch Advise")
                  return callback(err, "", true)
                }
                if (timrToFacilityId) {
                  return callback(err, despatchAdviceBaseMessage, true)
                }
              })
            })
          })
        })
      } else {
        winston.error("Invalid Distribution Passed For Conversion")
        return callback(true, "", false)
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
            if (distribution != null && distribution != false && distribution != undefined) {
              var receivingAdvice = distribution
              receivingAdvice.status = "RECEIVED"
            }
            return callback(err, distribution, receivingAdvice)
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