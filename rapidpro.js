'use strict'
const URI = require('urijs')
const request = require('request')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const winston = require('winston')
const utils = require('./utils')

module.exports = function (rpconf) {
  const config = rpconf
  return {

    getFacilityUUIDFromVimsId: function (vimsFacId,orchestrations,callback) {
      let url = contactsURL()
      if(contact.hasOwnProperty("uuid"))
      url = url + "?uuid=" + contact.uuid
      let before = new Date()

      let options = {
        url: url,
        headers: {
          Authorization: `Token ${config.authtoken}`
        },
        body: contact,
        json: true
      }
      request.post(options, (err, res, newContact) => {
        if (err) {
          winston.error(err)
          return callback(err)
        }
        isThrottled(newContact,(wasThrottled)=>{
          if(wasThrottled) {
            //reprocess this contact
            addContact(contact, (err, newContact, orchs) => {
              return callback(err,newContact,orchs)
            })
          }
          else {
            if(!newContact.hasOwnProperty("uuid")) {
              winston.error("An error occured while adding contact " + JSON.stringify(contact) + JSON.stringify(newContact))
              fs.appendFile('unprocessed.csv', JSON.stringify(contact) + "," + JSON.stringify(newContact) + "\n", (err) => {
                if (err) throw err;
                return ""
              })
            }

            let orchestrations = []
            if (config.logDetailedOrch) {
              orchestrations.push(utils.buildOrchestration('Add/Update RapidPro Contact', before, 'POST', options.url, JSON.stringify(contact), res, JSON.stringify(newContact)))
            }
            if (newContact) {
              if (newContact.uuid) {
                callback(null, newContact, orchestrations)
              } else {
              callback(null, newContact, orchestrations)
              }
            } else {
              callback(new Error('No body returned, the contact probably didn\'t get saved in RapidPro'), null, orchestrations)
            }
          }
        })
      })
    }
  }

}
