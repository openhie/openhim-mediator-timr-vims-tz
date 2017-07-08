'use strict'
const URI = require('urijs')
const request = require('request')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
module.exports = function (oimconf) {
  const config = oimconf
  return {
    getVimsFacilities: function (callback) {
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
      request.post(options, function (err, res, body) {
        if (err) {
          return callback(err)
        }
        var ast = XmlReader.parseSync(body);
        var totalFac = xmlQuery(ast).find("facilityDirectory").children().size()
        var facilityDirectory = xmlQuery(ast).find("facilityDirectory").children()
        var facilities = []
        for(var counter = 0;counter<totalFac;counter++) {
          var timrFacilityId = facilityDirectory.eq(counter).attr("entityID")
          var facilityDetails = facilityDirectory.eq(counter).children()
          var totalDetails = facilityDirectory.eq(counter).children().size()
          var detailsLoopControl = totalDetails
          var vimsFacilityId = 0
          for(var detailsCount = 0;detailsCount<totalDetails;detailsCount++) {
            if(facilityDetails.eq(detailsCount).attr("assigningAuthorityName") == "https://vims.moh.go.tz" &&
              facilityDetails.eq(detailsCount).attr("code") == "id")
            vimsFacilityId = facilityDetails.eq(detailsCount).text()
            if(facilityDetails.eq(detailsCount).has("csd:primaryName"))
            var facilityName = facilityDetails.eq(detailsCount).find("csd:primaryName").text()
          }
          facilities.push({"timrFacilityId":timrFacilityId,"vimsFacilityId":vimsFacilityId,"facilityName":facilityName})
        }
        if(facilities.length == totalFac)
        callback(facilities)
      })
    }
  }

}
