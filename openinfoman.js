'use strict'
const URI = require('urijs')
const request = require('request')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const winston = require('winston')
const utils = require('./utils')

module.exports = function (oimconf) {
  const config = oimconf
  return {
    getVimsFacilities: function (orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.document)
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:facility_get_all')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:otherID assigningAuthorityName="https://vims.moh.go.tz" code="id"/>
                     </csd:requestParams>`
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth,
          'Content-Type': 'text/xml'
           },
           body: csd_msg
      }

      let before = new Date()
      request.post(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Fetching Facilities Mapped With VIMS From OpenInfoMan', before, 'GET', url.toString(), csd_msg, res, body))
        if (err) {
          winston.error(err)
          return callback(err,"")
        }
        var ast = XmlReader.parseSync(body);
        var totalFac = xmlQuery(ast).find("facilityDirectory").children().size()
        var loopCntr = totalFac
        var facilityDirectory = xmlQuery(ast).find("facilityDirectory").children()
        var facilities = []
        for(var counter = 0;counter<totalFac;counter++) {
          var timrFacilityId = facilityDirectory.eq(counter).attr("entityID")
          var facilityDetails = facilityDirectory.eq(counter).children()
          var totalDetails = facilityDirectory.eq(counter).children().size()
          var detailsLoopControl = totalDetails
          var vimsFacilityId = 0
          var DVS = false
          for(var detailsCount = 0;detailsCount<totalDetails;detailsCount++) {
            if( facilityDetails.eq(detailsCount).attr("assigningAuthorityName") == "https://vims.moh.go.tz" &&
                facilityDetails.eq(detailsCount).attr("code") == "id"
              )
              vimsFacilityId = facilityDetails.eq(detailsCount).text()
            if(facilityDetails.eq(detailsCount).has("csd:primaryName"))
              var facilityName = facilityDetails.eq(detailsCount).find("csd:primaryName").text()
            if( facilityDetails.eq(detailsCount).has("csd:extension") &&
                facilityDetails.eq(detailsCount).attr("type") == "facilityType" &&
                facilityDetails.eq(detailsCount).attr("urn") == "urn:openhie.org:openinfoman-tz" &&
                facilityDetails.eq(detailsCount).children().find("facilityType").text() == "DVS"
              )
              DVS = true
          }
          if(DVS === false) {
            facilities.push({"timrFacilityId":timrFacilityId,"vimsFacilityId":vimsFacilityId,"facilityName":facilityName})
            loopCntr--
          }
          else {
            loopCntr--
          }
        }
        if(loopCntr == 0){
          callback(err,facilities)
        }
      })
    },

    getVimsFacilityId: function(uuid,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.document)
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:facility_get_all')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:id entityID="${uuid}"></csd:id>
                     </csd:requestParams>`
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth,
          'Content-Type': 'text/xml'
           },
           body: csd_msg
      }
      let before = new Date()
      request.post(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Fetching VIMS Facility ID From OpenInfoMan', before, 'GET', url.toString(), csd_msg, res, body))
        if (err) {
          winston.error(err)
          return callback(err,"")
        }
        var ast = XmlReader.parseSync(body)
        var facLength = xmlQuery(ast).find("facilityDirectory").children().find("csd:facility").children().size()
        var facility = xmlQuery(ast).find("facilityDirectory").children().find("csd:facility").children()
        var loopCntr = facLength
        var facFound = false
        for(var counter=0;counter<facLength;counter++){
          if(facility.eq(counter).find("otherID").attr("assigningAuthorityName") == "https://vims.moh.go.tz" && facility.eq(counter).find("otherID").attr("code") == "id") {
            facFound = true
            return callback (err,facility.eq(counter).find("otherID").text())
          }
          loopCntr--
        }
        if(loopCntr === 0 && facFound === false)
        return callback()
      })
    },

    getFacilityUUIDFromVimsId: function (vimsFacId,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.document)
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:facility_get_all')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:otherID assigningAuthorityName="https://vims.moh.go.tz" code="id">${vimsFacId}</csd:otherID>
                     </csd:requestParams>`
      var options = {
        url: url.toString(),
        headers: {
          'Content-Type': 'text/xml'
           },
           body: csd_msg
      }
      let before = new Date()
      request.post(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Get facility UUID From VIMSID', before, 'POST', url.toString(), options.body, res, body))
        if (err) {
          winston.error(err)
          return callback(err,"","")
        }
        var ast = XmlReader.parseSync(body)
        var uuid = xmlQuery(ast).find("facilityDirectory").children().attr("entityID")
        var name = xmlQuery(ast).find("facilityDirectory").children().find("csd:facility").children().find("csd:primaryName").text()
        callback(err,uuid,name)
      })
    },

    getOrganizationUUIDFromVimsId: function (vimsOrgId,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.document)
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:organization_get_all')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:otherID assigningAuthorityName="https://vims.moh.go.tz" code="id">${vimsOrgId}</csd:otherID>
                     </csd:requestParams>`
      var options = {
        url: url.toString(),
        headers: {
          'Content-Type': 'text/xml'
           },
           body: csd_msg
      }
      let before = new Date()
      request.post(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Get organization UUID From VIMSID', before, 'POST', url.toString(), options.body, res, body))
        if (err) {
          return callback(err)
        }
        var ast = XmlReader.parseSync(body)
        var uuid = xmlQuery(ast).find("organizationDirectory").children().attr("entityID")
        var name = xmlQuery(ast).find("organizationDirectory").children().find("csd:organization").children().find("csd:primaryName").text()
        callback(err,uuid,name)
      })
    }
  }

}
