'use strict'
const URI = require('urijs')
const axios = require('axios')
const async = require('async')
const winston = require('winston')
const utils = require('./utils')

module.exports = function (fhirconf) {
  const config = fhirconf
  return {
    getVimsFacilities: (orchestrations, callback) => {
      winston.info("Scanning VIMS facilities")
      let error = false
      let url = new URI(config.baseURL).segment("Location").addQuery("identifier", "https://vims.moh.go.tz|").addQuery("_count", 200).toString()

      const facilities = []
      async.whilst((callback) => {
        callback(null, url !== false)
      }, (callback) => {
        let before = new Date()
        axios.get(url, {
          withCredentials: true,
          auth: {
            username: config.username,
            password: config.password
          },
        }).then(response => {
          orchestrations.push(utils.buildOrchestration('Fetching Facilities Mapped With VIMS From FHIR Server', before, 'GET', url, '', response, response.data))
          if(!response.data || !response.data.entry) {
            error = true
            url = false
            return callback(null, url)
          }
          async.each(response.data.entry, (entry, nxtEntry) => {
            let isDVS = false
            for (const type of entry.resource.type) {
              for (const coding of type.coding) {
                if(coding.code === 'DVS') {
                  isDVS = true
                }
              }
            }
            if(isDVS) {
              return nxtEntry()
            }
            let timrFacilityId
            let vimsFacilityId
            let multiplevimsid = false
            for(let identifier of entry.resource.identifier) {
              if(identifier.type.text === 'id' && identifier.system === 'http://hfrportal.ehealth.go.tz') {
                timrFacilityId = identifier.value
              }
              if(identifier.type.text === 'id' && identifier.system === 'https://vims.moh.go.tz') {
                if(vimsFacilityId) {
                  multiplevimsid = true
                }
                vimsFacilityId = identifier.value
              }
            }
            facilities.push({
              timrFacilityId: timrFacilityId,
              timrFacilityUUID: 'urn:uuid:' + entry.resource.id,
              vimsFacilityId: vimsFacilityId,
              facilityName: entry.resource.name,
              multiplevimsid: multiplevimsid
            })
            return nxtEntry()
          }, () => {
            const next = response.data.link.find(link => link.relation == 'next');
            if (next) {
              url = next.url;
            } else {
              url = false
            }
            return callback(null, url);
          })
        }).catch((err) => {
          winston.error('Error occured while getting resource from FHIR server');
          winston.error(err);
          error = true
          url = false
          return callback(null, url)
        })
      }, () => {
        winston.error("returning " + facilities.length + " VIMS facilities")
        return callback(error, facilities)
      })
    },

    getVimsFacilityId: (uuid, orchestrations, callback) => {
      winston.info('Getting VIMS Facility ID from UUID ' + uuid)
      uuid = uuid.replace('urn:uuid:', '')
      let url = new URI(config.baseURL).segment("Location").segment(uuid).toString()
      let before = new Date()
      axios.get(url, {
        withCredentials: true,
        auth: {
          username: '',
          password: ''
        },
      }).then(response => {
        if(!response || !response.data || !response.data.identifier) {
          return callback(true)
        }
        orchestrations.push(utils.buildOrchestration('Fetching VIMS Facility ID From FHIR Server', before, 'GET', url.toString(), '', response, response.data))
        let vimsFacilityId
        for(let identifier of response.data.identifier) {
          if(identifier.type.text === 'id' && identifier.system === 'https://vims.moh.go.tz') {
            vimsFacilityId = identifier.value
          }
        }
        winston.info('Returning VIMS ID ' + vimsFacilityId)
        return callback(false, vimsFacilityId);
      }).catch((err) => {
        winston.error('Error occured while getting resource from FHIR server');
        winston.error(err);
        return callback(err);
      })
    },

    getFacilityUUIDFromVimsId: (vimsFacId, orchestrations, callback) => {

      let url = new URI(config.baseURL).segment("Location").addQuery("identifier", `https://vims.moh.go.tz|${vimsFacId}`).toString()

      let before = new Date()
      axios.get(url, {
        withCredentials: true,
        auth: {
          username: '',
          password: ''
        },
      }).then(response => {
        orchestrations.push(utils.buildOrchestration('Fetching VIMS Facility ID From FHIR Server', before, 'GET', url.toString(), '', response, response.data))
        if(!response || !response.data || !response.data.entry) {
          winston.error(`Error occured while getting facility with identifier https://vims.moh.go.tz|${vimsFacId}`)
          return callback(true)
        }
        if(response.data.entry.length === 0) {
          winston.error(`Something is wrong, facility with identifier https://vims.moh.go.tz|${vimsFacId} not found`)
          return callback(true)
        }
        return callback(false, response.data.entry[0].resource.id, response.data.entry[0].resource.name)
      }).catch((err) => {
        winston.error('Error occured while getting resource from FHIR server');
        winston.error(err);
        return callback(true)
      })
    }
  }
}