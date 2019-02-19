'use strict'
const winston = require('winston')
const request = require('request')
const util = require('util')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const fs = require('fs')
var execPhp = require('exec-php')
const express = require('express')
const async = require('async')
const app = express()
const URI = require('urijs')
const OIM = require('./openinfoman')

// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config')
const mediatorConfig = require('./config/mediator')
mediatorConfig.config.openinfoman.document = "facOrgsRegistry"
const oim = OIM(mediatorConfig.config.openinfoman)

let orchestrations = []

oim.getVimsFacilities(orchestrations,(err,facilities)=>{
  async.eachSeries(facilities,(facility,nxtFac)=>{
    var csr = `<csd:requestParams xmlns:csd='urn:ihe:iti:csd:2013'>
                    <csd:id entityID='${facility.timrFacilityId}'>
                      <csd:otherID code='id' assigningAuthorityName='https://vims.moh.go.tz'>${facility.vimsFacilityId}</csd:otherID>
                    </csd:id>
                </csd:requestParams>`
    var urn = "urn:openhie.org:openinfoman-hwr:stored-function:facility_delete_otherid_by_code";
    var url = "http://localhost:8984/CSD/csr/facOrgsRegistry/careServicesRequest/urn:openhie.org:openinfoman-hwr:stored-function:facility_delete_otherid_by_code"
    var options = {
        url: url.toString(),
        headers: {
          'Content-Type': 'text/xml'
           },
           body: csr
      }

      let before = new Date()
      request.post(options, function (err, res, body) {
        console.log(body)
        return nxtFac()
      })
  })
})